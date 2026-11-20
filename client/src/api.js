const BASE = "/api";

async function req(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    const message =
      err.details?.length
        ? `${err.error}: ${err.details.map((d) => d.messages?.join(", ")).join("; ")}`
        : err.error || `Request failed (${res.status})`;
    const error = new Error(message);
    error.code = err.code;
    error.details = err.details;
    throw error;
  }
  return res.json();
}

export const api = {
  clinics: () => req("/clinics"),
  specialities: () => req("/specialities"),
  shifts: () => req("/shifts"),
  health: () => req("/health"),
  doctors: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null && v !== "")
    ).toString();
    return req(`/doctors${q ? `?${q}` : ""}`);
  },
  doctor: (id) => req(`/doctors/${id}`),
  queue: (doctorId, shift, date) =>
    req(`/queue/${doctorId}?shift=${shift}${date ? `&date=${date}` : ""}`),
  book: (body) => req("/appointments", { method: "POST", body }),
  myAppointments: (phone, page = 1, limit = 10) =>
    req(`/appointments?phone=${encodeURIComponent(phone)}&page=${page}&limit=${limit}`),
  appointment: (id) => req(`/appointments/${id}`),
  history: (params = {}) => {
    const q = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v != null && v !== "")
    ).toString();
    return req(`/appointments/history${q ? `?${q}` : ""}`);
  },
  checkin: (id, body) => req(`/appointments/${id}/checkin`, { method: "POST", body }),
  prescription: (id, body) => req(`/appointments/${id}/prescription`, { method: "POST", body }),
  callNext: (id, shift) => req(`/doctors/${id}/call-next`, { method: "POST", body: { shift } }),
  complete: (id) => req(`/doctors/${id}/complete`, { method: "POST", body: {} }),
  delay: (id, mins) => req(`/doctors/${id}/delay`, { method: "POST", body: { mins } }),
  skip: (id, shift) => req(`/doctors/${id}/skip`, { method: "POST", body: { shift } }),
  setStatus: (id, status) => req(`/doctors/${id}/status`, { method: "POST", body: { status } }),
  emergency: (id, body) => req(`/doctors/${id}/emergency`, { method: "POST", body }),
  active: (id, shift) => req(`/doctors/${id}/active?shift=${shift}`),
  heatmap: (clinic) => req(`/heatmap${clinic ? `?clinic=${clinic}` : ""}`),
};
