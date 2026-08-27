import cameraRepository from "../data/cameraRepository.js";
import alertRepository from "../data/alertRepository.js";
import { registerUploadResult } from "../services/aiPredictionService.js";
import { emitAlert, emitCamera, emitDashboard } from "../services/socketHub.js";
import { buildGlobalAnalytics } from "../services/globalAnalyticsEngine.js";
import workerManager from "../services/cameraWorkerManager.js";

async function receiveUploadResult(req, res) {
  if (!req.body?.job_id) {
    return res.status(400).json({ message: "job_id is required" });
  }

  await registerUploadResult(req.body.job_id, req.body);

  return res.json({
    status: "ok",
    receivedAt: new Date().toISOString(),
  });
}

/**
 * Ingests a consolidated batch telemetry payload pushed by the Python AI Service at 2 FPS.
 */
async function receiveTelemetryBatch(req, res) {
  const cameraData = req.body?.camera_data || {};
  const userIdsToUpdate = new Set();
  const timestamp = req.body?.timestamp || Date.now() / 1000.0;

  for (const [cameraId, telemetry] of Object.entries(cameraData)) {
    const camera = cameraRepository.getById(cameraId);
    if (!camera) {
      continue;
    }

    const currentMetrics = camera.metrics || {};
    const count = Number(
      telemetry.count ??
      telemetry.current_count ??
      telemetry.people_count ??
      telemetry.sparse_count ??
      currentMetrics.count ??
      0
    );
    const sparseCount = Number(telemetry.sparse_count ?? telemetry.sparseCount ?? count);
    const denseCount = Number(telemetry.dense_count ?? telemetry.denseCount ?? 0);
    const dominantRegime = telemetry.dominant_regime || telemetry.dominantRegime || (denseCount > 0 ? "DENSE" : "SPARSE");
    const pred10m = Number(telemetry.prediction_10min_count ?? telemetry.predicted_crowd ?? count);
    const risk = telemetry.risk || (count > 30 ? "High" : count > 15 ? "Medium" : "Low");
    const riskScore = Number(telemetry.risk_score ?? (count / 30.0).toFixed(2));
    const nowIso = telemetry.updatedAt || telemetry.updated_at || new Date().toISOString();

    const updatedMetrics = {
      ...currentMetrics,
      ...telemetry,
      count,
      current_count: count,
      people_count: count,
      sparse_count: sparseCount,
      dense_count: denseCount,
      dominant_regime: dominantRegime,
      prediction_10min_count: pred10m,
      prediction_10min_risk: telemetry.prediction_10min_risk || (pred10m > 30 ? "HIGH" : pred10m > 15 ? "MEDIUM" : "LOW"),
      prediction_10min_label: telemetry.prediction_10min_label || `Prediction (10 min): ${pred10m > 30 ? "HIGH" : pred10m > 15 ? "MEDIUM" : "LOW"} RISK`,
      risk,
      risk_score: riskScore,
      camera_health: "good",
      processing_status: "streaming",
      updatedAt: nowIso,
      updated_at: nowIso,
    };

    camera.metrics = updatedMetrics;
    camera.lastFrameAt = nowIso;
    cameraRepository.save(camera);

    userIdsToUpdate.add(camera.userId);

    // Emit live camera update via WebSocket
    emitCamera(camera.userId, camera);

    // Trigger alert if high risk
    if (risk === "High" || risk === "Critical") {
      const activeAlerts = alertRepository.listByUser(camera.userId, { limit: 1 });
      const lastAlert = activeAlerts[0];
      const now = Date.now();
      
      // Throttle alerts per camera: maximum 1 alert per 30 seconds
      if (!lastAlert || lastAlert.cameraId !== camera.id || now - new Date(lastAlert.createdAt).getTime() > 30000) {
        const newAlert = alertRepository.create({
          userId: camera.userId,
          cameraId: camera.id,
          zoneName: camera.zoneName,
          severity: risk === "Critical" ? "critical" : "high",
          type: "CROWD_SURGE",
          message: `High density surge detected in ${camera.zoneName} (Count: ${count})`,
          count,
        });
        emitAlert(camera.userId, newAlert);
      }
    }
  }

  // Broadcast updated dashboard summaries to affected user dashboards
  for (const userId of userIdsToUpdate) {
    workerManager.broadcastDashboard(userId);
  }

  return res.json({
    status: "ok",
    processed_cameras: Object.keys(cameraData).length,
    timestamp,
  });
}

export { receiveUploadResult, receiveTelemetryBatch };
