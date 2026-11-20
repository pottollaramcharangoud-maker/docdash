const statusStyles = {
  WAITING: "bg-amber-100 text-amber-700",
  IN_CONSULTATION: "bg-emerald-100 text-emerald-700",
  COMPLETED: "bg-slate-100 text-slate-600",
  SKIPPED: "bg-rose-100 text-rose-700",
  MISSED: "bg-rose-100 text-rose-700",
  ON_BREAK: "bg-slate-100 text-slate-600",
  DELAYED: "bg-rose-100 text-rose-700",
};

export function StatusBadge({ status, className = "" }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        statusStyles[status] || "bg-slate-100 text-slate-600"
      } ${className}`}
    >
      {(status === "IN_CONSULTATION" || status === "DELAYED") && (
        <span className="h-1.5 w-1.5 rounded-full bg-current animate-pulseDot" />
      )}
      {String(status).replaceAll("_", " ")}
    </span>
  );
}

export function TokenRing({ token, size = "large", active = false }) {
  const dims =
    size === "large" ? "h-32 w-32 text-5xl" : size === "medium" ? "h-20 w-20 text-3xl" : "h-14 w-14 text-xl";
  return (
    <div
      className={`grid ${dims} place-items-center rounded-full border-4 font-black tracking-tight ${
        active
          ? "border-emerald-400 bg-emerald-50 text-emerald-700 animate-pulseDot"
          : "border-clinic-300 bg-clinic-50 text-clinic-700"
      }`}
    >
      #{token ?? "—"}
    </div>
  );
}

export function WaitPill({ mins }) {
  const tone =
    mins <= 5 ? "bg-emerald-100 text-emerald-700" : mins <= 20 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700";
  return (
    <span className={`rounded-lg px-3 py-1.5 text-sm font-bold ${tone}`}>{mins} min wait</span>
  );
}

export function PageTitle({ title, subtitle }) {
  return (
    <div className="mb-5">
      <h1 className="text-2xl font-bold text-slate-900">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
    </div>
  );
}

/** LIVE (socket.io) vs POLLING indicator */
export function LiveBadge({ live }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${
        live ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
      }`}
      title={live ? "Socket.io push connected" : "HTTP polling fallback"}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${live ? "bg-emerald-500 animate-pulseDot" : "bg-slate-400"}`} />
      {live ? "Live" : "Polling"}
    </span>
  );
}

/** Shift status banner (open / between / closed with next-shift hint) */
export function ShiftBanner({ shifts, current }) {
  if (!shifts) return null;
  const morning = shifts.MORNING;
  const evening = shifts.EVENING;
  const closed = (s) => s?.phase === "CLOSED";
  const open = (s) => s?.phase === "OPEN";

  let tone = "bg-clinic-50 text-clinic-800 border-clinic-200";
  let msg = "All shifts closed — pre-book for tomorrow.";
  if (current === "MORNING") {
    tone = "bg-emerald-50 text-emerald-800 border-emerald-200";
    msg = `☀️ Morning shift open (${morning?.open}–${morning?.close}) · Evening at ${evening?.open}`;
  } else if (current === "EVENING") {
    tone = "bg-indigo-50 text-indigo-800 border-indigo-200";
    msg = `🌙 Evening shift open (${evening?.open}–${evening?.close}) · Morning reopens tomorrow ${morning?.open}`;
  } else if (open(morning)) {
    tone = "bg-emerald-50 text-emerald-800 border-emerald-200";
    msg = `☀️ Morning shift open (${morning?.open}–${morning?.close})`;
  } else if (open(evening)) {
    tone = "bg-indigo-50 text-indigo-800 border-indigo-200";
    msg = `🌙 Evening shift open (${evening?.open}–${evening?.close})`;
  } else if (closed(morning) && closed(evening)) {
    msg = "All shifts closed today — bookings target tomorrow.";
  }

  return (
    <div className={`mb-4 rounded-xl border px-4 py-3 text-sm font-medium ${tone}`}>{msg}</div>
  );
}

/** Pagination controls for list endpoints */
export function Pagination({ page, totalPages, total, onPage, label = "items" }) {
  if (totalPages <= 1) {
    return total != null ? (
      <p className="mt-3 text-center text-xs text-slate-400">{total} {label}</p>
    ) : null;
  }
  return (
    <div className="mt-4 flex items-center justify-between text-sm">
      <button
        className="btn-ghost !py-1.5"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        ← Prev
      </button>
      <span className="text-slate-500">
        Page <strong>{page}</strong> of <strong>{totalPages}</strong>
        {total != null && <span className="text-slate-400"> · {total} {label}</span>}
      </span>
      <button
        className="btn-ghost !py-1.5"
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        Next →
      </button>
    </div>
  );
}
