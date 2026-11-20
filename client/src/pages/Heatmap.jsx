import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PageTitle } from "../components/widgets.jsx";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HOURS = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];

function colorFor(mins) {
  if (mins <= 15) return "bg-emerald-200 text-emerald-900";
  if (mins <= 25) return "bg-emerald-100 text-emerald-800";
  if (mins <= 35) return "bg-amber-100 text-amber-800";
  if (mins <= 45) return "bg-amber-200 text-amber-900";
  if (mins <= 55) return "bg-orange-200 text-orange-900";
  return "bg-rose-300 text-rose-900";
}

export default function Heatmap() {
  const [clinics, setClinics] = useState([]);
  const [clinic, setClinic] = useState("");
  const [rows, setRows] = useState([]);
  const [best, setBest] = useState(null);

  useEffect(() => {
    api.clinics().then(setClinics);
  }, []);

  useEffect(() => {
    api.heatmap(clinic).then((r) => {
      setRows(r);
      // best slot = lowest avg wait across selected scope
      const bySlot = {};
      r.forEach((x) => {
        const k = `${x.day_of_week}-${x.hour}`;
        bySlot[k] = (bySlot[k] || 0) + x.avg_wait_mins;
      });
      const n = clinic ? 1 : new Set(r.map((x) => x.clinic_id)).size || 1;
      let minK = null;
      let minV = Infinity;
      Object.entries(bySlot).forEach(([k, v]) => {
        const avg = v / n;
        if (avg < minV) { minV = avg; minK = k; }
      });
      if (minK) {
        const [d, h] = minK.split("-").map(Number);
        setBest({ day: d, hour: h, mins: Math.round(minV) });
      }
    });
  }, [clinic]);

  // grid[day][hour] = avg
  const grid = {};
  rows.forEach((x) => {
    grid[x.day_of_week] ??= {};
    grid[x.day_of_week][x.hour] ??= [];
    grid[x.day_of_week][x.hour].push(x.avg_wait_mins);
  });

  return (
    <div>
      <PageTitle
        title="Clinic Wait-Time Heatmap"
        subtitle="Historical average waits by day & hour — pick a low-traffic slot before you book."
      />

      <div className="mb-4 flex gap-3">
        <select className="input max-w-xs" value={clinic} onChange={(e) => setClinic(e.target.value)}>
          <option value="">All clinics</option>
          {clinics.map((c) => (
            <option key={c.id} value={c.id}>{c.name} — {c.branch}</option>
          ))}
        </select>
      </div>

      {best && (
        <div className="mb-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm">
          <strong className="text-emerald-800">Best slot:</strong>{" "}
          <span className="text-emerald-900">
            {DAY_LABELS[best.day]} at {best.hour}:00 — avg only ~{best.mins} min wait
          </span>
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="w-full border-separate" style={{ borderSpacing: "4px" }}>
          <thead>
            <tr>
              <th className="p-2 text-left text-xs font-bold uppercase text-slate-400">Day</th>
              {HOURS.map((h) => (
                <th key={h} className="p-1 text-center text-[10px] font-bold text-slate-400">
                  {h}h
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {DAY_LABELS.map((label, d) => (
              <tr key={d}>
                <td className="pr-3 text-sm font-semibold text-slate-600">{label}</td>
                {HOURS.map((h) => {
                  const vals = grid[d]?.[h];
                  const avg = vals ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
                  return (
                    <td
                      key={h}
                      title={avg != null ? `${label} ${h}:00 — avg ${Math.round(avg)} min` : "No data"}
                      className={`h-11 min-w-[46px] rounded-lg text-center text-xs font-bold ${
                        avg != null ? colorFor(avg) : "bg-slate-50 text-slate-300"
                      }`}
                    >
                      {avg != null ? Math.round(avg) : "–"}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 flex items-center gap-2 text-xs text-slate-500">
          <span>Fast</span>
          <span className="h-3 w-6 rounded bg-emerald-200" />
          <span className="h-3 w-6 rounded bg-amber-100" />
          <span className="h-3 w-6 rounded bg-orange-200" />
          <span className="h-3 w-6 rounded bg-rose-300" />
          <span>Slow (mins)</span>
        </div>
      </div>
    </div>
  );
}
