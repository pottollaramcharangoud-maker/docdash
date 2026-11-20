import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import { useLive } from "../hooks/useLive.js";
import { PageTitle, StatusBadge, TokenRing, WaitPill, LiveBadge } from "../components/widgets.jsx";

export default function DoctorProfile() {
  const { id } = useParams();

  const { data: doc } = useLive(() => api.doctor(id), { interval: 30000 });
  const { data: queue, live } = useLive(() => api.queue(id, "MORNING"), {
    interval: 3000,
    doctorId: Number(id),
  });

  if (!doc) return <p className="text-slate-400">Loading…</p>;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle
          title={doc.name}
          subtitle={`${doc.speciality} · ${doc.clinic_name} — ${doc.clinic_branch}`}
        />
        <LiveBadge live={live} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card lg:col-span-2 space-y-4">
          <div className="flex items-center gap-4">
            <div className="grid h-16 w-16 place-items-center rounded-2xl bg-clinic-50 text-2xl font-black text-clinic-700">
              {doc.name.replace("Dr. ", "").charAt(0)}
            </div>
            <div>
              <p className="text-lg font-bold text-slate-900">{doc.name}</p>
              <p className="text-sm text-clinic-600">{doc.speciality}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <StatusBadge status={queue?.status || doc.state?.status || "ON_BREAK"} />
                <span className="text-xs text-slate-500">Avg {doc.avgMins} min/consult</span>
              </div>
            </div>
          </div>
          <p className="text-sm text-slate-600">{doc.bio}</p>
          <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600 space-y-1">
            <p><strong>Fee:</strong> ₹{doc.fee}</p>
            <p><strong>Address:</strong> {doc.address}, {doc.city}</p>
            <p><strong>Live queue delay:</strong> {queue?.delayMins ?? 0} mins offset</p>
          </div>
          <div className="flex gap-3">
            <Link to={`/book/${doc.id}`} className="btn-primary">Book a Token</Link>
            <Link to={`/board/${doc.id}`} className="btn-ghost">View Queue Board</Link>
          </div>
        </div>

        <div className="card space-y-4">
          <h3 className="font-bold text-slate-900">Live Queue (Morning)</h3>
          <div className="flex items-center gap-4">
            <TokenRing token={queue?.activeToken} active />
            <div>
              <p className="text-sm font-semibold text-slate-700">Now serving</p>
              <p className="text-sm text-slate-500">{queue?.activePatient || "—"}</p>
              <div className="mt-2">
                <WaitPill mins={queue?.nextTokens?.[0]?.estWaitMins ?? 0} />
              </div>
            </div>
          </div>
          <ul className="divide-y divide-slate-100">
            {(queue?.nextTokens || []).map((t) => (
              <li key={t.tokenNo} className="flex items-center justify-between py-2 text-sm">
                <span className="font-semibold">#{t.tokenNo} {t.emergency && "🚨"}{t.checkedIn ? " ✓" : ""}</span>
                <span className="text-slate-500">{t.patient}</span>
                <span className="text-xs text-slate-400">~{t.estWaitMins}m</span>
              </li>
            ))}
            {!queue?.nextTokens?.length && <li className="py-3 text-sm text-slate-400">Queue empty.</li>}
          </ul>
        </div>
      </div>
    </div>
  );
}
