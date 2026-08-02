let io;

function registerSocket(serverInstance) {
  io = serverInstance;
}

function getSocket() {
  return io;
}

function emitDashboard(userId, payload) {
  if (io) {
    io.to(`user:${userId}`).emit("dashboard:update", payload);
  }
}

function emitCamera(userId, camera) {
  if (io) {
    io.to(`user:${userId}`).emit("camera:update", camera);
  }
}

function emitAlert(userId, alert) {
  if (io) {
    io.to(`user:${userId}`).emit("alert:new", alert);
  }
}

function emitGlobal(userId, payload) {
  if (io) {
    io.to(`user:${userId}`).emit("global:update", payload);
    io.to(`user:${userId}`).emit("global:prediction", payload?.globalPrediction || payload);
    io.to(`user:${userId}`).emit("dashboard:summary", payload);
  }
}

export { registerSocket, getSocket, emitDashboard, emitCamera, emitAlert, emitGlobal };
