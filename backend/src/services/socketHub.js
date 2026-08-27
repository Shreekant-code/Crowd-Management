let io;

function registerSocket(serverInstance) {
  io = serverInstance;
}

function getSocket() {
  return io;
}

function emitDashboard(userId, payload) {
  if (io) {
    if (userId) {
      io.to(`user:${userId}`).emit("dashboard:update", payload);
    }
    io.emit("dashboard:update", payload);
  }
}

function emitCamera(userId, camera) {
  if (io) {
    if (userId) {
      io.to(`user:${userId}`).emit("camera:update", camera);
    }
    io.emit("camera:update", camera);
  }
}

function emitAlert(userId, alert) {
  if (io) {
    if (userId) {
      io.to(`user:${userId}`).emit("alert:new", alert);
    }
    io.emit("alert:new", alert);
  }
}

function emitGlobal(userId, payload) {
  if (io) {
    if (userId) {
      io.to(`user:${userId}`).emit("global:update", payload);
      io.to(`user:${userId}`).emit("global:prediction", payload?.globalPrediction || payload);
      io.to(`user:${userId}`).emit("dashboard:summary", payload);
    }
    io.emit("global:update", payload);
    io.emit("global:prediction", payload?.globalPrediction || payload);
    io.emit("dashboard:summary", payload);
  }
}

export { registerSocket, getSocket, emitDashboard, emitCamera, emitAlert, emitGlobal };
