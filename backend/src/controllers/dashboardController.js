import workerManager from "../services/cameraWorkerManager.js";

function getDashboard(req, res) {
  res.json(workerManager.buildDashboard(req.platformUser.id));
}

export { getDashboard };
