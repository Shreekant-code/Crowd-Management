import { v4 as uuidv4 } from "uuid";
import cameraRepository from "../data/cameraRepository.js";
import alertRepository from "../data/alertRepository.js";
import { aiStreamPollIntervalMs } from "../config/env.js";
import { mockPredict } from "../utils/mockPredict.js";
import { emitAlert, emitCamera, emitDashboard } from "./socketHub.js";
import { stopStreamAnalysis } from "./aiPredictionService.js";

function buildResetMetrics(previousMetrics = {}) {
  return {
    ...previousMetrics,
    count: 0,
    current_count: 0,
    total_count: 0,
    people_count: 0,
    active_track_ids: [],
    detections: [],
    heatmap_points: [],
    alerts: [],
    zone_counts: { left: 0, center: 0, right: 0 },
    line_crossing: { entry: 0, exit: 0 },
    crowd_features: {
      density_score: 0,
      movement_score: 0,
      congestion_score: 0,
      hotspot_ratio: 0,
    },
    risk_score: 0,
    risk: "Low",
    processing_status: "idle",
    updatedAt: new Date().toISOString(),
  };
}

class CameraWorkerManager {
  constructor() {
    this.workers = new Map();
    this.alertCache = new Map();
  }

  buildDashboard(userId) {
    const cameras = cameraRepository.listByUser(userId);
    const summary = cameras.reduce(
      (acc, camera) => {
        acc.totalZones += 1;
        acc.activeZones += camera.status === "running" ? 1 : 0;
        acc.totalCount += getLiveCount(camera.metrics);
        if (["High", "Critical"].includes(camera.metrics?.risk)) {
          acc.highRiskZones += 1;
        }
        return acc;
      },
      { totalZones: 0, activeZones: 0, totalCount: 0, highRiskZones: 0 }
    );

    return {
      summary,
      cameras,
      alerts: alertRepository.listByUser(userId),
      timestamp: new Date().toISOString(),
    };
  }

  broadcastDashboard(userId) {
    emitDashboard(userId, this.buildDashboard(userId));
  }

  addCamera(camera) {
    cameraRepository.save(camera);
    this.broadcastDashboard(camera.userId);
    return camera;
  }

  startCamera(id, userId) {
    const camera = cameraRepository.getByUser(id, userId);
    if (!camera) {
      throw new Error("Camera not found");
    }

    if (this.workers.has(id)) {
      return camera;
    }

    camera.status = "running";
    camera.lastStartedAt = new Date().toISOString();
    camera.metrics = buildResetMetrics(camera.metrics);
    cameraRepository.save(camera);
    emitCamera(userId, camera);

    const runPrediction = async () => {
      const worker = this.workers.get(id);
      if (!worker || worker.busy) {
        return;
      }

      worker.busy = true;

      try {
        const prediction = await mockPredict({
          sourceType: "rtsp",
          source: camera.streamUrl,
          cameraId: camera.id,
          userId,
          zoneName: camera.zoneName,
        });

        const frameSignature = prediction.frame_id
          ? `${prediction.frame_id}:${prediction.updated_at || ""}`
          : prediction.updated_at || null;

        if (frameSignature && worker.lastFrameSignature === frameSignature) {
          return;
        }

        worker.lastFrameSignature = frameSignature;

        camera.metrics = {
          ...camera.metrics,
          ...prediction,
          count: getLiveCount(prediction),
          current_count: getLiveCount(prediction),
          total_count: Number.isFinite(prediction.total_count)
            ? prediction.total_count
            : (camera.metrics?.total_count ?? 0),
          risk: prediction.risk || "Low",
          updatedAt: prediction.updated_at || new Date().toISOString(),
        };
        camera.lastFrameAt = camera.metrics.updatedAt;
        cameraRepository.save(camera);
        emitCamera(userId, camera);

        for (const alert of this.buildAlertsFromPrediction(prediction, camera, userId)) {
          alertRepository.add(alert);
          emitAlert(userId, alert);
        }

        this.broadcastDashboard(userId);
      } catch (error) {
        console.error(`[camera-worker] prediction failed for ${camera.id}`);
        console.error(error.message);
      } finally {
        const latestWorker = this.workers.get(id);
        if (latestWorker) {
          latestWorker.busy = false;
        }
      }
    };

    const worker = {
      busy: false,
      lastFrameSignature: null,
      timer: setInterval(() => {
        void runPrediction();
      }, aiStreamPollIntervalMs),
    };

    this.workers.set(id, worker);
    void runPrediction();
    this.broadcastDashboard(userId);
    return camera;
  }

  stopCamera(id, userId) {
    const camera = cameraRepository.getByUser(id, userId);
    if (!camera) {
      throw new Error("Camera not found");
    }

    const worker = this.workers.get(id);
    if (worker) {
      clearInterval(worker.timer);
      this.workers.delete(id);
    }

    void stopStreamAnalysis(id);
    this.alertCache.delete(id);

    camera.status = "stopped";
    camera.metrics = buildResetMetrics(camera.metrics);
    camera.lastFrameAt = camera.metrics.updatedAt;
    cameraRepository.save(camera);
    emitCamera(userId, camera);
    this.broadcastDashboard(userId);
    return camera;
  }

  deleteCamera(id, userId) {
    this.stopCamera(id, userId);
    const removed = cameraRepository.remove(id);
    this.broadcastDashboard(userId);
    return removed;
  }

  shutdown() {
    for (const [cameraId, worker] of this.workers.entries()) {
      clearInterval(worker.timer);
      void stopStreamAnalysis(cameraId);
    }
    this.workers.clear();
    this.alertCache.clear();
  }

  buildAlertsFromPrediction(prediction, camera, userId) {
    const alerts = Array.isArray(prediction.alerts) && prediction.alerts.length
      ? prediction.alerts.map((alert) => ({
          id: uuidv4(),
          userId,
          cameraId: camera.id,
          zoneName: camera.zoneName,
          message:
            alert.message ||
            `${camera.zoneName} reported ${alert.risk || prediction.risk || "Medium"} crowd density`,
          risk: alert.risk || prediction.risk || "Medium",
          count:
            alert.count ??
            getLiveCount(prediction) ??
            getLiveCount(camera.metrics) ??
            0,
          createdAt: new Date().toISOString(),
          type: alert.type || "overcrowding",
        }))
      : ["High", "Critical"].includes(prediction.risk)
        ? [
            {
              id: uuidv4(),
              userId,
              cameraId: camera.id,
              zoneName: camera.zoneName,
              message: `${camera.zoneName} reported ${prediction.risk} crowd density`,
              risk: prediction.risk,
              count: getLiveCount(prediction),
              createdAt: new Date().toISOString(),
              type: "overcrowding",
            },
          ]
        : [];

    return alerts.filter((alert) => this.registerAlert(camera.id, alert));
  }

  registerAlert(cameraId, alert) {
    const cache = this.alertCache.get(cameraId) || new Map();
    const signature = `${alert.type}:${alert.message}:${alert.risk}:${alert.count}`;
    const now = Date.now();
    const lastSeen = cache.get(signature);

    for (const [key, timestamp] of cache.entries()) {
      if (now - timestamp > 15000) {
        cache.delete(key);
      }
    }

    if (lastSeen && now - lastSeen < 15000) {
      this.alertCache.set(cameraId, cache);
      return false;
    }

    cache.set(signature, now);
    this.alertCache.set(cameraId, cache);
    return true;
  }
}

function getLiveCount(metrics = {}) {
  if (Number.isFinite(metrics?.current_count)) {
    return metrics.current_count;
  }

  if (Number.isFinite(metrics?.count)) {
    return metrics.count;
  }

  if (Number.isFinite(metrics?.people_count)) {
    return metrics.people_count;
  }

  return 0;
}

export default new CameraWorkerManager();
