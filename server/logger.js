// Structured JSON logging (one JSON object per line) for observability

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

function threshold() {
  const raw = process.env.LOG_LEVEL || (process.env.NODE_ENV === "test" ? "silent" : "info");
  return LEVELS[raw] ?? LEVELS.info;
}

function write(level, msg, ctx = {}) {
  if (LEVELS[level] < threshold()) return;
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    msg,
    ...ctx,
  });
  const stream = level === "error" ? process.stderr : process.stdout;
  stream.write(line + "\n");
}

function make(base = {}) {
  return {
    debug: (msg, ctx) => write("debug", msg, { ...base, ...ctx }),
    info: (msg, ctx) => write("info", msg, { ...base, ...ctx }),
    warn: (msg, ctx) => write("warn", msg, { ...base, ...ctx }),
    error: (msg, ctx) => write("error", msg, { ...base, ...ctx }),
    child: (extra) => make({ ...base, ...extra }),
  };
}

export const log = make();

// Express middleware: request/response timing with request id
let seq = 0;
export function requestLogger(req, res, next) {
  const reqId = ++seq;
  const start = process.hrtime.bigint();
  res.on("finish", () => {
    const durMs = Math.round(Number(process.hrtime.bigint() - start) / 1e5) / 10;
    const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "info";
    write(level, "http_request", {
      reqId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durMs,
      ip: req.ip,
    });
  });
  next();
}
