import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { PageTitle, WaitPill } from "../components/widgets.jsx";

export default function Booking() {
  const { id } = useParams();
  const nav = useNavigate();
  const [doc, setDoc] = useState(null);
  const [form, setForm] = useState({ patientName: "", patientPhone: "", shift: "MORNING" });
  const [preview, setPreview] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.doctor(id).then(setDoc).catch((e) => setErr(e.message));
  }, [id]);

  // live preview of next token + estimated wait
  useEffect(() => {
    if (!doc) return;
    let alive = true;
    const tick = async () => {
      try {
        const q = await api.queue(id, form.shift);
        if (!alive) return;
        const nextTok = (q.activeToken ?? 0) + q.nextTokens.length + 1;
        const est = q.nextTokens.length
          ? q.nextTokens[q.nextTokens.length - 1].estWaitMins + (q.avgMins || 12)
          : q.activeToken
            ? q.avgMins || 12
            : 0;
        setPreview({ token: nextTok, est, queueLen: q.nextTokens.length + (q.activeToken ? 1 : 0) });
      } catch {}
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [id, form.shift, doc]);

  async function submit(e) {
    e.preventDefault();
    setErr("");
    if (!form.patientName.trim() || !form.patientPhone.trim()) {
      setErr("Name and phone are required.");
      return;
    }
    setBusy(true);
    try {
      const apt = await api.book({
        doctorId: Number(id),
        clinicId: doc.clinic_id,
        shift: form.shift,
        patientName: form.patientName.trim(),
        patientPhone: form.patientPhone.trim(),
      });
      nav(`/appt/${apt.id}`, { state: { fresh: true } });
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!doc && !err) return <p className="text-slate-400">Loading…</p>;

  return (
    <div className="max-w-xl">
      <PageTitle title="Book a Consultation Token" subtitle={doc ? `${doc.name} · ${doc.speciality}` : ""} />
      {err && <p className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{err}</p>}

      {preview && (
        <div className="mb-5 flex items-center justify-between rounded-2xl border border-dashed border-clinic-300 bg-clinic-50 px-5 py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-clinic-500">Your token will be</p>
            <p className="text-3xl font-black text-clinic-700">#{preview.token}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-clinic-500 font-semibold">{preview.queueLen} already in queue</p>
            <WaitPill mins={preview.est} />
          </div>
        </div>
      )}

      <form onSubmit={submit} className="card space-y-4">
        <div>
          <label className="label">Patient name</label>
          <input
            className="input"
            placeholder="e.g. Priya Sharma"
            value={form.patientName}
            onChange={(e) => setForm({ ...form, patientName: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Mobile number (for SMS alerts)</label>
          <input
            className="input"
            placeholder="9876543210"
            value={form.patientPhone}
            onChange={(e) => setForm({ ...form, patientPhone: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Consultation shift</label>
          <div className="grid grid-cols-2 gap-3">
            {["MORNING", "EVENING"].map((s) => (
              <button
                type="button"
                key={s}
                onClick={() => setForm({ ...form, shift: s })}
                className={`rounded-xl border px-4 py-3 text-sm font-semibold transition ${
                  form.shift === s
                    ? "border-clinic-500 bg-clinic-50 text-clinic-700"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                }`}
              >
                {s === "MORNING" ? "☀️ Morning · 9am–1pm" : "🌙 Evening · 5pm–8pm"}
              </button>
            ))}
          </div>
        </div>
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? "Booking…" : "Confirm Booking"}
        </button>
        <Link to="/" className="block text-center text-sm text-slate-400 hover:text-slate-600">
          ← Back to doctors
        </Link>
      </form>
    </div>
  );
}
