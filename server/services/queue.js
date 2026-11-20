// Queue domain service — ordering, EWMA lookups, token advancement, SMS triggers

import db from "../db.js";
import { ewma, buildWaitEstimate } from "./ewma.js";
import { sweepStaleAppointments } from "./shift.js";
import { WAIT, todayStr } from "../config.js";
import { log } from "../logger.js";

export function doctorAvgMins(doctorId) {
  const doc = db.prepare("SELECT avg_mins FROM doctors WHERE id = ?").get(doctorId);
  const rows = db
    .prepare("SELECT mins FROM consult_log WHERE doctor_id = ? ORDER BY ended_at DESC LIMIT 5")
    .all(doctorId)
    .map((r) => r.mins)
    .reverse();
  return ewma(rows, doc?.avg_mins ?? 12);
}

export function doctorDelay(doctorId) {
  const s = db.prepare("SELECT delay_mins FROM doctor_state WHERE doctor_id = ?").get(doctorId);
  return s?.delay_mins ?? 0;
}

/** Active queue for a doctor on a shift/date: active consult first, then emergencies, then token order. */
export function queueOf(doctorId, shift, date = todayStr()) {
  return db
    .prepare(
      `SELECT * FROM appointments
       WHERE doctor_id = ? AND shift = ? AND slot_date = ?
         AND status IN ('WAITING','IN_CONSULTATION')
       ORDER BY CASE status WHEN 'IN_CONSULTATION' THEN 0 ELSE 1 END,
                is_emergency DESC, token_no`
    )
    .all(doctorId, shift, date);
}

export function estimateWait(doctorId, shift, patientId, date = todayStr()) {
  sweepStaleAppointments(db);
  const queue = queueOf(doctorId, shift, date);
  const avg = doctorAvgMins(doctorId);
  const delay = doctorDelay(doctorId);
  const est = buildWaitEstimate({ queue, patientId, avgMins: avg, delayMins: delay });
  return { ...est, queue, avg };
}

export function publicAppointment(a, extra = {}) {
  return {
    id: a.id,
    tokenNo: a.token_no,
    doctorId: a.doctor_id,
    clinicId: a.clinic_id,
    shift: a.shift,
    slotDate: a.slot_date,
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

/** Fire the simulated SMS exactly once when the patient is within the threshold. */
export function maybeSendSms(appointment, patientsAhead) {
  if (appointment.status !== "WAITING") return null;
  if (appointment.sms_sent) return null;
  if (patientsAhead > WAIT.SMS_THRESHOLD_TOKENS) return null;
  const doc = db.prepare("SELECT name FROM doctors WHERE id = ?").get(appointment.doctor_id);
  const msg = `Clinic Alert: You are ${patientsAhead} token(s) away from ${doc.name}. Please reach the waiting area now.`;
  db.prepare("UPDATE appointments SET sms_sent = 1 WHERE id = ?").run(appointment.id);
  db.prepare("INSERT INTO sms_log (appointment_id, message) VALUES (?,?)").run(appointment.id, msg);
  log.info("sms_sent", { appointmentId: appointment.id, patientsAhead });
  return msg;
}

export function maskName(name) {
  return name
    .split(" ")
    .map((p, i) => (i === 0 ? p : p[0] + "."))
    .join(" ");
}

/** Record consult duration for EWMA when a consultation ends. */
export function logConsult(appointment) {
  if (!appointment.started_at) return;
  const mins = (Date.now() - Date.parse(appointment.started_at.replace(" ", "T") + "Z")) / 60000;
  if (mins > 0 && mins < 120) {
    db.prepare("INSERT INTO consult_log (doctor_id, mins) VALUES (?,?)").run(
      appointment.doctor_id,
      Math.round(mins * 10) / 10
    );
  }
}

/**
 * Advance the queue: complete the active consult (if any), then call the next
 * waiting token (emergencies first). Returns the newly called appointment or null.
 */
export function callNext(doctorId, shift, date = todayStr()) {
  const state = db.prepare("SELECT * FROM doctor_state WHERE doctor_id = ?").get(doctorId);
  if (state?.active_appointment_id) {
    const cur = db.prepare("SELECT * FROM appointments WHERE id = ?").get(state.active_appointment_id);
    if (cur && cur.status === "IN_CONSULTATION") {
      logConsult(cur);
      db.prepare(
        "UPDATE appointments SET status='COMPLETED', ended_at=datetime('now') WHERE id = ?"
      ).run(cur.id);
      log.info("consult_completed", { doctorId, token: cur.token_no });
    }
  }
  const next = db
    .prepare(
      `SELECT * FROM appointments
       WHERE doctor_id = ? AND shift = ? AND slot_date = ? AND status = 'WAITING'
       ORDER BY is_emergency DESC, token_no LIMIT 1`
    )
    .get(doctorId, shift, date);
  if (next) {
    db.prepare(
      "UPDATE appointments SET status='IN_CONSULTATION', started_at=datetime('now') WHERE id = ?"
    ).run(next.id);
    db.prepare(
      `UPDATE doctor_state SET status='IN_CONSULTATION', active_appointment_id=?,
       updated_at=datetime('now') WHERE doctor_id=?`
    ).run(next.id, doctorId);
    log.info("token_called", { doctorId, token: next.token_no });
    return next;
  }
  db.prepare(
    `UPDATE doctor_state SET status='ON_BREAK', active_appointment_id=NULL,
     updated_at=datetime('now') WHERE doctor_id=?`
  ).run(doctorId);
  log.info("queue_empty", { doctorId });
  return null;
}

export function completeActive(doctorId) {
  const state = db.prepare("SELECT * FROM doctor_state WHERE doctor_id = ?").get(doctorId);
  if (!state?.active_appointment_id) return false;
  const cur = db.prepare("SELECT * FROM appointments WHERE id = ?").get(state.active_appointment_id);
  if (cur?.status === "IN_CONSULTATION") {
    logConsult(cur);
    db.prepare(
      "UPDATE appointments SET status='COMPLETED', ended_at=datetime('now') WHERE id = ?"
    ).run(cur.id);
  }
  db.prepare(
    `UPDATE doctor_state SET status='ON_BREAK', active_appointment_id=NULL,
     updated_at=datetime('now') WHERE doctor_id=?`
  ).run(doctorId);
  return true;
}

export function skipActive(doctorId, shift, date = todayStr()) {
  const state = db.prepare("SELECT * FROM doctor_state WHERE doctor_id = ?").get(doctorId);
  if (state?.active_appointment_id) {
    const cur = db.prepare("SELECT * FROM appointments WHERE id = ?").get(state.active_appointment_id);
    if (cur?.status === "IN_CONSULTATION") {
      db.prepare(
        "UPDATE appointments SET status='SKIPPED', ended_at=datetime('now') WHERE id = ?"
      ).run(cur.id);
      log.info("token_skipped", { doctorId, token: cur.token_no });
    }
  }
  return callNext(doctorId, shift, date);
}

export function nextTokenNo(doctorId, shift, date = todayStr()) {
  const maxTok = db
    .prepare(
      "SELECT COALESCE(MAX(token_no),0) AS m FROM appointments WHERE doctor_id=? AND shift=? AND slot_date=?"
    )
    .get(doctorId, shift, date).m;
  return maxTok + 1;
}
