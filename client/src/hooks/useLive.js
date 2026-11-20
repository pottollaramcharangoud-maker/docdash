import { useEffect, useRef, useState, useCallback } from "react";
import { io } from "socket.io-client";

// Singleton socket — connects once, reuses across hooks
let socket = null;
function getSocket() {
  if (!socket) {
    socket = io({ transports: ["websocket", "polling"], reconnection: true });
  }
  return socket;
}

/**
 * Live data hook: Socket.io push + polling fallback.
 * - Subscribes to `queue:update` events (optionally scoped to a doctor room)
 * - Falls back to interval polling if the socket disconnects
 * - Exposes `live` so the UI can show LIVE vs POLLING status
 *
 * @param {(signal?: {aborted: boolean}) => Promise<any>} fetcher
 * @param {{ interval?: number, doctorId?: number|null, enabled?: boolean }} opts
 */
export function useLive(fetcher, { interval = 3000, doctorId = null, enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [live, setLive] = useState(false);
  const [updatedAt, setUpdatedAt] = useState(null);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const aliveRef = useRef(true);

  const refresh = useCallback(async () => {
    try {
      const d = await fetcherRef.current();
      if (aliveRef.current) {
        setData(d);
        setError(null);
        setUpdatedAt(Date.now());
      }
    } catch (e) {
      if (aliveRef.current) setError(e.message);
    }
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    if (!enabled) return () => { aliveRef.current = false; };

    refresh();

    // Polling: fast when socket is down, slow safety-net when live
    const pollMs = interval;
    const timer = setInterval(refresh, pollMs);

    const s = getSocket();
    const onQueueUpdate = (event) => {
      // Ignore events for other doctors when scoped
      if (doctorId && event.doctorId && event.doctorId !== Number(doctorId)) return;
      refresh();
    };
    const onConnect = () => {
      setLive(true);
      if (doctorId) s.emit("watch:doctor", Number(doctorId));
      refresh();
    };
    const onDisconnect = () => setLive(false);

    s.on("connect", onConnect);
    s.on("disconnect", onDisconnect);
    s.on("queue:update", onQueueUpdate);
    if (s.connected) onConnect();
    if (doctorId) s.emit("watch:doctor", Number(doctorId));

    return () => {
      aliveRef.current = false;
      clearInterval(timer);
      s.off("connect", onConnect);
      s.off("disconnect", onDisconnect);
      s.off("queue:update", onQueueUpdate);
      if (doctorId) s.emit("unwatch:doctor", Number(doctorId));
    };
  }, [refresh, interval, doctorId, enabled]);

  return { data, error, live, updatedAt, refresh };
}
