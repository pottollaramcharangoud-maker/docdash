// Wait-time estimation — pure functions (unit-tested in tests/ewma.test.js)

import { WAIT } from "../config.js";

/**
 * Exponentially weighted moving average over the most recent consults.
 * Newer consultations dominate: ew = α·x + (1−α)·ew, α = 0.5 by default.
 * @param {number[]} durations historical consult durations (any length)
 * @param {number} fallback used when no history exists
 * @returns {number} rounded to 1 decimal
 */
export function ewma(durations, fallback, alpha = WAIT.EWMA_ALPHA) {
  const recent = durations.slice(-WAIT.EWMA_WINDOW);
  if (recent.length === 0) return fallback;
  let ew = recent[0];
  for (let i = 1; i < recent.length; i++) {
    ew = alpha * recent[i] + (1 - alpha) * ew;
  }
  return Math.round(ew * 10) / 10;
}

/**
 * Brief formula: EstimatedWait = (QueuePosition − 1) × DynamicAvg + DoctorOffsetDelay
 * QueuePosition − 1 === patientsAhead (including the patient currently inside).
 * @param {{ patientsAhead: number, avgMins: number, delayMins?: number }} p
 * @returns {number} non-negative integer minutes
 */
export function estimateWaitMins({ patientsAhead, avgMins, delayMins = 0 }) {
  if (patientsAhead <= 0) return Math.max(0, Math.round(delayMins));
  return Math.max(0, Math.round(patientsAhead * avgMins + delayMins));
}

/**
 * Full estimate including position metadata.
 * @returns {{ waitMins: number, patientsAhead: number, queuePosition: number|null, avgMins: number, delayMins: number }}
 */
export function buildWaitEstimate({ queue, patientId, avgMins, delayMins = 0 }) {
  const idx = queue.findIndex((a) => a.id === patientId);
  if (idx === -1) {
    return { waitMins: 0, patientsAhead: 0, queuePosition: null, avgMins, delayMins };
  }
  const patientsAhead = idx;
  return {
    waitMins: estimateWaitMins({ patientsAhead, avgMins, delayMins }),
    patientsAhead,
    queuePosition: idx + 1,
    avgMins,
    delayMins,
  };
}
