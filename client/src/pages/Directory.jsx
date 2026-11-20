import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { useLive } from "../hooks/useLive.js";
import { PageTitle, StatusBadge, LiveBadge, ShiftBanner } from "../components/widgets.jsx";

export default function Directory() {
  const [clinics, setClinics] = useState([]);
  const [specialities, setSpecialities] = useState([]);
  const [spec, setSpec] = useState("");
  const [clinic, setClinic] = useState("");

  useEffect(() => {
    api.clinics().then(setClinics);
    api.specialities().then(setSpecialities);
  }, []);

  const { data, live } = useLive(
    () => api.doctors({ speciality: spec, clinic }),
    { interval: 5000 }
  );
  const doctors = data?.items ?? [];
  const { data: shiftInfo } = useLive(() => api.shifts(), { interval: 15000 });

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageTitle
          title="Find a Doctor"
          subtitle="Browse by specialty and clinic branch — see live queue length before you book."
        />
        <LiveBadge live={live} />
      </div>

      <ShiftBanner shifts={shiftInfo?.shifts} current={shiftInfo?.current} />

      <div className="mb-5 flex flex-wrap gap-3">
        <select className="input max-w-xs" value={spec} onChange={(e) => setSpec(e.target.value)}>
          <option value="">All specialties</option>
          {specialities.map((s) => (
            <option key={s.id} value={s.name}>{s.name}</option>
          ))}
        </select>
        <select className="input max-w-xs" value={clinic} onChange={(e) => setClinic(e.target.value)}>
          <option value="">All clinics</option>
          {clinics.map((c) => (
            <option key={c.id} value={c.id}>{c.name} — {c.branch}</option>
          ))}
        </select>
        {(spec || clinic) && (
          <button className="btn-ghost" onClick={() => { setSpec(""); setClinic(""); }}>
            Clear filters
          </button>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {doctors.map((d) => (
          <div key={d.id} className="card flex flex-col gap-3 hover:shadow-md transition">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-bold text-slate-900">{d.name}</h3>
                <p className="text-sm text-clinic-600 font-medium">{d.speciality}</p>
              </div>
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-clinic-50 font-bold text-clinic-700">
                {d.name.replace("Dr. ", "").charAt(0)}
              </div>
            </div>
            <p className="text-xs text-slate-500">
              {d.clinic_name} · {d.clinic_branch}, {d.city}
            </p>
            <p className="text-xs text-slate-500 line-clamp-2">{d.bio}</p>
            <div className="mt-auto flex items-center justify-between gap-2 border-t border-slate-100 pt-3">
              <div className="flex flex-col gap-1">
                <span className="text-sm font-semibold text-slate-700">₹{d.fee} consult</span>
                <div className="flex items-center gap-2">
                  <StatusBadge status={d.live_status || "ON_BREAK"} />
                  <span className="text-xs text-slate-400">{d.queue_len} in queue</span>
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Link to={`/doctors/${d.id}`} className="btn-ghost !py-1.5 text-xs">Profile</Link>
                <Link to={`/book/${d.id}`} className="btn-primary !py-1.5 text-xs">Book Token</Link>
              </div>
            </div>
          </div>
        ))}
        {!doctors.length && (
          <p className="col-span-full py-10 text-center text-slate-400">No doctors match these filters.</p>
        )}
      </div>
    </div>
  );
}
