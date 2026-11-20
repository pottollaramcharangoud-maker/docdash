// Zod validation layer — every route input passes through these schemas

import { z } from "zod";
import { SHIFT_KEYS } from "./config.js";
import { unprocessable } from "./errors.js";

const id = z.coerce.number().int().positive();
const shift = z.enum(SHIFT_KEYS);

// Indian mobile numbers: 10 digits starting 6-9, optional +91
const phone = z
  .string()
  .trim()
  .regex(/^(\+91[- ]?)?[6-9]\d{9}$/, "Must be a valid 10-digit mobile number starting 6-9");

// Letters (incl. unicode), spaces, hyphens, apostrophes, periods — 2..80 chars
const name = z
  .string()
  .trim()
  .min(2, "Name must be at least 2 characters")
  .max(80, "Name must be at most 80 characters")
  .regex(/^[\p{L}][\p{L} .'’-]*$/u, "Name may only contain letters, spaces, hyphens, apostrophes");

const lat = z.coerce.number().min(-90).max(90);
const lng = z.coerce.number().min(-180).max(180);

const page = z.coerce.number().int().min(1).default(1);
const limit = z.coerce.number().int().min(1).max(50).default(10);

export const schemas = {
  book: z.object({
    doctorId: id,
    shift,
    patientName: name,
    patientPhone: phone,
    clinicId: id.optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD")
      .optional(),
  }),

  lookup: z.object({
    phone,
    page,
    limit,
  }),

  byId: z.object({
    id: z.coerce.number().int().positive(),
  }),

  doctorId: z.object({
    id: id,
  }),

  doctorParams: z.object({
    doctorId: id,
  }),

  queueQuery: z.object({
    shift: shift.default("MORNING"),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
  }),

  doctorQuery: z.object({
    speciality: z.string().trim().max(60).optional(),
    clinic: z.coerce.number().int().positive().optional(),
    page,
    limit: z.coerce.number().int().min(1).max(50).default(20),
  }),

  checkin: z.object({
    // geo is optional — manual check-in allowed when unavailable
    lat: lat.optional(),
    lng: lng.optional(),
  }),

  callNext: z.object({
    shift: shift.default("MORNING"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),

  delay: z.object({
    mins: z.coerce.number().int().min(1).max(120).default(10),
  }),

  status: z.object({
    status: z.enum(["IN_CONSULTATION", "ON_BREAK", "DELAYED"]),
  }),

  emergency: z.object({
    shift: shift.default("MORNING"),
    patientName: name.default("Emergency Patient"),
    patientPhone: z.string().trim().max(20).default("112"),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  }),

  prescription: z
    .object({
      notes: z.string().max(5000).optional(),
      fileBase64: z.string().max(4_000_000).optional(),
      fileName: z.string().max(200).optional(),
    })
    .refine((v) => v.notes?.trim() || v.fileBase64, {
      message: "Provide notes, a file, or both",
    }),

  heatmap: z.object({
    clinic: z.coerce.number().int().positive().optional(),
  }),

  history: z.object({
    doctorId: id.optional(),
    status: z.enum(["COMPLETED", "SKIPPED", "MISSED"]).optional(),
    page,
    limit,
  }),
};

/** Express middleware: validate req[source] with schema; replace with parsed value. */
export function validate(schemaName, source = "body") {
  return (req, _res, next) => {
    const result = schemas[schemaName].safeParse(req[source]);
    if (!result.success) {
      const details = result.error.flatten().fieldErrors;
      return next(
        unprocessable("Validation failed", Object.entries(details).map(([field, messages]) => ({ field, messages })))
      );
    }
    if (source === "body") req.body = result.data;
    else Object.assign(req[source], result.data); // mutate query/params (getter-backed)
    next();
  };
}
