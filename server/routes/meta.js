// Shift schedule + heatmap routes

import { Router } from "express";
import db from "../db.js";
import { shiftStatus, sweepStaleAppointments } from "../services/shift.js";
import { h } from "../errors.js";
import { validate } from "../validate.js";

const router = Router();

router.get("/shifts", (_req, res) => {
  sweepStaleAppointments(db);
  res.json(shiftStatus());
});

router.get("/heatmap", validate("heatmap", "query"), (req, res) => {
  const { clinic } = req.query;
  const rows = clinic
    ? db.prepare("SELECT * FROM wait_history WHERE clinic_id = ?").all(clinic)
    : db.prepare("SELECT * FROM wait_history").all();
  res.json(rows);
});

export default router;
