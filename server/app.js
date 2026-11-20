// Express app factory — buildable for both production and isolated tests

import express from "express";
import cors from "cors";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requestLogger } from "./logger.js";
import { errorHandler, notFoundHandler } from "./errors.js";
import { RATE_LIMIT } from "./config.js";
import { tooMany } from "./errors.js";
import catalogRouter from "./routes/catalog.js";
import appointmentsRouter from "./routes/appointments.js";
import queueRouter from "./routes/queue.js";
import metaRouter from "./routes/meta.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Simple fixed-window rate limiter keyed by IP+route. */
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (now - v.start > windowMs) hits.delete(k);
  }, windowMs).unref?.();
  return (req, res, next) => {
    const key = `${req.ip}:${req.route?.path ?? req.path}`;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      entry = { start: now, count: 0 };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) return next(tooMany("Too many booking attempts — try again shortly"));
    next();
  };
}

const bookingLimiter = rateLimit({
  windowMs: RATE_LIMIT.BOOKING_WINDOW_MS,
  max: RATE_LIMIT.BOOKING_MAX,
});

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use(cors());
  app.use(express.json({ limit: "5mb" }));
  app.use(requestLogger);

  // Baseline security headers
  app.use((req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-DNS-Prefetch-Control", "off");
    next();
  });

  app.use("/uploads", express.static(path.join(__dirname, "uploads")));

  app.get("/api/health", (_req, res) =>
    res.json({ ok: true, uptime: Math.round(process.uptime()) })
  );

  app.use("/api", metaRouter);
  app.use("/api", catalogRouter);
  app.post("/api/appointments", bookingLimiter);
  app.use("/api", appointmentsRouter);
  app.use("/api", queueRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
