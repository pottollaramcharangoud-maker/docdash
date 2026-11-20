// Catalog routes: clinics, specialities, doctors

import { Router } from "express";
import db from "../db.js";
import { doctorAvgMins } from "../services/queue.js";
import { todayStr } from "../config.js";
import { h, notFound } from "../errors.js";
import { validate } from "../validate.js";

const router = Router();

router.get("/clinics", (_req, res) => {
  res.json(db.prepare("SELECT * FROM clinics ORDER BY id").all());
});

router.get("/specialities", (_req, res) => {
  res.json(db.prepare("SELECT * FROM specialities ORDER BY id").all());
});

router.get("/doctors", validate("doctorQuery", "query"), (req, res) => {
  const { speciality, clinic, page, limit } = req.query;
  const where = [];
  const args = [];
  if (speciality) {
    where.push("s.name = ?");
    args.push(speciality);
  }
  if (clinic) {
    where.push("c.id = ?");
    args.push(clinic);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const total = db
    .prepare(
      `SELECT COUNT(*) AS c FROM doctors d
       JOIN specialities s ON s.id = d.speciality_id
       JOIN clinics c ON c.id = d.clinic_id ${whereSql}`
    )
    .get(...args).c;
  const rows = db
    .prepare(
      `SELECT d.*, s.name AS speciality, c.name AS clinic_name, c.branch AS clinic_branch,
              c.city, c.lat, c.lng,
              (SELECT status FROM doctor_state st WHERE st.doctor_id = d.id) AS live_status,
              (SELECT delay_mins FROM doctor_state st WHERE st.doctor_id = d.id) AS delay_mins,
              (SELECT COUNT(*) FROM appointments a
                WHERE a.doctor_id = d.id AND a.slot_date = ?
                  AND a.status IN ('WAITING','IN_CONSULTATION')) AS queue_len
       FROM doctors d
       JOIN specialities s ON s.id = d.speciality_id
       JOIN clinics c ON c.id = d.clinic_id
       ${whereSql}
       ORDER BY d.id
       LIMIT ? OFFSET ?`
    )
    .all(todayStr(), ...args, limit, (page - 1) * limit);
  res.json({
    items: rows,
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
  });
});

router.get(
  "/doctors/:id",
  validate("doctorId", "params"),
  h((req, res) => {
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
    if (!doc) throw notFound("Doctor not found");
    const state = db.prepare("SELECT * FROM doctor_state WHERE doctor_id = ?").get(doc.id);
    res.json({ ...doc, state, avgMins: doctorAvgMins(doc.id) });
  })
);

export default router;
