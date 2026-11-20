// Unit tests: EWMA + wait-time estimation (pure functions)

import { describe, it, expect } from "vitest";
import { ewma, estimateWaitMins, buildWaitEstimate } from "../services/ewma.js";

describe("ewma", () => {
  it("returns fallback when there is no history", () => {
    expect(ewma([], 12)).toBe(12);
  });

  it("returns the single observation when only one exists", () => {
    expect(ewma([15], 12)).toBe(15);
  });

  it("weights recent consultations more heavily than older ones", () => {
    // α = 0.5 seeded at 10: 10 → 0.5·20+0.5·10 = 15 → 0.5·30+0.5·15 = 22.5
    expect(ewma([10, 20, 30], 0)).toBe(22.5);
    // A late spike pulls the EWMA up more than an early one of the same size
    expect(ewma([30, 10, 10], 0)).toBeLessThan(ewma([10, 10, 30], 0));
  });

  it("ignores samples older than the 5-consult window", () => {
    const old = [100, 100, 100, 100]; // should be dropped
    const recent = [10, 10, 10, 10, 10];
    expect(ewma([...old, ...recent], 0)).toBe(10);
  });

  it("is stable on constant durations", () => {
    expect(ewma([12, 12, 12, 12, 12], 99)).toBe(12);
  });

  it("rounds to one decimal place", () => {
    const v = ewma([10, 11], 0); // 10.5
    expect(v).toBe(10.5);
    expect(ewma([10, 12, 11], 0)).toBe(11); // 10 → 11 → 11
  });
});

describe("estimateWaitMins", () => {
  it("matches the brief formula: (position−1) × avg + delay", () => {
    // Token #14 with #11 inside → 3 patients ahead × 12 min = 36
    expect(estimateWaitMins({ patientsAhead: 3, avgMins: 12 })).toBe(36);
  });

  it("applies the doctor delay offset", () => {
    expect(estimateWaitMins({ patientsAhead: 3, avgMins: 12, delayMins: 10 })).toBe(46);
  });

  it("returns 0 (plus delay) for the patient currently inside", () => {
    expect(estimateWaitMins({ patientsAhead: 0, avgMins: 12, delayMins: 0 })).toBe(0);
    expect(estimateWaitMins({ patientsAhead: 0, avgMins: 12, delayMins: 5 })).toBe(5);
  });

  it("never returns a negative wait", () => {
    expect(estimateWaitMins({ patientsAhead: -2, avgMins: 12 })).toBe(0);
  });
});

describe("buildWaitEstimate", () => {
  const queue = [{ id: 101 }, { id: 102 }, { id: 103 }, { id: 104 }];

  it("computes position and patients-ahead for a queued patient", () => {
    const est = buildWaitEstimate({ queue, patientId: 104, avgMins: 10, delayMins: 0 });
    expect(est.queuePosition).toBe(4);
    expect(est.patientsAhead).toBe(3);
    expect(est.waitMins).toBe(30);
  });

  it("handles the head of queue", () => {
    const est = buildWaitEstimate({ queue, patientId: 101, avgMins: 10 });
    expect(est.queuePosition).toBe(1);
    expect(est.patientsAhead).toBe(0);
    expect(est.waitMins).toBe(0);
  });

  it("returns zeroed estimate when the patient is not in the queue", () => {
    const est = buildWaitEstimate({ queue, patientId: 999, avgMins: 10, delayMins: 4 });
    expect(est.queuePosition).toBeNull();
    expect(est.waitMins).toBe(0);
    expect(est.patientsAhead).toBe(0);
  });
});
