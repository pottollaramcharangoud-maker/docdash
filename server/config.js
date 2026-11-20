// Central configuration — shift schedules and app constants

export const SHIFTS = {
  MORNING: { key: "MORNING", label: "Morning", open: "09:00", close: "13:00" },
  EVENING: { key: "EVENING", label: "Evening", open: "17:00", close: "20:00" },
};

export const SHIFT_KEYS = Object.keys(SHIFTS);

export const WAIT = {
  EWMA_ALPHA: 0.5,
  EWMA_WINDOW: 5,
  SMS_THRESHOLD_TOKENS: 2,
  GEO_RADIUS_M: 500,
};

export const PAGINATION = {
  DEFAULT_LIMIT: 10,
  MAX_LIMIT: 50,
};

export const RATE_LIMIT = {
  BOOKING_WINDOW_MS: 60_000,
  BOOKING_MAX: process.env.NODE_ENV === "test" ? 10_000 : 15,
};

export const PRESCRIPTION = {
  MAX_NOTES: 5000,
  MAX_FILE_BYTES: 2 * 1024 * 1024,
  ALLOWED_EXT: [".pdf", ".png", ".jpg", ".jpeg"],
};

export function todayStr(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
