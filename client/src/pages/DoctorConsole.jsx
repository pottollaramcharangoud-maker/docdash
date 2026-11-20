import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api, usePoll } from "../api.js";
import { PageTitle, StatusBadge, TokenRing } from "../components/widgets.jsx";

export default function DoctorConsole() {
  const { doctorId } = useParams();
  const nav = useNavigate();
  const [doctors, setDoctors] = useState([]);
  const [selected, setSelected] = useState(doctorId || "1");
  const [shift, setShift] = useState("MORNING");
  const [flash, setFlash] = useState(null);
  const [rx, setRx] = useState({ notes: "", fileName: "", fileBase64: "" });
  const [activeId, setActiveId] = useState(null);
  const fileRef = useRef();

  useEffect(() => {
    api.doctors().then(setDoctors);
  }, []);

  useEffect(() => {
    if (doctorId) setSelected(doctorId);
  }, [doctorId]);

  const { data: q, error } = usePoll(() => api.queue(selected, shift), 3000);
  const { data: active } = usePoll(
    () => fetch(`/api/doctors/${selected}/active?shift=${shift}`).then((r) => r.json()),
    3000
  );

  useEffect(() => {
    setActiveId(active?.id ?? null);
    if (!active?.id) setRx({ notes: "", fileName: "", fileBase64: "" });
  }, [active?.id]);

  function say(msg, tone = "ok") {
    setFlash({ msg, tone });
    setTimeout(() => setFlash(null), 2500);
  }

  async function act(fn, okMsg) {
    try {
      await fn();
      if (okMsg) say(okMsg);
    } catch (e) {
      say(e.message, "err");
    }
  }

  async function saveRx() {
    if (!activeId) throw new Error("No active patient");
    await api.prescription(activeId, rx);
    setRx({ notes: "", fileName: "", fileBase64: "" });
  }

  return (
    <div>
      <PageTitle
        title="Doctor Consultation Console"
        subtitle="Call next patient, manage delays, skip no-shows — patient screens update within 3 seconds."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          className="input max-w-xs"
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value);
            nav(`/console/${e.target.value}`);
          }}
        >
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} — {d.speciality}
            </option>
          ))}
        </select>
        <div className="flex overflow-hidden rounded-xl border border-slate-200">
          {["MORNING", "EVENING"].map((s) => (
            <button
              key={s}
              onClick={() => setShift(s)}
              className={`px-4 py-2.5 text-sm font-semibold ${
                shift === s ? "bg-clinic-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        {q && (
          <Link to={`/board/${selected}`} className="btn-ghost ml-auto">
            Open public board ↗
          </Link>
        )}
      </div>

      {flash && (
        <div
          className={`mb-4 rounded-xl px-4 py-3 text-sm font-medium ${
            flash.tone === "err" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"
          }`}
        >
          {flash.msg}
        </div>
      )}
      {error && <p className="mb-4 text-sm text-rose-600">{error}</p>}

      {q && (
        <div className="grid gap-5 lg:grid-cols-3">
          <div className="card flex flex-col items-center justify-center gap-3">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Active patient</p>
            <TokenRing token={q.activeToken} active />
            <p className="font-semibold text-slate-700">{q.activePatient || "No patient inside"}</p>
            <StatusBadge status={q.status} />
            {q.delayMins > 0 && (
              <span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-bold text-rose-600">
                Delay offset +{q.delayMins} min
              </span>
            )}
            <p className="text-xs text-slate-400">Avg {q.avgMins} min · EWMA last-5</p>
          </div>

          <div className="card space-y-3 lg:col-span-2">
            <h3 className="font-bold text-slate-900">Controls</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <button
                className="btn-primary !py-3"
                onClick={() => act(() => api.callNext(selected, shift), "→ Next patient called")}
              >
                ▶ Call Next Patient
              </button>
              <button
                className="btn-ghost !py-3"
                onClick={() => act(() => api.complete(selected, shift), "✔ Marked completed")}
              >
                ✔ Mark Completed
              </button>
              <button
                className="btn-danger !py-3"
                onClick={() => act(() => api.delay(selected, 10), "⏱ +10 min delay added")}
              >
                ⏱ Delay 10 mins
              </button>
              <button
                className="btn-ghost !py-3 !bg-amber-50 !text-amber-700 hover:!bg-amber-100"
                onClick={() => act(() => api.skip(selected, shift), "⏭ Token skipped — next called")}
              >
                ⏭ Patient Absent — Skip Token
              </button>
              <button
                className="btn-danger !py-3 sm:col-span-2"
                onClick={() =>
                  act(
                    () => api.emergency(selected, { shift, patientName: "Emergency Trauma", patientPhone: "112" }),
                    "🚨 Emergency injected ahead of queue"
                  )
                }
              >
                🚨 Inject Emergency Patient
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 border-t border-slate-100 pt-3">
              {[
                ["ON_BREAK", "On Break"],
                ["DELAYED", "Delayed"],
                ["IN_CONSULTATION", "In Consultation"],
              ].map(([v, l]) => (
                <button
                  key={v}
                  className={`rounded-lg px-3 py-2 text-xs font-semibold border transition ${
                    q.status === v
                      ? "border-clinic-500 bg-clinic-50 text-clinic-700"
                      : "border-slate-200 text-slate-500 hover:bg-slate-50"
                  }`}
                  onClick={() => act(() => api.setStatus(selected, v), `Status → ${l}`)}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="card lg:col-span-2">
            <h3 className="mb-3 font-bold text-slate-900">Waiting queue ({q.nextTokens.length})</h3>
            <ul className="divide-y divide-slate-100">
              {q.nextTokens.map((t) => (
                <li key={t.tokenNo} className="flex items-center justify-between py-2.5 text-sm">
                  <span className="flex items-center gap-2 font-semibold">
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 font-black">
                      {t.tokenNo}
                    </span>
                    {t.emergency && "🚨"} {t.patient}
                  </span>
                  <span className="text-xs text-slate-400">
                    {t.checkedIn ? "✓ in" : "⏳ check-in"} · ~{t.estWaitMins}m
                  </span>
                </li>
              ))}
              {!q.nextTokens.length && <li className="py-4 text-sm text-slate-400">Queue empty.</li>}
            </ul>
          </div>

          <div className="card">
            <h3 className="mb-3 font-bold text-slate-900">Digital Prescription</h3>
            {activeId ? (
              <div className="space-y-3">
                <p className="text-xs text-slate-400">Attaches to token #{activeId}'s record.</p>
                <textarea
                  className="input min-h-[100px]"
                  placeholder="Rx notes: diagnosis, meds, advice…"
                  value={rx.notes}
                  onChange={(e) => setRx({ ...rx, notes: e.target.value })}
                />
                <input
                  ref={fileRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (!f) return;
                    const reader = new FileReader();
                    reader.onload = () => setRx({ ...rx, fileName: f.name, fileBase64: reader.result });
                    reader.readAsDataURL(f);
                  }}
                />
                <button className="btn-ghost w-full" onClick={() => fileRef.current?.click()}>
                  {rx.fileName ? `📎 ${rx.fileName}` : "Attach PDF / image"}
                </button>
                <button className="btn-primary w-full" onClick={() => act(saveRx, "Prescription saved")}>
                  Save Prescription
                </button>
              </div>
            ) : (
              <p className="text-sm text-slate-400">No active patient — call next to attach an Rx.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
