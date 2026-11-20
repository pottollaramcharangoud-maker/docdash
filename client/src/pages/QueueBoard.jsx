import { useParams, Link } from "react-router-dom";
import { api } from "../api.js";
import { useLive } from "../hooks/useLive.js";
import { PageTitle, StatusBadge, TokenRing, LiveBadge, ShiftBanner } from "../components/widgets.jsx";

const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function Clock() {
  const now = new Date();
  return (
    <div className="text-right">
      <p className="text-2xl font-black tabular-nums text-slate-800">
        {now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
      </p>
      <p className="text-xs text-slate-400">
        {days[now.getDay()]} {now.toLocaleDateString()}
      </p>
    </div>
  );
}

export default function QueueBoard() {
  const { doctorId } = useParams();
  const shift = new Date().getHours() < 14 ? "MORNING" : "EVENING";

  const { data: q, error, live } = useLive(() => api.queue(doctorId, shift), {
    interval: 3000,
    doctorId: Number(doctorId),
  });
  const { data: shiftInfo } = useLive(() => api.shifts(), { interval: 20000 });

  if (error) return <p className="text-rose-600">{error}</p>;
  if (!q) return <p className="text-slate-400">Loading board…</p>;

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <PageTitle
          title={`${q.doctor.clinic_name} — ${q.doctor.clinic_branch}`}
          subtitle={`${q.doctor.name} · ${q.doctor.speciality} · ${shift} shift`}
        />
        <div className="flex items-center gap-3">
          <LiveBadge live={live} />
          <Clock />
        </div>
      </div>

      <ShiftBanner shifts={shiftInfo?.shifts} current={shiftInfo?.current} />

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card flex flex-col items-center justify-center gap-3 lg:col-span-1">
          <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Now serving</p>
          <TokenRing token={q.activeToken} active />
          <p className="font-semibold text-slate-700">{q.activePatient || "Waiting for next patient…"}</p>
          <StatusBadge status={q.status} />
          {q.delayMins > 0 && (
            <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-600">
              +{q.delayMins} min delay
            </span>
          )}
          <p className="text-xs text-slate-400">Avg {q.avgMins} min / consult</p>
          <p className="text-[10px] uppercase tracking-wide text-slate-300">{q.date} · phase: {q.phase}</p>
        </div>

        <div className="card lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-bold text-slate-900">Next in line</h3>
            <span className="text-xs text-slate-400">
              {live ? "Socket.io push" : "Polling every 3s"}
            </span>
          </div>
          <ul className="divide-y divide-slate-100">
            {q.nextTokens.map((t, i) => (
              <li
                key={t.tokenNo}
                className={`flex items-center justify-between gap-3 py-3.5 ${
                  i === 0 ? "bg-clinic-50/60 -mx-3 px-3 rounded-xl" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`grid h-12 w-12 place-items-center rounded-xl font-black ${
                      i === 0 ? "bg-clinic-600 text-white" : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {t.tokenNo}
                  </span>
                  <div>
                    <p className="font-semibold text-slate-800">
                      {t.patient} {t.emergency && <span title="Emergency">🚨</span>}
                    </p>
                    <p className="text-xs text-slate-400">
                      {t.checkedIn ? "✓ Checked in" : "Awaiting check-in"}
                    </p>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-slate-700">~{t.estWaitMins} min</p>
                  <p className="text-xs text-slate-400">pos {i + 1 + (q.activeToken ? 1 : 0)}</p>
                </div>
              </li>
            ))}
            {!q.nextTokens.length && (
              <li className="py-8 text-center text-slate-400">No one waiting — queue is clear 🎉</li>
            )}
          </ul>
          <div className="mt-4 flex justify-between text-xs text-slate-400">
            <Link to={`/doctors/${q.doctor.id}`} className="hover:text-clinic-600">← Doctor profile</Link>
            <Link to="/console" className="hover:text-clinic-600">Open doctor console →</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
