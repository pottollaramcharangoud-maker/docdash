const statusStyles = {
  WAITING: "bg-amber-100 text-amber-700",
  IN_CONSULTATION: "bg-emerald-100 text-emerald-700",
  COMPLETED: "bg-slate-100 text-slate-600",
  SKIPPED: "bg-rose-100 text-rose-700",
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
