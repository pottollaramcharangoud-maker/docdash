import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { PageTitle, StatusBadge, WaitPill } from "../components/widgets.jsx";

export default function MyAppointments() {
  const [phone, setPhone] = useState(localStorage.getItem("dd_phone") || "");
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function search(e) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      const rows = await api.myAppointments(phone.trim());
      setList(rows);
      localStorage.setItem("dd_phone", phone.trim());
    } catch (e) {
      setErr(e.message);
      setList([]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <PageTitle title="My Appointments" subtitle="Look up booked tokens by the mobile number used at booking." />
      <form onSubmit={search} className="mb-6 flex max-w-md gap-2">
        <input
          className="input"
          placeholder="Enter mobile number"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />
        <button className="btn-primary shrink-0" disabled={busy}>
          {busy ? "…" : "Search"}
        </button>
      </form>
      {err && <p className="mb-4 text-sm text-rose-600">{err}</p>}

      <div className="space-y-3">
        {list?.map((a) => (
          <Link
            key={a.id}
            to={`/appt/${a.id}`}
            className="card flex flex-wrap items-center justify-between gap-4 hover:shadow-md transition"
          >
            <div>
              <p className="font-bold text-slate-900">
                #{a.tokenNo} · {a.doctorName}
                {a.isEmergency && " 🚨"}
              </p>
              <p className="text-sm text-slate-500">
                {a.speciality} · {a.clinicName} ({a.clinicBranch}) · {a.shift}
              </p>
              <p className="text-xs text-slate-400">Booked {a.createdAt}</p>
            </div>
            <div className="flex items-center gap-3">
              {(a.status === "WAITING" || a.status === "IN_CONSULTATION") && <WaitPill mins={a.waitMins} />}
              <StatusBadge status={a.status} />
            </div>
          </Link>
        ))}
        {list && !list.length && (
          <p className="py-8 text-center text-slate-400">No appointments found for this number.</p>
        )}
        {!list && (
          <p className="py-8 text-center text-slate-400">
            Try demo number <button className="font-semibold text-clinic-600 underline"
              onClick={() => { setPhone("9000000014"); }}>9000000014</button>
          </p>
        )}
      </div>
    </div>
  );
}
