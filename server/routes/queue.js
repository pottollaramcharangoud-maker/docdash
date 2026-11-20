// Queue board + doctor console routes (real-time token control)

import { Router } from "express";
import db from "../db.js";
import {
  queueOf,
  doctorAvgMins,
  doctorDelay,
  publicAppointment,
  callNext,
  completeActive,
  skipActive,
  nextTokenNo,
  maskName,
} from "../services/queue.js";
import { shiftPhase, sweepStaleAppointments } from "../services/shift.js";
import { todayStr } from "../config.js";
import { h, notFound, conflict } from "../errors.js";
import { validate } from "../validate.js";
import { emitQueueEvent } from "../realtime.js";
import { log } from "../logger.js";

const router = Router();

// Public waiting-room board
router.get(
  "/queue/:id",
  validate("doctorId", "params"),
  validate("queueQuery", "query"),
  h((req, res) => {
    const doctorId = req.params.id;
    const { shift, date } = req.query;
    const slotDate = date ?? todayStr();
    sweepStaleAppointments(db);

    const doc = db
      .prepare(
        `SELECT d.id, d.name, s.name AS speciality, c.name AS clinic_name, c.branch AS clinic_branch
         FROM doctors d
         JOIN specialities s ON s.id = d.speciality_id
         JOIN clinics c ON c.id = d.clinic_id
         WHERE d.id = ?`
      )
      .get(doctorId);
    if (!doc) throw notFound("Doctor not found");

    const state = db.prepare("SELECT * FROM doctor_state WHERE doctor_id = ?").get(doctorId);
    const queue = queueOf(doctorId, shift, slotDate);
    const avg = doctorAvgMins(doctorId);
    const delay = state?.delay_mins ?? 0;
    const active = queue.find((a) => a.status === "IN_CONSULTATION") || null;
    const waiting = queue.filter((a) => a.status === "WAITING");
    const completed = db
      .prepare(
        `SELECT COUNT(*) AS c FROM appointments
         WHERE doctor_id=? AND shift=? AND slot_date=? AND status='COMPLETED'`
      )
      .get(doctorId, shift, slotDate).c;

    res.json({
      doctor: doc,
      shift,
      date: slotDate,
      phase: shiftPhase(shift, new Date(), slotDate),
      status: state?.status || "ON_BREAK",
      delayMins: delay,
      avgMins: avg,
      activeToken: active?.token_no ?? null,
      activePatient: active ? maskName(active.patient_name) : null,
      nextTokens: waiting.slice(0, 5).map((a, i) => ({
        tokenNo: a.token_no,
        patient: maskName(a.patient_name),
        emergency: !!a.is_emergency,
        checkedIn: !!a.checked_in,
        estWaitMins: Math.round((i + (active ? 1 : 0)) * avg + delay),
      })),
      servingCount: completed + (active ? 1 : 0),
    });
  })
);

// Active appointment for the console (prescription target)
router.get(
  "/doctors/:id/active",
  validate("doctorId", "params"),
  validate("queueQuery", "query"),
  h((req, res) => {
    const doctorId = req.params.id;
    const { shift, date } = req.query;
    const state = db
      .prepare("SELECT active_appointment_id FROM doctor_state WHERE doctor_id = ?")
      .get(doctorId);
    if (!state?.active_appointment_id) return res.json({ id: null });
    const a = db.prepare("SELECT * FROM appointments WHERE id = ?").get(state.active_appointment_id);
    if (
      !a ||
      a.doctor_id !== doctorId ||
      a.shift !== shift ||
      (date && a.slot_date !== date) ||
      a.status !== "IN_CONSULTATION"
    ) {
      return res.json({ id: null });
    }
    res.json(publicAppointment(a));
  })
);

router.post(
  "/doctors/:id/call-next",
  validate("doctorId", "params"),
  validate("callNext"),
  h((req, res) => {
    const doctorId = req.params.id;
    const { shift, date } = req.body;
    const slotDate = date ?? todayStr();
    // Shift-close is enforced at booking; doctors may still drain
    // patients already in the queue after the window ends.
    const next = callNext(doctorId, shift, slotDate);
    emitQueueEvent({ doctorId: Number(doctorId), shift, date: slotDate, type: "call-next" });
    res.json({ called: next ? publicAppointment(next) : null });
  })
);

router.post(
  "/doctors/:id/complete",
  validate("doctorId", "params"),
  h((req, res) => {
    const ok = completeActive(req.params.id);
    if (!ok) throw conflict("No active patient to complete");
    emitQueueEvent({ doctorId: Number(req.params.id), type: "complete" });
    res.json({ ok: true });
  })
);

router.post(
  "/doctors/:id/delay",
  validate("doctorId", "params"),
  validate("delay"),
  h((req, res) => {
    const { mins } = req.body;
    db.prepare(
      `UPDATE doctor_state SET delay_mins = delay_mins + ?, status='DELAYED',
       updated_at=datetime('now') WHERE doctor_id=?`
    ).run(mins, req.params.id);
    log.info("delay_added", { doctorId: Number(req.params.id), mins });
    emitQueueEvent({ doctorId: Number(req.params.id), type: "delay" });
    res.json({ ok: true, delayMins: doctorDelay(req.params.id) });
  })
);

router.post(
  "/doctors/:id/skip",
  validate("doctorId", "params"),
  validate("callNext"),
  h((req, res) => {
    const doctorId = req.params.id;
    const { shift, date } = req.body;
    const next = skipActive(doctorId, shift, date ?? todayStr());
    emitQueueEvent({ doctorId: Number(doctorId), shift, type: "skip" });
    res.json({ skipped: true, called: next ? publicAppointment(next) : null });
  })
);

router.post(
  "/doctors/:id/status",
  validate("doctorId", "params"),
  validate("status"),
  h((req, res) => {
    db.prepare(
      "UPDATE doctor_state SET status=?, updated_at=datetime('now') WHERE doctor_id=?"
    ).run(req.body.status, req.params.id);
    emitQueueEvent({ doctorId: Number(req.params.id), type: "status" });
    res.json({ ok: true });
  })
);

// Emergency escalation: inject urgent patient at the head of the waiting line
router.post(
  "/doctors/:id/emergency",
  validate("doctorId", "params"),
  validate("emergency"),
  h((req, res) => {
    const doctorId = req.params.id;
    const { shift, patientName, patientPhone, date } = req.body;
    const slotDate = date ?? todayStr();
    const doc = db.prepare("SELECT * FROM doctors WHERE id = ?").get(doctorId);
    if (!doc) throw notFound("Doctor not found");

    const tokenNo = nextTokenNo(doctorId, shift, slotDate);
    const info = db
      .prepare(
        `INSERT INTO appointments
         (token_no, doctor_id, clinic_id, shift, slot_date, patient_name, patient_phone,
          status, is_emergency, checked_in)
         VALUES (?,?,?,?,?,?,?,'WAITING',1,1)`
      )
      .run(tokenNo, doctorId, doc.clinic_id, shift, slotDate, patientName, patientPhone);
    const apt = db.prepare("SELECT * FROM appointments WHERE id = ?").get(info.lastInsertRowid);
    log.warn("emergency_injected", { doctorId: Number(doctorId), token: tokenNo });
    emitQueueEvent({ doctorId: Number(doctorId), shift, date: slotDate, type: "emergency" });
    res.status(201).json(publicAppointment(apt));
  })
);

export default router;
