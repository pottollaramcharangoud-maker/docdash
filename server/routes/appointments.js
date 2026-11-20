// Appointment routes: booking, paginated lookup, detail, check-in, prescription

import { Router } from "express";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "../db.js";
import {
  estimateWait,
  publicAppointment,
  maybeSendSms,
  nextTokenNo,
} from "../services/queue.js";
import { bookingDate, shiftPhase } from "../services/shift.js";
import { todayStr, PAGINATION, PRESCRIPTION } from "../config.js";
import { h, notFound, conflict, unprocessable } from "../errors.js";
import { validate } from "../validate.js";
import { emitQueueEvent } from "../realtime.js";
import { log } from "../logger.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

const APT_SELECT = `
  SELECT a.*, d.name AS doctor_name, s.name AS speciality,
         c.name AS clinic_name, c.branch AS clinic_branch, c.lat, c.lng
  FROM appointments a
  JOIN doctors d ON d.id = a.doctor_id
  JOIN specialities s ON s.id = d.speciality_id
  JOIN clinics c ON c.id = a.clinic_id`;

function enrich(a) {
  const active = a.status === "WAITING" || a.status === "IN_CONSULTATION";
  const est = active
    ? estimateWait(a.doctor_id, a.shift, a.id, a.slot_date)
    : { waitMins: 0, patientsAhead: 0, position: null, avg: null };
  const smsLog = db
    .prepare("SELECT message, sent_at FROM sms_log WHERE appointment_id = ? ORDER BY id DESC")
    .all(a.id);
  const state = db
    .prepare("SELECT status, delay_mins FROM doctor_state WHERE doctor_id = ?")
    .get(a.doctor_id);
  return publicAppointment(a, {
    doctorName: a.doctor_name,
    speciality: a.speciality,
    clinicName: a.clinic_name,
    clinicBranch: a.clinic_branch,
    lat: a.lat,
    lng: a.lng,
    waitMins: est.waitMins,
    patientsAhead: est.patientsAhead,
    queuePosition: est.position,
    avgMins: est.avg,
    doctorStatus: state?.status,
    delayMins: state?.delay_mins ?? 0,
    smsLog,
  });
}

// Book a token (validated: name/phone/shift/doctors + shift-window rules)
router.post(
  "/appointments",
  validate("book"),
  h((req, res) => {
    const { doctorId, shift, patientName, patientPhone, clinicId, date } = req.body;

    const doc = db.prepare("SELECT * FROM doctors WHERE id = ?").get(doctorId);
    if (!doc) throw notFound("Doctor not found");

    // Shift-transition rule: bookings target today while the shift is open/upcoming,
    // otherwise the next calendar occurrence (pre-book for tomorrow).
    const slotDate = date ?? bookingDate(shift);
    const phase = shiftPhase(shift, new Date(), slotDate);
    if (phase === "CLOSED") {
      throw conflict(
        `${shift} shift has already closed for ${slotDate}. Book the next available shift instead.`,
        { shift, date: slotDate }
      );
    }

    const tokenNo = nextTokenNo(doctorId, shift, slotDate);
    const info = db
      .prepare(
        `INSERT INTO appointments
         (token_no, doctor_id, clinic_id, shift, slot_date, patient_name, patient_phone, status, checked_in)
         VALUES (?,?,?,?,?,?,?,'WAITING',0)`
      )
      .run(tokenNo, doctorId, clinicId ?? doc.clinic_id, shift, slotDate, patientName, patientPhone);

    const apt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(info.lastInsertRowid);
    const est = estimateWait(doctorId, shift, apt.id, slotDate);
    log.info("appointment_booked", { id: apt.id, token: tokenNo, doctorId, shift, slotDate });
    emitQueueEvent({ doctorId, shift, date: slotDate, type: "booked" });

    res.status(201).json(
      publicAppointment(apt, {
        waitMins: est.waitMins,
        patientsAhead: est.patientsAhead,
        queuePosition: est.position,
      })
    );
  })
);

// Paginated lookup by phone
router.get(
  "/appointments",
  validate("lookup", "query"),
  h((req, res) => {
    const { phone, page, limit } = req.query;
    const total = db
      .prepare("SELECT COUNT(*) AS c FROM appointments WHERE patient_phone = ?")
      .get(phone).c;
    const rows = db
      .prepare(`${APT_SELECT} WHERE a.patient_phone = ? ORDER BY a.id DESC LIMIT ? OFFSET ?`)
      .all(phone, limit, (page - 1) * limit);
    res.json({
      items: rows.map(enrich),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  })
);

// Paginated appointment history (admin/debug): filter by doctor/status
router.get(
  "/appointments/history",
  validate("history", "query"),
  h((req, res) => {
    const { doctorId, status, page, limit } = req.query;
    const where = [];
    const args = [];
    if (doctorId) {
      where.push("a.doctor_id = ?");
      args.push(doctorId);
    }
    if (status) {
      where.push("a.status = ?");
      args.push(status);
    }
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = db
      .prepare(`SELECT COUNT(*) AS c FROM appointments a ${whereSql}`)
      .get(...args).c;
    const rows = db
      .prepare(
        `${APT_SELECT} ${whereSql} ORDER BY a.id DESC LIMIT ? OFFSET ?`
      )
      .all(...args, limit, (page - 1) * limit);
    res.json({
      items: rows.map(enrich),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  })
);

router.get(
  "/appointments/:id",
  validate("byId", "params"),
  h((req, res) => {
    const a = db.prepare(`${APT_SELECT} WHERE a.id = ?`).get(req.params.id);
    if (!a) throw notFound("Appointment not found");
    const payload = enrich(a);
    // SMS fires lazily on read when the patient is within threshold
    payload.freshSms = maybeSendSms(a, payload.patientsAhead);
    if (payload.freshSms) payload.smsLog = db
      .prepare("SELECT message, sent_at FROM sms_log WHERE appointment_id = ? ORDER BY id DESC")
      .all(a.id);
    res.json(payload);
  })
);

// Virtual check-in (geolocation ≤500 m; manual fallback when geo unavailable)
router.post(
  "/appointments/:id/checkin",
  validate("byId", "params"),
  validate("checkin"),
  h((req, res) => {
    const a = db.prepare("SELECT * FROM appointments WHERE id = ?").get(req.params.id);
    if (!a) throw notFound("Appointment not found");
    const { lat, lng } = req.body;
    const clinic = db.prepare("SELECT lat, lng FROM clinics WHERE id = ?").get(a.clinic_id);
    let distanceM = null;
    if (typeof lat === "number" && typeof lng === "number" && clinic) {
      distanceM = haversineM(lat, lng, clinic.lat, clinic.lng);
    }
    const within = distanceM === null || distanceM <= 500;
    if (within) {
      db.prepare("UPDATE appointments SET checked_in = 1 WHERE id = ?").run(a.id);
      log.info("checkin_ok", { id: a.id, distanceM });
      emitQueueEvent({ doctorId: a.doctor_id, shift: a.shift, date: a.slot_date, type: "checkin" });
    }
    res.json({
      checkedIn: within,
      distanceM: distanceM === null ? null : Math.round(distanceM),
    });
  })
);

export function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Digital prescription attachment (notes + optional file, size/type checked)
router.post(
  "/appointments/:id/prescription",
  validate("byId", "params"),
  validate("prescription"),
  h((req, res) => {
    const a = db.prepare("SELECT * FROM appointments WHERE id = ?").get(req.params.id);
    if (!a) throw notFound("Appointment not found");
    const { notes, fileBase64, fileName } = req.body;
    let savedFile = null;

    if (fileBase64 && fileName) {
      const ext = path.extname(fileName).toLowerCase();
      if (!PRESCRIPTION.ALLOWED_EXT.includes(ext)) {
        throw unprocessable(`File type ${ext || "(none)"} not allowed`, {
          field: "fileName",
          messages: [`Allowed: ${PRESCRIPTION.ALLOWED_EXT.join(", ")}`],
        });
      }
      const b64 = String(fileBase64).replace(/^data:.*?;base64,/, "");
      const buf = Buffer.from(b64, "base64");
      if (buf.length > PRESCRIPTION.MAX_FILE_BYTES) {
        throw unprocessable("File exceeds 2 MB limit", { field: "fileBase64" });
      }
      const safe = `${a.id}_${path.basename(fileName).replace(/[^\w.-]/g, "_")}`;
      fs.writeFileSync(path.join(__dirname, "..", "uploads", safe), buf);
      savedFile = `/uploads/${safe}`;
    }

    db.prepare("UPDATE appointments SET prescription=?, prescription_file=? WHERE id=?").run(
      notes ?? null,
      savedFile,
      a.id
    );
    log.info("prescription_saved", { id: a.id, hasFile: !!savedFile });
    res.json({ ok: true, file: savedFile });
  })
);

export default router;
