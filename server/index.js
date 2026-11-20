// Entry point — HTTP server + Socket.io realtime

import { createServer } from "node:http";
import { createApp } from "./app.js";
import { initRealtime } from "./realtime.js";
import { log } from "./logger.js";

const PORT = process.env.PORT || 4000;

const app = createApp();
const server = createServer(app);
initRealtime(server);

server.listen(PORT, () => {
  log.info("server_started", { port: PORT, url: `http://localhost:${PORT}` });
});
