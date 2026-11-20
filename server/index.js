import express from "express";
import cors from "cors";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(cors());
app.use(express.json({ limit: "5mb" }));
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

const PORT = process.env.PORT || 4000;

// ---------- helpers ----------

function ewma(durations, fallback) {
  // exponentially weighted moving average over last 5 consults, alpha = 0.5
  const last = durations.slice(-5);
  if (!last.length) return fallback;
  const alpha = 0.5;
  let ew = last[0];
  for (let i = 1; i < last.length; i++) ew = alpha * last[i] + (1 - alpha) * ew;
  return Math.round(ew * 10) / 10;
}

function doctorAvgMins(doctorId) {
  const doc = db.prepare("SELECT avg_mins FROM doctors WHERE id = ?").get(doctorId);
  const rows = db
    .prepare("SELECT mins FROM consult_log WHERE doctor_id = ? ORDER BY ended_at DESC LIMIT 5")
    .all(doctorId)
    .map((r) => r.mins)
    .reverse();
  return ewma(rows, doc?.avg_mins ?? 12);
}

function doctorDelay(doctorId) {
  const s = db.prepare("SELECT delay_mins FROM doctor_state WHERE doctor_id = ?").get(doctorId);
  return s?.delay_mins ?? 0;
}

function queueOf(doctorId, shift) {
  return db
    .prepare(
      `SELECT * FROM appointments
       WHERE doctor_id = ? AND shift = ? AND status IN ('WAITING','IN_CONSULTATION')
       ORDER BY CASE status WHEN 'IN_CONSULTATION' THEN 0 ELSE 1 END, is_emergency DESC, token_no`
    )
    .all(doctorId, shift);
}

function estimateWait(doctorId, shift, patientId) {
  const queue = queueOf(doctorId, shift);
  const idx = queue.findIndex((a) => a.id === patientId);
  if (idx === -1) return { position: null, patientsAhead: 0, waitMins: 0, queue };
  const patientsAhead = idx; // people before this patient (incl. active)
  const avg = doctorAvgMins(doctorId);
  const delay = doctorDelay(doctorId);
  // brief formula: (QueuePosition - 1) * DynamicAverageDuration + DoctorOffsetDelay
  const waitMins = Math.max(0, Math.round(patientsAhead * avg + delay));
  return { position: idx + 1, patientsAhead, waitMins, avg, delay, queue };
}

function publicAppointment(a, extra = {}) {
  return {
    id: a.id,
    tokenNo: a.token_no,
    doctorId: a.doctor_id,
    clinicId: a.clinic_id,
    shift: a.shift,
    patientName: a.patient_name,
    status: a.status,
    isEmergency: !!a.is_emergency,
    checkedIn: !!a.checked_in,
    prescription: a.prescription,
    prescriptionFile: a.prescription_file,
    createdAt: a.created_at,
    ...extra,
  };
}

function maybeSendSms(appointment, patientsAhead) {
  if (appointment.status !== "WAITING") return null;
  if (appointment.sms_sent) return null;
  if (patientsAhead > 2) return null;
  const doc = db.prepare("SELECT name FROM doctors WHERE id = ?").get(appointment.doctor_id);
  const msg = `Clinic Alert: You are ${patientsAhead} token(s) away from ${doc.name}. Please reach the waiting area now.`;
  db.prepare("UPDATE appointments SET sms_sent = 1 WHERE id = ?").run(appointment.id);
  db.prepare("INSERT INTO sms_log (appointment_id, message) VALUES (?,?)").run(appointment.id, msg);
  return msg;
}

// ---------- routes ----------

app.get("/api/clinics", (_req, res) => {
  res.json(db.prepare("SELECT * FROM clinics ORDER BY id").all());
});

app.get("/api/specialities", (_req, res) => {
  res.json(db.prepare("SELECT * FROM specialities ORDER BY id").all());
});

app.get("/api/doctors", (req, res) => {
  const { speciality, clinic } = req.query;
  let sql = `
    SELECT d.*, s.name AS speciality, c.name AS clinic_name, c.branch AS clinic_branch,
           c.city, c.lat, c.lng,
           (SELECT status FROM doctor_state st WHERE st.doctor_id = d.id) AS live_status,
           (SELECT delay_mins FROM doctor_state st WHERE st.doctor_id = d.id) AS delay_mins,
           (SELECT COUNT(*) FROM appointments a
             WHERE a.doctor_id = d.id AND a.status IN ('WAITING','IN_CONSULTATION')) AS queue_len
    FROM doctors d
    JOIN specialities s ON s.id = d.speciality_id
    JOIN clinics c ON c.id = d.clinic_id
    WHERE 1=1`;
  const args = [];
  if (speciality) { sql += " AND s.name = ?"; args.push(speciality); }
  if (clinic) { sql += " AND c.id = ?"; args.push(Number(clinic)); }
  sql += " ORDER BY d.id";
  res.json(db.prepare(sql).all(...args));
});

app.get("/api/doctors/:id", (req, res) => {
  const doc = db
    .prepare(
      `SELECT d.*, s.name AS speciality, c.name AS clinic_name, c.branch AS clinic_branch,
              c.address, c.city, c.lat, c.lng
       FROM doctors d
       JOIN specialities s ON s.id = d.speciality_id
       JOIN clinics c ON c.id = d.clinic_id
       WHERE d.id = ?`
    )
    .get(req.params.id);
  if (!doc) return res.status(404).json({ error: "Doctor not found" });
  const state = db.prepare("SELECT * FROM doctor_state WHERE doctor_id = ?").get(doc.id);
  res.json({ ...doc, state, avgMins: doctorAvgMins(doc.id) });
});

// Queue board (public waiting-room screen)
app.get("/api/queue/:doctorId", (req, res) => {
  const doctorId = Number(req.params.doctorId);
  const shift = req.query.shift || "MORNING";
  const doc = db
    .prepare(
      `SELECT d.id, d.name, s.name AS speciality, c.name AS clinic_name, c.branch AS clinic_branch
       FROM doctors d JOIN specialities s ON s.id=d.speciality_id JOIN clinics c ON c.id=d.clinic_id
       WHERE d.id = ?`
    )
    .get(doctorId);
  if (!doc) return res.status(404).json({ error: "Doctor not found" });
  const state = db.prepare("SELECT * FROM doctor_state WHERE doctor_id = ?").get(doctorId);
  const queue = queueOf(doctorId, shift);
  const avg = doctorAvgMins(doctorId);
  const delay = state?.delay_mins ?? 0;
  const active = queue.find((a) => a.status === "IN_CONSULTATION") || null;
  const waiting = queue.filter((a) => a.status === "WAITING");
  res.json({
    doctor: doc,
    shift,
    status: state?.status || "ON_BREAK",
    delayMins: delay,
    avgMins: avg,
    activeToken: active?.token_no ?? null,
    activePatient: active ? maskName(active.patient_name) : null,
    nextTokens: waiting.slice(0, 5).map((a) => ({
      tokenNo: a.token_no,
      patient: maskName(a.patient_name),
      emergency: !!a.is_emergency,
      checkedIn: !!a.checked_in,
      estWaitMins: Math.round((waiting.findIndex((w) => w.id === a.id) + (active ? 1 : 0)) * avg + delay),
    })),
    servingCount: queue.filter((a) => a.status !== "WAITING").length + db
      .prepare("SELECT COUNT(*) AS c FROM appointments WHERE doctor_id=? AND shift=? AND status='COMPLETED'")
      .get(doctorId, shift).c,
  });
});

function maskName(name) {
  const parts = name.split(" ");
  return parts.map((p, i) => (i === 0 ? p : p[0] + ".")).join(" ");
}

// Book a token
app.post("/api/appointments", (req, res) => {
  const { doctorId, shift, patientName, patientPhone, clinicId } = req.body;
  if (!doctorId || !shift || !patientName || !patientPhone)
    return res.status(400).json({ error: "doctorId, shift, patientName, patientPhone required" });
  if (!["MORNING", "EVENING"].includes(shift))
    return res.status(400).json({ error: "shift must be MORNING or EVENING" });
  const doc = db.prepare("SELECT * FROM doctors WHERE id = ?").get(doctorId);
  if (!doc) return res.status(404).json({ error: "Doctor not found" });

  const maxTok = db
    .prepare("SELECT COALESCE(MAX(token_no),0) AS m FROM appointments WHERE doctor_id=? AND shift=?")
    .get(doctorId, shift).m;
  const tokenNo = maxTok + 1;

  const info = db
    .prepare(
      `INSERT INTO appointments (token_no, doctor_id, clinic_id, shift, patient_name, patient_phone, status, checked_in)
       VALUES (?,?,?,?,?,?,'WAITING',0)`
    )
    .run(tokenNo, doctorId, clinicId ?? doc.clinic_id, shift, patientName, patientPhone);
  const apt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(info.lastInsertRowid);
  const est = estimateWait(doctorId, shift, apt.id);
  res.status(201).json(publicAppointment(apt, {
    waitMins: est.waitMins,
    patientsAhead: est.patientsAhead,
    queuePosition: est.position,
  }));
});

// Lookup my appointments by phone
app.get("/api/appointments", (req, res) => {
  const { phone } = req.query;
  if (!phone) return res.status(400).json({ error: "phone query required" });
  const rows = db
    .prepare(
      `SELECT a.*, d.name AS doctor_name, s.name AS speciality,
              c.name AS clinic_name, c.branch AS clinic_branch, c.lat, c.lng
       FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
       JOIN specialities s ON s.id = d.speciality_id
       JOIN clinics c ON c.id = a.clinic_id
       WHERE a.patient_phone = ?
       ORDER BY a.id DESC`
    )
    .all(phone);
  res.json(
    rows.map((a) => {
      const est = a.status === "WAITING" || a.status === "IN_CONSULTATION"
        ? estimateWait(a.doctor_id, a.shift, a.id)
        : { waitMins: 0, patientsAhead: 0, position: null };
      const sms = db
        .prepare("SELECT message, sent_at FROM sms_log WHERE appointment_id = ? ORDER BY id DESC")
        .all(a.id);
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
        smsLog: sms,
      });
    })
  );
});

app.get("/api/appointments/:id", (req, res) => {
  const a = db
    .prepare(
      `SELECT a.*, d.name AS doctor_name, s.name AS speciality,
              c.name AS clinic_name, c.branch AS clinic_branch, c.lat, c.lng
       FROM appointments a
       JOIN doctors d ON d.id = a.doctor_id
       JOIN specialities s ON s.id = d.speciality_id
       JOIN clinics c ON c.id = a.clinic_id
       WHERE a.id = ?`
    )
    .get(req.params.id);
  if (!a) return res.status(404).json({ error: "Appointment not found" });
  const est =
    a.status === "WAITING" || a.status === "IN_CONSULTATION"
      ? estimateWait(a.doctor_id, a.shift, a.id)
      : { waitMins: 0, patientsAhead: 0, position: null };
  const freshSms = maybeSendSms(a, est.patientsAhead);
  const smsLog = db
    .prepare("SELECT message, sent_at FROM sms_log WHERE appointment_id = ? ORDER BY id DESC")
    .all(a.id);
  const state = db.prepare("SELECT status, delay_mins FROM doctor_state WHERE doctor_id = ?").get(a.doctor_id);
  res.json(
    publicAppointment(a, {
      doctorName: a.doctor_name,
      speciality: a.speciality,
      clinicName: a.clinic_name,
      clinicBranch: a.clinic_branch,
      lat: a.lat,
      lng: a.lng,
      waitMins: est.waitMins,
      patientsAhead: est.patientsAhead,
      queuePosition: est.position,
      avgMins: est.avg ?? doctorAvgMins(a.doctor_id),
      doctorStatus: state?.status,
      delayMins: state?.delay_mins ?? 0,
      smsLog,
      freshSms,
    })
  );
});

// Virtual check-in via geolocation
app.post("/api/appointments/:id/checkin", (req, res) => {
  const a = db.prepare("SELECT * FROM appointments WHERE id = ?").get(req.params.id);
  if (!a) return res.status(404).json({ error: "Appointment not found" });
  const { lat, lng } = req.body;
  const clinic = db.prepare("SELECT lat, lng FROM clinics WHERE id = ?").get(a.clinic_id);
  let distanceM = null;
  if (typeof lat === "number" && typeof lng === "number" && clinic) {
    distanceM = haversineM(lat, lng, clinic.lat, clinic.lng);
  }
  // allow manual check-in for demo when geo unavailable (distance null => accept)
  const within = distanceM === null || distanceM <= 500;
  if (within) db.prepare("UPDATE appointments SET checked_in = 1 WHERE id = ?").run(a.id);
  res.json({ checkedIn: within, distanceM: distanceM === null ? null : Math.round(distanceM) });
});

function haversineM(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// ---------- doctor console ----------

function logConsult(appointment) {
  if (!appointment.started_at) return;
  const mins =
    (Date.now() - Date.parse(appointment.started_at.replace(" ", "T") + "Z")) / 60000;
  if (mins > 0 && mins < 120)
    db.prepare("INSERT INTO consult_log (doctor_id, mins) VALUES (?,?)").run(appointment.doctor_id, Math.round(mins * 10) / 10);
}

function callNext(doctorId, shift) {
  const state = db.prepare("SELECT * FROM doctor_state WHERE doctor_id = ?").get(doctorId);
  if (state?.active_appointment_id) {
    const cur = db.prepare("SELECT * FROM appointments WHERE id = ?").get(state.active_appointment_id);
    if (cur && cur.status === "IN_CONSULTATION") {
      logConsult(cur);
      db.prepare("UPDATE appointments SET status='COMPLETED', ended_at=datetime('now') WHERE id = ?").run(cur.id);
    }
  }
  const next = db
    .prepare(
      `SELECT * FROM appointments
       WHERE doctor_id = ? AND shift = ? AND status = 'WAITING'
       ORDER BY CASE status WHEN 'IN_CONSULTATION' THEN 0 ELSE 1 END, is_emergency DESC, token_no LIMIT 1`
    )
    .get(doctorId, shift);
  if (next) {
    db.prepare(
      "UPDATE appointments SET status='IN_CONSULTATION', started_at=datetime('now') WHERE id = ?"
    ).run(next.id);
    db.prepare(
      `UPDATE doctor_state SET status='IN_CONSULTATION', active_appointment_id=?,
       updated_at=datetime('now') WHERE doctor_id=?`
    ).run(next.id, doctorId);
    return next;
  }
  db.prepare(
    `UPDATE doctor_state SET status='ON_BREAK', active_appointment_id=NULL,
     updated_at=datetime('now') WHERE doctor_id=?`
  ).run(doctorId);
  return null;
}

// Active appointment for console (prescription target)
app.get("/api/doctors/:id/active", (req, res) => {
  const doctorId = Number(req.params.id);
  const shift = req.query.shift || "MORNING";
  const state = db.prepare("SELECT active_appointment_id FROM doctor_state WHERE doctor_id = ?").get(doctorId);
  if (!state?.active_appointment_id) return res.json({ id: null });
  const a = db.prepare("SELECT * FROM appointments WHERE id = ?").get(state.active_appointment_id);
  if (!a || a.doctor_id !== doctorId || a.shift !== shift || a.status !== "IN_CONSULTATION")
    return res.json({ id: null });
  res.json(publicAppointment(a));
});

app.post("/api/doctors/:id/call-next", (req, res) => {
  const doctorId = Number(req.params.id);
  const shift = req.body.shift || "MORNING";
  const next = callNext(doctorId, shift);
  res.json({ called: next ? publicAppointment(next) : null });
});

app.post("/api/doctors/:id/complete", (req, res) => {
  const doctorId = Number(req.params.id);
  const state = db.prepare("SELECT * FROM doctor_state WHERE doctor_id = ?").get(doctorId);
  if (!state?.active_appointment_id)
    return res.status(400).json({ error: "No active patient" });
  const cur = db.prepare("SELECT * FROM appointments WHERE id = ?").get(state.active_appointment_id);
  if (cur?.status === "IN_CONSULTATION") {
    logConsult(cur);
    db.prepare("UPDATE appointments SET status='COMPLETED', ended_at=datetime('now') WHERE id = ?").run(cur.id);
  }
  db.prepare(
    `UPDATE doctor_state SET status='ON_BREAK', active_appointment_id=NULL,
     updated_at=datetime('now') WHERE doctor_id=?`
  ).run(doctorId);
  res.json({ ok: true });
});

app.post("/api/doctors/:id/delay", (req, res) => {
  const doctorId = Number(req.params.id);
  const mins = Number(req.body.mins ?? 10);
  db.prepare(
    `UPDATE doctor_state SET delay_mins = delay_mins + ?, status='DELAYED',
     updated_at=datetime('now') WHERE doctor_id=?`
  ).run(mins, doctorId);
  res.json({ ok: true, delayMins: doctorDelay(doctorId) });
});

app.post("/api/doctors/:id/skip", (req, res) => {
  // Patient Absent - Skip Token: move to holding (SKIPPED) and advance
  const doctorId = Number(req.params.id);
  const shift = req.body.shift || "MORNING";
  const state = db.prepare("SELECT * FROM doctor_state WHERE doctor_id = ?").get(doctorId);
  if (state?.active_appointment_id) {
    const cur = db.prepare("SELECT * FROM appointments WHERE id = ?").get(state.active_appointment_id);
    if (cur?.status === "IN_CONSULTATION")
      db.prepare("UPDATE appointments SET status='SKIPPED', ended_at=datetime('now') WHERE id = ?").run(cur.id);
  }
  const next = callNext(doctorId, shift);
  res.json({ skipped: true, called: next ? publicAppointment(next) : null });
});

app.post("/api/doctors/:id/status", (req, res) => {
  const doctorId = Number(req.params.id);
  const { status } = req.body;
  if (!["IN_CONSULTATION", "ON_BREAK", "DELAYED"].includes(status))
    return res.status(400).json({ error: "Invalid status" });
  db.prepare(
    "UPDATE doctor_state SET status=?, updated_at=datetime('now') WHERE doctor_id=?"
  ).run(status, doctorId);
  res.json({ ok: true });
});

// Emergency escalation: inject urgent patient ahead of queue
app.post("/api/doctors/:id/emergency", (req, res) => {
  const doctorId = Number(req.params.id);
  const { shift = "MORNING", patientName = "Emergency Patient", patientPhone = "000" } = req.body;
  const doc = db.prepare("SELECT * FROM doctors WHERE id = ?").get(doctorId);
  if (!doc) return res.status(404).json({ error: "Doctor not found" });
  const maxTok = db
    .prepare("SELECT COALESCE(MAX(token_no),0) AS m FROM appointments WHERE doctor_id=? AND shift=?")
    .get(doctorId, shift).m;
  const info = db
    .prepare(
      `INSERT INTO appointments (token_no, doctor_id, clinic_id, shift, patient_name, patient_phone, status, is_emergency, checked_in)
       VALUES (?,?,?,?,?,?,'WAITING',1,1)`
    )
    .run(maxTok + 1, doctorId, doc.clinic_id, shift, patientName, patientPhone);
  const apt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json(publicAppointment(apt));
});

// Digital prescription upload
app.post("/api/appointments/:id/prescription", (req, res) => {
  const a = db.prepare("SELECT * FROM appointments WHERE id = ?").get(req.params.id);
  if (!a) return res.status(404).json({ error: "Appointment not found" });
  const { notes, fileBase64, fileName } = req.body;
  let savedFile = null;
  if (fileBase64 && fileName) {
    const safe = `${a.id}_${path.basename(fileName)}`;
    const buf = Buffer.from(String(fileBase64).replace(/^data:.*?;64,/, ""), "base64");
    const fs = yieldlessWrite(safe, buf);
    savedFile = fs;
  }
  db.prepare("UPDATE appointments SET prescription=?, prescription_file=? WHERE id=?").run(
    notes ?? null,
    savedFile,
    a.id
  );
  res.json({ ok: true, file: savedFile });
});

function yieldlessWrite(name, buf) {
  const p = path.join(__dirname, "uploads", name);
  fs.writeFileSync(p, buf);
  return `/uploads/${name}`;
}

// Heatmap: historical avg waits
app.get("/api/heatmap", (req, res) => {
  const clinicId = req.query.clinic ? Number(req.query.clinic) : null;
  const rows = clinicId
    ? db.prepare("SELECT * FROM wait_history WHERE clinic_id = ?").all(clinicId)
    : db.prepare("SELECT * FROM wait_history").all();
  res.json(rows);
});

app.listen(PORT, () => console.log(`DocDash API listening on http://localhost:${PORT}`));
