// Unit tests: queue ordering + token advancement state machine

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";

const tmpDb = path.join(os.tmpdir(), `docdash-queue-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.LOG_LEVEL = "silent";

const { default: db } = await import("../db.js");
const { queueOf, callNext, skipActive, completeActive, nextTokenNo, publicAppointment } =
  await import("../services/queue.js");
const { sweepStaleAppointments } = await import("../services/shift.js");

afterAll(() => {
  try {
    fs.rmSync(tmpDb, { force: true });
  } catch {
    /* best-effort cleanup on Windows */
  }
});

describe("queue ordering", () => {
  it("puts the active consultation first, then emergencies, then token order", () => {
    const q = queueOf(1, "MORNING");
    expect(q[0].status).toBe("IN_CONSULTATION");
    expect(q[0].token_no).toBe(11);
    // remaining are waiting in token order
    const waiting = q.filter((a) => a.status === "WAITING");
    expect(waiting.map((a) => a.token_no)).toEqual([12, 13, 14, 15, 16]);
  });

  it("injects an emergency ahead of normal waiting tokens but after the active one", () => {
    db.prepare(
      `INSERT INTO appointments
       (token_no, doctor_id, clinic_id, shift, patient_name, patient_phone, status, is_emergency, checked_in)
       VALUES (99, 1, 1, 'MORNING', 'Code Blue', '112', 'WAITING', 1, 1)`
    ).run();
    const q = queueOf(1, "MORNING");
    expect(q[0].token_no).toBe(11); // active still first
    expect(q[1].token_no).toBe(99); // emergency at head of waiting
    expect(q[1].is_emergency).toBe(1);
    db.prepare("DELETE FROM appointments WHERE token_no = 99").run();
  });
});

describe("token advancement", () => {
  beforeAll(() => {
    // Reset to known state: 11 active, 12-16 waiting
    db.prepare(
      `UPDATE appointments SET status='IN_CONSULTATION', started_at=datetime('now','-5 minutes')
       WHERE doctor_id=1 AND token_no=11 AND shift='MORNING'`
    ).run();
    db.prepare(
      `UPDATE appointments SET status='WAITING', started_at=NULL
       WHERE doctor_id=1 AND token_no BETWEEN 12 AND 16 AND shift='MORNING'`
    ).run();
    db.prepare(
      `UPDATE doctor_state SET status='IN_CONSULTATION',
       active_appointment_id=(SELECT id FROM appointments WHERE doctor_id=1 AND token_no=11)
       WHERE doctor_id=1`
    ).run();
  });

  it("callNext completes the active token and calls the next waiting one", () => {
    const called = callNext(1, "MORNING");
    expect(called.token_no).toBe(12);
    const prev = db
      .prepare(
        `SELECT status FROM appointments WHERE doctor_id=1 AND token_no=11 AND shift='MORNING'`
      )
      .get();
    expect(prev.status).toBe("COMPLETED");
    const active = db
      .prepare(
        `SELECT status FROM appointments WHERE doctor_id=1 AND token_no=12 AND shift='MORNING'`
      )
      .get();
    expect(active.status).toBe("IN_CONSULTATION");
  });

  it("skipActive marks the current patient absent and advances", () => {
    const next = skipActive(1, "MORNING");
    expect(next.token_no).toBe(13);
    const skipped = db
      .prepare(
        `SELECT status FROM appointments WHERE doctor_id=1 AND token_no=12 AND shift='MORNING'`
      )
      .get();
    expect(skipped.status).toBe("SKIPPED");
  });

  it("completeActive clears the doctor state when someone is inside", () => {
    const ok = completeActive(1);
    expect(ok).toBe(true);
    const state = db.prepare("SELECT * FROM doctor_state WHERE doctor_id=1").get();
    expect(state.active_appointment_id).toBeNull();
    expect(state.status).toBe("ON_BREAK");
  });

  it("completeActive returns false when nobody is inside", () => {
    expect(completeActive(1)).toBe(false);
  });

  it("callNext on an empty queue returns null and sets ON_BREAK", () => {
    // Drain remaining waiting tokens
    db.prepare(
      `UPDATE appointments SET status='COMPLETED'
       WHERE doctor_id=1 AND shift='MORNING' AND status='WAITING'`
    ).run();
    db.prepare(
      `UPDATE appointments SET status='COMPLETED'
       WHERE doctor_id=1 AND shift='MORNING' AND status='IN_CONSULTATION'`
    ).run();
    const result = callNext(1, "MORNING");
    expect(result).toBeNull();
    const state = db.prepare("SELECT status FROM doctor_state WHERE doctor_id=1").get();
    expect(state.status).toBe("ON_BREAK");
  });
});

describe("nextTokenNo", () => {
  it("increments per doctor+shift+date", () => {
    // Doctor 5 evening had 0 tokens at seed; bookings in api tests don't share this DB
    expect(nextTokenNo(5, "EVENING")).toBe(1);
    db.prepare(
      `INSERT INTO appointments
       (token_no, doctor_id, clinic_id, shift, patient_name, patient_phone, status)
       VALUES (1, 5, 2, 'EVENING', 'X', '9800000001', 'WAITING')`
    ).run();
    expect(nextTokenNo(5, "EVENING")).toBe(2);
  });
});

describe("shift-transition sweep", () => {
  it("marks yesterday's WAITING tokens as MISSED so they cannot stall today", () => {
    db.prepare(
      `INSERT INTO appointments
       (token_no, doctor_id, clinic_id, shift, slot_date, patient_name, patient_phone, status)
       VALUES (50, 6, 4, 'MORNING', date('now','-1 day'), 'Stale Patient', '9800000002', 'WAITING')`
    ).run();
    const swept = sweepStaleAppointments(db);
    expect(swept).toBeGreaterThanOrEqual(1);
    const row = db
      .prepare(
        `SELECT status FROM appointments WHERE doctor_id=6 AND token_no=50`
      )
      .get();
    expect(row.status).toBe("MISSED");
  });

  it("leaves today's waiting tokens untouched", () => {
    const before = db
      .prepare(
        `SELECT COUNT(*) AS c FROM appointments
         WHERE status='WAITING' AND slot_date=date('now')`
      )
      .get().c;
    sweepStaleAppointments(db);
    const after = db
      .prepare(
        `SELECT COUNT(*) AS c FROM appointments
         WHERE status='WAITING' AND slot_date=date('now')`
      )
      .get().c;
    expect(after).toBe(before);
  });
});

describe("publicAppointment shape", () => {
  it("maps DB columns to API camelCase", () => {
    const row = {
      id: 1,
      token_no: 7,
      doctor_id: 2,
      clinic_id: 3,
      shift: "EVENING",
      slot_date: "2026-03-11",
      patient_name: "A B",
      status: "WAITING",
      is_emergency: 0,
      checked_in: 1,
      prescription: null,
      prescription_file: null,
      created_at: "2026-03-11 10:00:00",
    };
    const pub = publicAppointment(row);
    expect(pub.tokenNo).toBe(7);
    expect(pub.slotDate).toBe("2026-03-11");
    expect(pub.isEmergency).toBe(false);
    expect(pub.checkedIn).toBe(true);
    expect(pub.patientName).toBe("A B");
  });
});
