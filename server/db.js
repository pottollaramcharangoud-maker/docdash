import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(path.join(__dirname, "docdash.db"));

db.exec(`
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS specialities (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  );

  CREATE TABLE IF NOT EXISTS clinics (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    branch TEXT NOT NULL,
    address TEXT NOT NULL,
    city TEXT NOT NULL,
    lat REAL NOT NULL,
    lng REAL NOT NULL
  );

  CREATE TABLE IF NOT EXISTS doctors (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    speciality_id INTEGER NOT NULL REFERENCES specialities(id),
    clinic_id INTEGER NOT NULL REFERENCES clinics(id),
    fee INTEGER NOT NULL,
    avg_mins INTEGER NOT NULL,
    bio TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_no INTEGER NOT NULL,
    doctor_id INTEGER NOT NULL REFERENCES doctors(id),
    clinic_id INTEGER NOT NULL REFERENCES clinics(id),
    shift TEXT NOT NULL CHECK (shift IN ('MORNING','EVENING')),
    patient_name TEXT NOT NULL,
    patient_phone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'WAITING'
      CHECK (status IN ('WAITING','IN_CONSULTATION','COMPLETED','SKIPPED')),
    is_emergency INTEGER NOT NULL DEFAULT 0,
    checked_in INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    started_at TEXT,
    ended_at TEXT,
    prescription TEXT,
    prescription_file TEXT,
    sms_sent INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS doctor_state (
    doctor_id INTEGER PRIMARY KEY REFERENCES doctors(id),
    status TEXT NOT NULL DEFAULT 'ON_BREAK'
      CHECK (status IN ('IN_CONSULTATION','ON_BREAK','DELAYED')),
    active_appointment_id INTEGER REFERENCES appointments(id),
    delay_mins INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS consult_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doctor_id INTEGER NOT NULL REFERENCES doctors(id),
    mins REAL NOT NULL,
    ended_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS sms_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    appointment_id INTEGER NOT NULL REFERENCES appointments(id),
    message TEXT NOT NULL,
    sent_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS wait_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clinic_id INTEGER NOT NULL REFERENCES clinics(id),
    doctor_id INTEGER NOT NULL REFERENCES doctors(id),
    day_of_week INTEGER NOT NULL,
    hour INTEGER NOT NULL,
    avg_wait_mins REAL NOT NULL
  );
`);

const alreadySeeded = db.prepare("SELECT COUNT(*) AS c FROM clinics").get().c > 0;

function seed() {
  db.exec("BEGIN");
  try {
    const insSpec = db.prepare("INSERT INTO specialities (name) VALUES (?)");
    ["General Medicine", "Pediatrics", "Orthopedics", "Cardiology"].forEach((s) =>
      insSpec.run(s)
    );

    const insClinic = db.prepare(
      "INSERT INTO clinics (name, branch, address, city, lat, lng) VALUES (?,?,?,?,?,?)"
    );
    const clinics = [
      ["CityCare Multispeciality", "Downtown", "12 MG Road", "Hyderabad", 17.385, 78.4867],
      ["CityCare Multispeciality", "North", "45 Kukatpally Main Rd", "Hyderabad", 17.4849, 78.4138],
      ["HealthFirst Clinic", "East", "9 Gachibowli Loop", "Hyderabad", 17.4401, 78.3489],
      ["HealthFirst Clinic", "West", "22 Madhapur Circle", "Hyderabad", 17.4375, 78.3963],
    ];
    clinics.forEach((c) => insClinic.run(...c));

    const specIds = Object.fromEntries(
      db.prepare("SELECT id, name FROM specialities").all().map((r) => [r.name, r.id])
    );
    const insDoc = db.prepare(
      "INSERT INTO doctors (name, speciality_id, clinic_id, fee, avg_mins, bio) VALUES (?,?,?,?,?,?)"
    );
    const doctors = [
      ["Dr. A. Mehta", specIds["Cardiology"], 1, 800, 12, "Interventional cardiology, 18 yrs experience"],
      ["Dr. R. Kapoor", specIds["Cardiology"], 3, 750, 14, "Heart failure & preventive cardiology"],
      ["Dr. S. Sharma", specIds["General Medicine"], 1, 500, 10, "Family medicine & chronic care"],
      ["Dr. P. Nair", specIds["General Medicine"], 2, 450, 8, "General practice, 12 yrs experience"],
      ["Dr. K. Reddy", specIds["Pediatrics"], 2, 600, 9, "Newborn & child wellness"],
      ["Dr. M. Singh", specIds["Pediatrics"], 4, 550, 10, "Pediatric allergies & immunisation"],
      ["Dr. V. Iyer", specIds["Orthopedics"], 3, 700, 15, "Sports injuries & joint replacement"],
      ["Dr. D. Gupta", specIds["Orthopedics"], 4, 650, 13, "Spine care & fracture management"],
    ];
    doctors.forEach((d) => insDoc.run(...d));

    const insState = db.prepare(
      "INSERT INTO doctor_state (doctor_id, status, active_appointment_id, delay_mins) VALUES (?,?,?,?)"
    );
    for (let id = 1; id <= 8; id++) insState.run(id, "ON_BREAK", null, 0);

    // Dr. Mehta (1) MORNING: tokens 1-16 -> 1-10 completed, 11 in consultation, 12-16 waiting
    const insApt = db.prepare(
      `INSERT INTO appointments
       (token_no, doctor_id, clinic_id, shift, patient_name, patient_phone, status, checked_in, created_at, started_at, ended_at)
       VALUES (?,?,?,?,?,?,?,?,datetime('now','-120 minutes'),?,?)`
    );
    const mehtaNames = [
      "Ramesh Kumar", "Sita Devi", "Anil Verma", "Fatima Sheikh", "John D'Souza",
      "Lakshmi Rao", "Vijay Patil", "Neha Joshi", "Suresh Babu", "Amina Begum",
      "Rahul Mehta", "Divya Menon", "Karthik Nair", "Priya Sharma", "Arun Kumar",
      "Sneha Reddy",
    ];
    // completed tokens 1-10
    for (let t = 1; t <= 10; t++) {
      const started = `datetime('now', '-${140 - t * 10} minutes')`;
      const ended = `datetime('now', '-${130 - t * 10} minutes')`;
      db.prepare(
        `INSERT INTO appointments
         (token_no, doctor_id, clinic_id, shift, patient_name, patient_phone, status, checked_in, created_at, started_at, ended_at)
         VALUES (?,?,1,'MORNING',?,?,'COMPLETED',1,datetime('now','-150 minutes'),${started},${ended})`
      ).run(t, 1, mehtaNames[t - 1], `90000000${String(t).padStart(2, "0")}`);
    }
    // token 11 in consultation (started 8 mins ago)
    insApt.run(11, 1, 1, "MORNING", mehtaNames[10], "9000000011", "IN_CONSULTATION", 1,
      "datetime('now','-8 minutes')", null);
    db.prepare(
      "UPDATE appointments SET started_at = datetime('now','-8 minutes') WHERE token_no = 11 AND doctor_id = 1"
    ).run();
    // tokens 12-16 waiting
    for (let t = 12; t <= 16; t++) {
      insApt.run(t, 1, 1, "MORNING", mehtaNames[t - 1], `90000000${t}`, "WAITING", 1, null, null);
    }
    db.prepare(
      "UPDATE doctor_state SET status='IN_CONSULTATION', active_appointment_id=(SELECT id FROM appointments WHERE doctor_id=1 AND token_no=11), updated_at=datetime('now') WHERE doctor_id=1"
    ).run();

    // Dr. Sharma (3) MORNING at clinic 1: tokens 1-4 waiting (consult log below)
    for (let t = 1; t <= 4; t++) {
      insApt.run(t, 3, 1, "MORNING", `Patient S${t}`, `910000000${t}`, "WAITING", 1, null, null);
    }
    db.prepare(
      "UPDATE doctor_state SET status='ON_BREAK', updated_at=datetime('now') WHERE doctor_id=3"
    ).run();

    // consult history for EWMA: Dr. Mehta last 5 = 11,13,12,12,12 -> EWMA ~12
    const insLog = db.prepare(
      "INSERT INTO consult_log (doctor_id, mins, ended_at) VALUES (?,?,datetime('now', ?))"
    );
    [[1, 13, "-70 minutes"], [1, 11, "-55 minutes"], [1, 14, "-40 minutes"],
     [1, 11, "-25 minutes"], [1, 12, "-15 minutes"], [1, 12, "-5 minutes"]].forEach(([d, m, off]) =>
      insLog.run(d, m, off)
    );
    [[3, 9, "-50 minutes"], [3, 11, "-30 minutes"], [3, 10, "-10 minutes"],
     [5, 8, "-45 minutes"], [5, 10, "-20 minutes"],
     [7, 14, "-35 minutes"], [7, 16, "-12 minutes"]].forEach(([d, m, off]) =>
      insLog.run(d, m, off)
    );

    // wait history for heatmap: 4 weeks x 7 days x hours 9-19
    const insHist = db.prepare(
      "INSERT INTO wait_history (clinic_id, doctor_id, day_of_week, hour, avg_wait_mins) VALUES (?,?,?,?,?)"
    );
    for (let dow = 0; dow < 7; dow++) {
      for (let h = 9; h <= 19; h++) {
        const base = 30 + (dow === 0 || dow === 6 ? 18 : 0) + (h >= 17 ? 12 : 0) + (h <= 10 ? 10 : 0);
        const wave = ((dow * 7 + h * 3) % 11) - 5;
        const wait = Math.max(8, base + wave);
        insHist.run(1, 1, dow, h, wait);
        insHist.run(2, 4, dow, h, Math.max(6, wait - 8));
        insHist.run(3, 6, dow, h, Math.max(6, wait - 4));
        insHist.run(4, 8, dow, h, Math.max(6, wait - 12));
      }
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

if (!alreadySeeded) seed();

export default db;
