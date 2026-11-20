// Socket.io realtime hub — event bus decoupled from HTTP layer

import { EventEmitter } from "node:events";
import { Server } from "socket.io";
import { log } from "./logger.js";

/** Domain event bus: services/routes emit, Socket.io (when attached) forwards to clients. */
export const bus = new EventEmitter();
bus.setMaxListeners(100);

export function emitQueueEvent(payload) {
  const event = { ...payload, ts: Date.now() };
  log.debug("queue_event", event);
  bus.emit("queue", event);
}

let io = null;

export function initRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: true },
    transports: ["websocket", "polling"],
  });

  io.on("connection", (socket) => {
    log.info("socket_connected", { id: socket.id });
    socket.on("watch:doctor", (doctorId) => {
      if (Number.isInteger(doctorId) && doctorId > 0) socket.join(`doctor:${doctorId}`);
    });
    socket.on("unwatch:doctor", (doctorId) => socket.leave(`doctor:${doctorId}`));
    socket.on("disconnect", () => log.debug("socket_disconnected", { id: socket.id }));
  });

  // Forward every domain event to interested clients
  bus.on("queue", (event) => {
    if (!io) return;
    if (event.doctorId) io.to(`doctor:${event.doctorId}`).emit("queue:update", event);
    io.emit("queue:update", event); // global listeners (directory, boards)
  });

  log.info("realtime_ready", { transport: "socket.io" });
  return io;
}

export function getIO() {
  return io;
}
