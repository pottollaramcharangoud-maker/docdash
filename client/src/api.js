import React from "react";

const BASE = "/api";

async function req(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  clinics: () => req("/clinics"),
  specialities: () => req("/specialities"),
  doctors: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null && v !== "")
    ).toString();
    return req(`/doctors${q ? `?${q}` : ""}`);
  },
  doctor: (id) => req(`/doctors/${id}`),
  queue: (doctorId, shift) => req(`/queue/${doctorId}?shift=${shift}`),
  book: (body) => req("/appointments", { method: "POST", body }),
  myAppointments: (phone) => req(`/appointments?phone=${encodeURIComponent(phone)}`),
  appointment: (id) => req(`/appointments/${id}`),
  checkin: (id, body) => req(`/appointments/${id}/checkin`, { method: "POST", body }),
  prescription: (id, body) => req(`/appointments/${id}/prescription`, { method: "POST", body }),
  callNext: (id, shift) => req(`/doctors/${id}/call-next`, { method: "POST", body: { shift } }),
  complete: (id, shift) => req(`/doctors/${id}/complete`, { method: "POST", body: { shift } }),
  delay: (id, mins) => req(`/doctors/${id}/delay`, { method: "POST", body: { mins } }),
  skip: (id, shift) => req(`/doctors/${id}/skip`, { method: "POST", body: { shift } }),
  setStatus: (id, status) => req(`/doctors/${id}/status`, { method: "POST", body: { status } }),
  emergency: (id, body) => req(`/doctors/${id}/emergency`, { method: "POST", body }),
  heatmap: (clinic) => req(`/heatmap${clinic ? `?clinic=${clinic}` : ""}`),
};

export function usePoll(fn, ms = 3000) {
  const [data, setData] = React.useState(null);
  const [error, setError] = React.useState(null);
  const ref = React.useRef(fn);
  ref.current = fn;
  React.useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const d = await ref.current();
        if (alive) { setData(d); setError(null); }
      } catch (e) {
        if (alive) setError(e.message);
      }
    };
    tick();
    const t = setInterval(tick, ms);
    return () => { alive = false; clearInterval(t); };
  }, [ms]);
  return { data, error };
}
