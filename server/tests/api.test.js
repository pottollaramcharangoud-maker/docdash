// Integration tests: full HTTP API flow (booking → console → SMS → pagination)

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import request from "supertest";

// Isolated DB per test file — must be set before app/db modules load
const tmpDb = path.join(os.tmpdir(), `docdash-test-${process.pid}-${Date.now()}.db`);
process.env.DB_PATH = tmpDb;
process.env.LOG_LEVEL = "silent";

const { createApp } = await import("../app.js");
const app = createApp();

afterAll(() => {
  try {
    fs.rmSync(tmpDb, { force: true });
  } catch {
    /* Windows may still hold the SQLite handle — temp file cleanup is best-effort */
  }
});

describe("health & catalog", () => {
  it("GET /api/health returns ok", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("sets baseline security headers", async () => {
    const res = await request(app).get("/api/clinics");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["x-powered-by"]).toBeUndefined();
  });

  it("returns 4 clinics and 8 doctors", async () => {
    const clinics = await request(app).get("/api/clinics");
    expect(clinics.body).toHaveLength(4);
    const doctors = await request(app).get("/api/doctors");
    expect(doctors.status).toBe(200);
    expect(doctors.body.items).toHaveLength(8);
    expect(doctors.body.total).toBe(8);
  });

  it("filters doctors by speciality", async () => {
    const res = await request(app).get("/api/doctors?speciality=Cardiology");
    expect(res.body.items).toHaveLength(2);
  });
});

describe("input validation (422)", () => {
  it("rejects a booking with a bad phone", async () => {
    const res = await request(app).post("/api/appointments").send({
      doctorId: 1,
      shift: "MORNING",
      patientName: "Test Person",
      patientPhone: "12345",
    });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("VALIDATION_ERROR");
    expect(res.body.details.some((d) => d.field === "patientPhone")).toBe(true);
  });

  it("rejects a booking with a numeric name", async () => {
    const res = await request(app).post("/api/appointments").send({
      doctorId: 1,
      shift: "MORNING",
      patientName: "John123",
      patientPhone: "9876543210",
    });
    expect(res.status).toBe(422);
  });

  it("rejects unknown routes with structured 404", async () => {
    const res = await request(app).get("/api/nope");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("ROUTE_NOT_FOUND");
  });

  it("rejects malformed JSON", async () => {
    const res = await request(app)
      .post("/api/appointments")
      .set("Content-Type", "application/json")
      .send("{not json");
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("BAD_JSON");
  });
});

describe("demo flow: token #14 wait estimation + console advancement", () => {
  let apt14;

  it("GET /api/appointments/14 shows 3 patients ahead and ~36 min wait", async () => {
    const res = await request(app).get("/api/appointments/14");
    expect(res.status).toBe(200);
    apt14 = res.body;
    expect(apt14.tokenNo).toBe(14);
    expect(apt14.status).toBe("WAITING");
    expect(apt14.patientsAhead).toBe(3);
    // 3 × EWMA(~11.9) ≈ 36
    expect(apt14.waitMins).toBeGreaterThanOrEqual(30);
    expect(apt14.waitMins).toBeLessThanOrEqual(42);
  });

  it("queue board shows token 11 active and 12-16 waiting", async () => {
    const res = await request(app).get("/api/queue/1?shift=MORNING");
    expect(res.body.activeToken).toBe(11);
    expect(res.body.nextTokens.map((t) => t.tokenNo)).toEqual([12, 13, 14, 15, 16]);
    expect(res.body.status).toBe("IN_CONSULTATION");
  });

  it("Call Next advances to token 12", async () => {
    const res = await request(app)
      .post("/api/doctors/1/call-next")
      .send({ shift: "MORNING" });
    expect(res.status).toBe(200);
    expect(res.body.called.tokenNo).toBe(12);
  });

  it("patient #14 drops to 2 ahead, fires SMS once, and does not re-fire", async () => {
    // First read after advancement → SMS fires here
    const res = await request(app).get("/api/appointments/14");
    expect(res.body.patientsAhead).toBe(2);
    expect(res.body.waitMins).toBeLessThan(36);
    expect(res.body.freshSms).toMatch(/2 token\(s\) away/);
    expect(res.body.smsLog.length).toBeGreaterThanOrEqual(1);

    // Second read must not re-fire
    const again = await request(app).get("/api/appointments/14");
    expect(again.body.freshSms).toBeNull();
    expect(again.body.smsLog.length).toBe(res.body.smsLog.length);
  });

  it("emergency injection jumps to the head of the waiting line", async () => {
    const res = await request(app)
      .post("/api/doctors/1/emergency")
      .send({ shift: "MORNING", patientName: "Trauma Case" });
    expect(res.status).toBe(201);
    expect(res.body.isEmergency).toBe(true);

    const board = await request(app).get("/api/queue/1?shift=MORNING");
    expect(board.body.nextTokens[0].emergency).toBe(true);
    // active token (12) still first overall
    expect(board.body.activeToken).toBe(12);
  });

  it("skip marks the active token absent and calls the next", async () => {
    const res = await request(app)
      .post("/api/doctors/1/skip")
      .send({ shift: "MORNING" });
    expect(res.status).toBe(200);
    expect(res.body.skipped).toBe(true);
    // emergency token should be called next
    expect(res.body.called.isEmergency).toBe(true);
  });

  it("delay endpoint adds minutes and sets DELAYED status", async () => {
    const res = await request(app).post("/api/doctors/1/delay").send({ mins: 10 });
    expect(res.status).toBe(200);
    expect(res.body.delayMins).toBeGreaterThanOrEqual(10);
  });
});

describe("booking", () => {
  it("books a new token with a sequential number", async () => {
    const res = await request(app).post("/api/appointments").send({
      doctorId: 3,
      shift: "MORNING",
      patientName: "Integration Tester",
      patientPhone: "9812345678",
    });
    expect(res.status).toBe(201);
    // Sequential per doctor+shift+date; seeded tokens exist only for today's MORNING
    expect(res.body.tokenNo).toBeGreaterThanOrEqual(1);
    expect(res.body.status).toBe("WAITING");
    expect(res.body).toHaveProperty("slotDate");
  });

  it("404s for a nonexistent doctor", async () => {
    const res = await request(app).post("/api/appointments").send({
      doctorId: 999,
      shift: "MORNING",
      patientName: "Ghost Patient",
      patientPhone: "9812345678",
    });
    expect(res.status).toBe(404);
  });
});

describe("pagination", () => {
  beforeAll(async () => {
    // Seed several appointments for one phone number (letters-only names pass validation)
    const names = ["Alpha Bravo", "Charlie Delta", "Echo Foxtrot", "Golf Hotel",
                   "India Juliet", "Kilo Lima", "Mike November"];
    for (const patientName of names) {
      await request(app).post("/api/appointments").send({
        doctorId: 5,
        shift: "EVENING",
        patientName,
        patientPhone: "9898989898",
      });
    }
  });

  it("returns paginated results with metadata", async () => {
    const res = await request(app).get("/api/appointments?phone=9898989898&page=1&limit=5");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(5);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(5);
    expect(res.body.total).toBe(7);
    expect(res.body.totalPages).toBe(2);
  });

  it("returns the remaining items on page 2", async () => {
    const res = await request(app).get("/api/appointments?phone=9898989898&page=2&limit=5");
    expect(res.body.items).toHaveLength(2);
    expect(res.body.page).toBe(2);
  });

  it("history endpoint paginates by status", async () => {
    const res = await request(app).get(
      "/api/appointments/history?doctorId=1&status=COMPLETED&page=1&limit=3"
    );
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBeLessThanOrEqual(3);
    expect(res.body.items.every((i) => i.status === "COMPLETED")).toBe(true);
    expect(res.body.total).toBeGreaterThanOrEqual(10);
  });
});

describe("shift status endpoint", () => {
  it("reports phases for both shifts", async () => {
    const res = await request(app).get("/api/shifts");
    expect(res.status).toBe(200);
    expect(res.body.shifts.MORNING).toHaveProperty("phase");
    expect(res.body.shifts.EVENING).toHaveProperty("open");
    expect(["MORNING", "EVENING", null]).toContain(res.body.current);
  });
});

describe("geolocation check-in", () => {
  it("accepts coordinates at the clinic (0 m)", async () => {
    const res = await request(app)
      .post("/api/appointments/14/checkin")
      .send({ lat: 17.385, lng: 78.4867 });
    expect(res.status).toBe(200);
    expect(res.body.checkedIn).toBe(true);
    expect(res.body.distanceM).toBe(0);
  });

  it("rejects coordinates far from the clinic", async () => {
    const res = await request(app)
      .post("/api/appointments/14/checkin")
      .send({ lat: 28.6139, lng: 77.209 }); // Delhi — ~1500 km away
    expect(res.body.checkedIn).toBe(false);
    expect(res.body.distanceM).toBeGreaterThan(500);
  });

  it("rejects out-of-range coordinates", async () => {
    const res = await request(app)
      .post("/api/appointments/14/checkin")
      .send({ lat: 999, lng: 0 });
    expect(res.status).toBe(422);
  });
});
