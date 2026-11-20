// Shift lifecycle — open/close windows, transitions, stale-queue sweeping

import { SHIFTS, todayStr } from "../config.js";

function minutesOfDay(dateStr, timeStr) {
  const [h, m] = timeStr.split(":").map(Number);
  return h * 60 + m;
}

function localMinutes(now) {
  return now.getHours() * 60 + now.getMinutes();
}

/**
 * Phase of a shift on a given calendar day: NOT_STARTED | OPEN | CLOSED
 */
export function shiftPhase(shiftKey, now = new Date(), dateStr = todayStr(now)) {
  const cfg = SHIFTS[shiftKey];
  if (!cfg) return "UNKNOWN";
  const today = todayStr(now);
  if (dateStr < today) return "CLOSED";
  if (dateStr > today) return "NOT_STARTED";
  const m = localMinutes(now);
  if (m < minutesOfDay(null, cfg.open)) return "NOT_STARTED";
  if (m >= minutesOfDay(null, cfg.close)) return "CLOSED";
  return "OPEN";
}

export function isShiftOpen(shiftKey, now = new Date()) {
  return shiftPhase(shiftKey, now) === "OPEN";
}

/** The shift currently running, or null between shifts / after hours. */
export function activeShift(now = new Date()) {
  for (const key of Object.keys(SHIFTS)) {
    if (isShiftOpen(key, now)) return key;
  }
  return null;
}

/** Which date a booking targets: today if the shift is open or upcoming today, else tomorrow. */
export function bookingDate(shiftKey, now = new Date()) {
  const phase = shiftPhase(shiftKey, now);
  if (phase === "OPEN" || phase === "NOT_STARTED") return todayStr(now);
  const d = new Date(now);
  d.setDate(d.getDate() + 1);
  return todayStr(d);
}

/** Full schedule + live status for the UI. */
export function shiftStatus(now = new Date()) {
  const current = activeShift(now);
  const phases = {};
  for (const key of Object.keys(SHIFTS)) {
    const cfg = SHIFTS[key];
    phases[key] = {
      ...cfg,
      phase: shiftPhase(key, now),
      date: bookingDate(key, now),
    };
  }
  const nextKey = current === "MORNING" ? "EVENING" : current === "EVENING" ? "MORNING" : shiftPhase("MORNING", now) === "NOT_STARTED" ? "MORNING" : "EVENING";
  return {
    now: now.toISOString(),
    current,
    next: current ? (current === "MORNING" ? "EVENING" : "MORNING") : nextKey,
    shifts: phases,
  };
}

/**
 * Edge-case handling for shift transitions:
 * any WAITING token from a previous calendar day is swept to MISSED
 * so it can never stall today's queue.
 * @returns {number} count of appointments swept
 */
export function sweepStaleAppointments(db, now = new Date()) {
  const today = todayStr(now);
  const info = db
    .prepare(
      `UPDATE appointments SET status = 'MISSED', ended_at = datetime('now')
       WHERE status = 'WAITING' AND slot_date < ?`
    )
    .run(today);
  return info.changes ?? 0;
}
