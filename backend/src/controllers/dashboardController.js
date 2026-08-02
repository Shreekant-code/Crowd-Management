import workerManager from "../services/cameraWorkerManager.js";

function getDashboard(req, res) {
  res.json(workerManager.buildDashboard(req.platformUser.id));
}

function getGlobal(req, res) {
  const dashboard = workerManager.buildDashboard(req.platformUser.id);
  res.json(dashboard.global);
}

function getGlobalSummary(req, res) {
  const dashboard = workerManager.buildDashboard(req.platformUser.id);
  res.json({
    summary: dashboard.summary,
    global: dashboard.global,
    timestamp: dashboard.timestamp,
  });
}

function getGlobalPrediction(req, res) {
  const dashboard = workerManager.buildDashboard(req.platformUser.id);
  res.json({
    globalPrediction: dashboard.global.globalPrediction,
    predictionConfidence: dashboard.global.predictionConfidence,
    overallRisk: dashboard.global.overallRisk,
    overallRiskScore: dashboard.global.overallRiskScore,
    updatedAt: dashboard.global.updatedAt,
  });
}

export { getDashboard, getGlobal, getGlobalSummary, getGlobalPrediction };
