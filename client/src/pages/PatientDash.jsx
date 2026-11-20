import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, usePoll } from "../api.js";
import { PageTitle, StatusBadge, TokenRing, WaitPill } from "../components/widgets.jsx";

export default function PatientDash() {
  const { id } = useParams();
  const { data: apt, error } = usePoll(() => api.appointment(id), 3000);
  const [smsToast, setSmsToast] = useState(null);
  const [checkin, setCheckin] = useState(null);
  const lastSms = useRef(null);

  // simulated SMS popup when fresh alert arrives
  useEffect(() => {
    if (apt?.freshSms && lastSms.current !== apt.freshSms) {
      lastSms.current = apt.freshSms;
      setSmsToast(apt.freshSms);
      const t = setTimeout(() => setSmsToast(null), 8000);
      return () => clearTimeout(t);
    }
  }, [apt?.freshSms]);

  async function doCheckin() {
    setCheckin({ loading: true });
    const finish = async (lat, lng) => {
      try {
        const r = await api.checkin(id, { lat, lng });
        setCheckin(r);
      } catch (e) {
        setCheckin({ error: e.message });
      }
    };
    if (!navigator.geolocation) return finish(undefined, undefined);
    navigator.geolocation.getCurrentPosition(
      (pos) => finish(pos.coords.latitude, pos.coords.longitude),
      () => finish(undefined, undefined) // denied => manual check-in accepted
    );
  }

  if (error) return <p className="text-rose-600">{error}</p>;
  if (!apt) return <p className="text-slate-400">Loading…</p>;

  const urgent = apt.status === "WAITING" && apt.patientsAhead <= 2;

  return (
    <div>
      <PageTitle
        title={`Token #${apt.tokenNo}`}
        subtitle={`${apt.doctorName} · ${apt.speciality} · ${apt.clinicName} — ${apt.clinicBranch}`}
      />

      {smsToast && (
        <div className="mb-4 flex items-start justify-between gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 shadow-lg animate-[fadeIn]">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-amber-600">📩 Simulated SMS sent</p>
            <p className="mt-1 text-sm text-amber-900">{smsToast}</p>
          </div>
          <button className="text-amber-500 hover:text-amber-700" onClick={() => setSmsToast(null)}>✕</button>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="card flex flex-col items-center justify-center gap-4 text-center lg:col-span-1">
          <TokenRing token={apt.tokenNo} active={apt.status === "IN_CONSULTATION"} />
          <StatusBadge status={apt.status} />
          {apt.status === "WAITING" && (
            <>
              <div>
                <p className="text-5xl font-black text-slate-900 tabular-nums">{apt.waitMins}</p>
                <p className="text-sm text-slate-500">minutes estimated wait</p>
              </div>
              <WaitPill mins={apt.waitMins} />
              <p className="text-sm text-slate-600">
                <strong>{apt.patientsAhead}</strong> patient{apt.patientsAhead === 1 ? "" : "s"} ahead ·
                position <strong>#{apt.queuePosition}</strong> in queue
              </p>
              <p className="text-xs text-slate-400">
                Live avg {apt.avgMins} min/consult{apt.delayMins ? ` · +${apt.delayMins}m doctor delay` : ""}
              </p>
            </>
          )}
          {apt.status === "IN_CONSULTATION" && (
            <p className="text-sm font-medium text-emerald-600">You are with the doctor now.</p>
          )}
          {apt.status === "COMPLETED" && <p className="text-sm text-slate-500">Consultation complete. Get well soon!</p>}
          {apt.status === "SKIPPED" && <p className="text-sm text-rose-500">Token marked absent/skipped.</p>}
        </div>

        <div className="space-y-5 lg:col-span-2">
          {urgent && apt.status === "WAITING" && (
            <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 px-5 py-4">
              <p className="font-bold text-amber-800">⚠️ Please arrive at the clinic now!</p>
              <p className="text-sm text-amber-700">You are {apt.patientsAhead} token(s) away — don't miss your turn.</p>
            </div>
          )}

          <div className="card">
            <h3 className="mb-3 font-bold text-slate-900">Live status</h3>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Row label="Doctor status" value={<StatusBadge status={apt.doctorStatus || "ON_BREAK"} />} />
              <Row label="Shift" value={apt.shift} />
              <Row label="Checked in" value={apt.checkedIn ? "✅ Yes" : "⏳ Not yet"} />
              <Row label="Emergency offset" value={`+${apt.delayMins} min`} />
            </div>
            {!apt.checkedIn && (
              <button className="btn-primary mt-4 w-full" onClick={doCheckin} disabled={checkin?.loading}>
                {checkin?.loading ? "Locating…" : "📍 Virtual Check-In (geolocation ≤500m)"}
              </button>
            )}
            {checkin && !checkin.loading && (
              <p className="mt-2 text-center text-xs text-slate-500">
                {checkin.checkedIn
                  ? `Checked in!${checkin.distanceM != null ? ` (${checkin.distanceM}m from clinic)` : ""}`
                  : `Too far from clinic${checkin.distanceM != null ? ` — ${checkin.distanceM}m away` : ""}`}
              </p>
            )}
          </div>

          <div className="card">
            <h3 className="mb-3 font-bold text-slate-900">SMS notification log</h3>
            {apt.smsLog?.length ? (
              <ul className="space-y-2">
                {apt.smsLog.map((s, i) => (
                  <li key={i} className="rounded-xl bg-slate-50 px-4 py-3 text-sm">
                    <p className="text-slate-700">{s.message}</p>
                    <p className="mt-1 text-xs text-slate-400">{s.sent_at}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-400">Alert fires automatically when you are 2 tokens away.</p>
            )}
          </div>

          {apt.prescription && (
            <div className="card border-emerald-200 bg-emerald-50/50">
              <h3 className="mb-2 font-bold text-emerald-800">Digital Prescription</h3>
              <p className="whitespace-pre-wrap text-sm text-emerald-900">{apt.prescription}</p>
              {apt.prescriptionFile && (
                <a className="mt-3 inline-block text-sm font-semibold text-clinic-600 underline"
                   href={apt.prescriptionFile} target="_blank" rel="noreferrer">
                  Download attachment
                </a>
              )}
            </div>
          )}

          <Link to="/my" className="block text-center text-sm text-slate-400 hover:text-slate-600">
            ← All my appointments
          </Link>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="rounded-xl bg-slate-50 px-3.5 py-2.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <div className="mt-1 font-medium text-slate-700">{value}</div>
    </div>
  );
}
