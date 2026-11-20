// Typed API errors + centralized Express error handler

import { log } from "./logger.js";

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new ApiError(400, "BAD_REQUEST", msg, details);
export const unauthorized = (msg = "Unauthorized") => new ApiError(401, "UNAUTHORIZED", msg);
export const notFound = (msg = "Not found", details) => new ApiError(404, "NOT_FOUND", msg, details);
export const conflict = (msg, details) => new ApiError(409, "CONFLICT", msg, details);
export const unprocessable = (msg, details) => new ApiError(422, "VALIDATION_ERROR", msg, details);
export const tooMany = (msg = "Too many requests") => new ApiError(429, "RATE_LIMITED", msg);
export const internal = (msg = "Internal server error") => new ApiError(500, "INTERNAL", msg);

/** Wrap async handlers so rejections reach the error middleware. */
export const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// eslint-disable-next-line no-unused-vars -- Express identifies error middleware by arity
export function errorHandler(err, req, res, _next) {
  if (err instanceof ApiError) {
    log.warn("api_error", {
      code: err.code,
      status: err.status,
      path: req.originalUrl,
      details: err.details,
    });
    return res.status(err.status).json({
      error: err.message,
      code: err.code,
      ...(err.details ? { details: err.details } : {}),
    });
  }

  // Malformed JSON body
  if (err.type === "entity.parse.failed") {
    return res.status(400).json({ error: "Malformed JSON body", code: "BAD_JSON" });
  }

  // Payload too large
  if (err.type === "entity.too.large") {
    return res.status(413).json({ error: "Payload too large", code: "PAYLOAD_TOO_LARGE" });
  }

  log.error("unhandled_error", {
    path: req.originalUrl,
    message: err.message,
    stack: err.stack,
  });
  return res.status(500).json({ error: "Internal server error", code: "INTERNAL" });
}

export function notFoundHandler(req, res) {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found`, code: "ROUTE_NOT_FOUND" });
}
