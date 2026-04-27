import http from "http";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import app from "./app.js";
import { port, frontendUrl, socketTokenSecret } from "./config/env.js";
import { registerSocket } from "./services/socketHub.js";
import workerManager from "./services/cameraWorkerManager.js";
import cameraRepository from "./data/cameraRepository.js";

const server = http.createServer(app);

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
  socket.join(`user:${socket.platformUser.userId}`);
  socket.emit("connected", { id: socket.id, connectedAt: new Date().toISOString() });
});

server.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});

process.on("SIGINT", () => {
  workerManager.shutdown();
  process.exit(0);
});

process.on("SIGTERM", () => {
  workerManager.shutdown();
  process.exit(0);
});
