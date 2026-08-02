import http from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import app from "./app.js";
import { port, frontendUrl, socketTokenSecret } from "./config/env.js";
import { registerSocket } from "./services/socketHub.js";
import workerManager from "./services/cameraWorkerManager.js";
import cameraRepository from "./data/cameraRepository.js";

const server = http.createServer(app);
const MAX_PORT_ATTEMPTS = 5;

const io = new Server(server, {
  cors: {
    origin: frontendUrl,
    credentials: true,
  },
});

registerSocket(io);
cameraRepository.resetRunningStatuses();

io.use((socket, next) => {
  const token = socket.handshake.auth?.token;

  if (!token) {
    next(new Error("Missing socket token"));
    return;
  }

  try {
    const payload = jwt.verify(token, socketTokenSecret);
    socket.platformUser = payload;
    next();
  } catch (_error) {
    next(new Error("Invalid socket token"));
  }
});

io.on("connection", (socket) => {
  socket.join(`user:${socket.platformUser.id}`);
  socket.emit("connected", { id: socket.id, connectedAt: new Date().toISOString() });
});

function shutdown(code = 0) {
  try {
    workerManager.shutdown();
  } finally {
    process.exit(code);
  }
}

function listenOnPort(targetPort, attempt = 0) {
  process.env.PORT = String(targetPort);

  const onError = (error) => {
    server.off("error", onError);

    if (error?.code === "EADDRINUSE" && attempt + 1 < MAX_PORT_ATTEMPTS) {
      const nextPort = targetPort + 1;
      console.warn(`Port ${targetPort} is busy, trying ${nextPort}...`);
      listenOnPort(nextPort, attempt + 1);
      return;
    }

    if (error?.code === "EADDRINUSE") {
      console.error(`No free port found starting from ${targetPort}. Stop the existing backend process and try again.`);
      shutdown(1);
      return;
    }

    console.error("Backend server error:", error);
    shutdown(1);
  };

  server.once("error", onError);
  server.listen(targetPort, () => {
    console.log(`Backend listening on http://localhost:${targetPort}`);
  });
}

listenOnPort(port);

process.on("SIGINT", () => {
  shutdown(0);
});

process.on("SIGTERM", () => {
  shutdown(0);
});
