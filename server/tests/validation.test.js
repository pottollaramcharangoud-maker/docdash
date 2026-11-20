// Unit tests: Zod validation schemas + shift lifecycle helpers

import { describe, it, expect } from "vitest";
import { schemas } from "../validate.js";
import { shiftPhase, bookingDate, activeShift, sweepStaleAppointments } from "../services/shift.js";

describe("book schema", () => {
  const valid = {
    doctorId: 1,
    shift: "MORNING",
    patientName: "Priya Sharma",
    patientPhone: "9876543210",
  };

  it("accepts a valid booking", () => {
    expect(schemas.book.safeParse(valid).success).toBe(true);
  });

  it("rejects short or malformed names", () => {
    expect(schemas.book.safeParse({ ...valid, patientName: "A" }).success).toBe(false);
    expect(schemas.book.safeParse({ ...valid, patientName: "John123" }).success).toBe(false);
    expect(schemas.book.safeParse({ ...valid, patientName: "" }).success).toBe(false);
  });

  it("rejects invalid phone numbers", () => {
    for (const bad of ["12345", "0123456789", "abcdefghij", "98765432101"]) {
      expect(schemas.book.safeParse({ ...valid, patientPhone: bad }).success).toBe(false);
    }
  });

  it("accepts +91 prefixed phones", () => {
    expect(
      schemas.book.safeParse({ ...valid, patientPhone: "+91 98765 43210" }).success ||
      schemas.book.safeParse({ ...valid, patientPhone: "+919876543210" }).success
    ).toBe(true);
  });

  it("rejects unknown shifts and non-integer ids", () => {
    expect(schemas.book.safeParse({ ...valid, shift: "NIGHT" }).success).toBe(false);
    expect(schemas.book.safeParse({ ...valid, doctorId: "abc" }).success).toBe(false);
    expect(schemas.book.safeParse({ ...valid, doctorId: -1 }).success).toBe(false);
  });
});

describe("lookup schema (pagination)", () => {
  it("defaults page/limit", () => {
    const r = schemas.lookup.safeParse({ phone: "9876543210" });
    expect(r.success).toBe(true);
    expect(r.data.page).toBe(1);
    expect(r.data.limit).toBe(10);
  });

  it("caps limit at 50 and rejects page 0", () => {
    expect(schemas.lookup.safeParse({ phone: "9876543210", limit: 999 }).success).toBe(false);
    expect(schemas.lookup.safeParse({ phone: "9876543210", page: 0 }).success).toBe(false);
  });
});

describe("delay / status / emergency schemas", () => {
  it("bounds delay minutes to 1..120", () => {
    expect(schemas.delay.safeParse({ mins: 10 }).success).toBe(true);
    expect(schemas.delay.safeParse({ mins: 0 }).success).toBe(false);
    expect(schemas.delay.safeParse({ mins: 500 }).success).toBe(false);
  });

  it("restricts doctor status values", () => {
    expect(schemas.status.safeParse({ status: "ON_BREAK" }).success).toBe(true);
    expect(schemas.status.safeParse({ status: "SLEEPING" }).success).toBe(false);
  });

  it("defaults emergency patient fields", () => {
    const r = schemas.emergency.safeParse({ shift: "MORNING" });
    expect(r.success).toBe(true);
    expect(r.data.patientName).toBe("Emergency Patient");
  });
});

describe("shift lifecycle", () => {
  // Fixed reference: Wednesday 2026-03-11 (local)
  const wed10am = new Date(2026, 2, 11, 10, 0, 0);
  const wed2pm = new Date(2026, 2, 11, 14, 0, 0);
  const wed8pm = new Date(2026, 2, 11, 20, 30, 0);
  const wed7am = new Date(2026, 2, 11, 7, 0, 0);

  it("detects the open morning shift", () => {
    expect(shiftPhase("MORNING", wed10am)).toBe("OPEN");
    expect(activeShift(wed10am)).toBe("MORNING");
  });

  it("detects closed morning shift in the afternoon", () => {
    expect(shiftPhase("MORNING", wed2pm)).toBe("CLOSED");
    expect(activeShift(wed2pm)).toBeNull(); // between shifts
  });

  it("detects evening shift and after-hours", () => {
    expect(shiftPhase("EVENING", wed2pm)).toBe("NOT_STARTED");
    expect(shiftPhase("EVENING", new Date(2026, 2, 11, 18, 0))).toBe("OPEN");
    expect(shiftPhase("EVENING", wed8pm)).toBe("CLOSED");
    expect(activeShift(wed8pm)).toBeNull();
  });

  it("pre-books tomorrow after the shift has closed", () => {
    expect(bookingDate("MORNING", wed10am)).toBe("2026-03-11"); // open now
    expect(bookingDate("EVENING", wed10am)).toBe("2026-03-11"); // upcoming today
    expect(bookingDate("MORNING", wed7am)).toBe("2026-03-11"); // before open, same day
    expect(bookingDate("MORNING", wed2pm)).toBe("2026-03-12"); // closed → tomorrow
  });

  it("treats past dates as closed", () => {
    expect(shiftPhase("MORNING", wed10am, "2026-03-10")).toBe("CLOSED");
  });
});

describe("sweepStaleAppointments", () => {
  it("is a no-op on an empty database", async () => {
    process.env.DB_PATH = ":memory:";
    // Import AFTER env is set so db.js opens the in-memory DB
    const { default: db } = await import("../db.js");
    const swept = sweepStaleAppointments(db, new Date());
    expect(swept).toBe(0);
  });
});
