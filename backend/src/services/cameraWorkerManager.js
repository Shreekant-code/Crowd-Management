import { v4 as uuidv4 } from "uuid";
import cameraRepository from "../data/cameraRepository.js";
import alertRepository from "../data/alertRepository.js";
import { aiStreamPollIntervalMs } from "../config/env.js";
import { mockPredict } from "../utils/mockPredict.js";
import { resolveSourceInput } from "../utils/sourceResolver.js";
import { emitAlert, emitCamera, emitDashboard, emitGlobal } from "./socketHub.js";
import { buildGlobalAnalytics } from "./globalAnalyticsEngine.js";
import { ensureStreamStarted, stopStreamAnalysis } from "./aiPredictionService.js";
import { ensureMediaMtxPath, removeMediaMtxPath, getWhepUrl } from "./mediaGateway.js";
import { getLocalRtspUrl, isIngestibleSource, shutdownAllIngests } from "./streamIngestor.js";

function getRandomCount() {
  return Math.floor(Math.random() * 8) + 5; // 5 to 12
}

function buildResetMetrics(previousMetrics = {}) {
  const initialCount = previousMetrics?.current_count || getRandomCount();
  const left = Math.floor(initialCount / 3);
  const right = Math.floor(initialCount / 3);
  const center = initialCount - left - right;

  return {
    ...previousMetrics,
    count: initialCount,
    current_count: initialCount,
    total_count: Math.max(previousMetrics?.total_count || 0, initialCount + Math.floor(Math.random() * 10) + 5),
    people_count: initialCount,
    active_track_ids: Array.from({ length: initialCount }, (_, i) => i + 1),
    detections: previousMetrics?.detections || [],
    heatmap_points: previousMetrics?.heatmap_points || [],
    alerts: previousMetrics?.alerts || [],
    zone_counts: previousMetrics?.zone_counts || { left, center, right },
    line_crossing: previousMetrics?.line_crossing || { entry: 1, exit: 0 },
    crowd_features: previousMetrics?.crowd_features || {
      density_score: Number((initialCount / 20).toFixed(2)),
      movement_score: 0.15,
      congestion_score: Number((initialCount / 25).toFixed(2)),
      hotspot_ratio: 0.35,
    },
    prediction_10min_count: initialCount + Math.floor(Math.random() * 4) + 1,
    prediction_10min_risk: "LOW",
    prediction_10min_label: "Prediction (10 min): LOW RISK",
    prediction_horizon_minutes: 10,
    risk_score: Number((initialCount / 25).toFixed(2)),
    risk: previousMetrics?.risk || "Low",
    confidence: 0.85,
    latency_ms: 45,
    inference_ms: 30,
    camera_health: "good",
    processing_status: "idle",
    updatedAt: new Date().toISOString(),
  };
}

class CameraWorkerManager {
  constructor() {
    this.workers = new Map();
    this.alertCache = new Map();
    this.resolutionCache = new Map();
  }

  createWorkerState(camera) {
    return {
      cameraId: camera.id,
      userId: camera.userId,
      paused: false,
      stopped: false,
      busy: false,
      timer: null,
      lastFrameSignature: null,
      lastResolvedStreamUrl: null,
      lastResolvedAt: 0,
      lastResolutionStatus: "idle",
      consecutiveFailures: 0,
      lastError: null,
    };
  }

  getWorker(id) {
    return this.workers.get(id) || null;
  }

  clearWorkerTimer(worker) {
    if (worker?.timer) {
      clearTimeout(worker.timer);
      worker.timer = null;
    }
  }

  getResolutionStatusLabel(camera, resolvedUrl) {
    if (isIngestibleSource(camera?.streamUrl)) {
      return "youtube_resolved";
    }

    const sourceType = String(camera?.sourceType || "").toLowerCase();
    if (sourceType === "public") {
      return resolvedUrl && resolvedUrl !== camera.streamUrl ? "youtube_resolved" : "resolved";
    }

    if (resolvedUrl && resolvedUrl !== camera.streamUrl) {
      return "public_resolved";
    }

    return "resolved";
  }

  updateCameraResolutionStatus(camera, userId, status, extras = {}) {
    const webrtcUrl = getWhepUrl(camera.id);
    const nextMetrics = {
      ...(camera.metrics || {}),
      stream_resolution_status: status,
      stream_resolution_error: extras.error || null,
      webrtc_url: webrtcUrl,
      processing_status: extras.processing_status || camera.metrics?.processing_status || camera.status || "idle",
      updatedAt: new Date().toISOString(),
    };

    camera.metrics = nextMetrics;
    camera.webrtcUrl = webrtcUrl;
    cameraRepository.save(camera);
    emitCamera(userId, camera);
    this.broadcastDashboard(userId);

    const worker = this.getWorker(camera.id);
    if (worker) {
      worker.lastResolutionStatus = status;
      worker.lastError = extras.error || null;
      if (extras.resolvedUrl) {
        worker.lastResolvedStreamUrl = isIngestibleSource(camera.streamUrl)
          ? getLocalRtspUrl(camera.id)
          : extras.resolvedUrl;
        worker.lastResolvedAt = Date.now();
        if (camera.status === "running") {
          void ensureMediaMtxPath(camera.id, camera.streamUrl);
        }
      }
    } else if (extras.resolvedUrl && camera.status === "running") {
      void ensureMediaMtxPath(camera.id, camera.streamUrl);
    }
  }

  warmupCameraSource(camera, userId) {
    const normalizedType = String(camera.sourceType || "").toLowerCase();
    if (!["public", "http", "hls", "mjpeg", "webcam"].includes(normalizedType)) {
      return;
    }

    const worker = this.getWorker(camera.id);
    if (worker?.lastResolutionStatus === "resolving") {
      return;
    }

    if (worker) {
      worker.lastResolutionStatus = "resolving";
    }

    this.updateCameraResolutionStatus(camera, userId, "connecting", {
      processing_status: camera.status === "running" ? "warming_up" : "idle",
    });

    const cacheKey = `${normalizedType}:${camera.streamUrl}`;
    const cachedPromise = this.resolutionCache.get(cacheKey);
    if (cachedPromise) {
      cachedPromise
        .then((resolvedUrl) => {
          const latestCamera = cameraRepository.getByUser(camera.id, userId);
          if (!latestCamera || !resolvedUrl) {
            return;
          }
          this.updateCameraResolutionStatus(latestCamera, userId, this.getResolutionStatusLabel(latestCamera, resolvedUrl), {
            resolvedUrl,
            processing_status: latestCamera.status === "running" ? "running" : "idle",
          });
        })
        .catch((error) => {
          const latestCamera = cameraRepository.getByUser(camera.id, userId);
          if (!latestCamera) {
            return;
          }
          this.updateCameraResolutionStatus(latestCamera, userId, "unresolved", {
            error: error.message,
            processing_status: latestCamera.status === "running" ? "warming_up" : "idle",
          });
        });
      return;
    }

    const resolutionPromise = resolveSourceInput({
      sourceUrl: camera.streamUrl,
      sourceType: camera.sourceType,
    });
    this.resolutionCache.set(cacheKey, resolutionPromise);

    resolutionPromise
      .then((plan) => {
        const latestCamera = cameraRepository.getByUser(camera.id, userId);
        if (!latestCamera) {
          return;
        }
        this.updateCameraResolutionStatus(latestCamera, userId, this.getResolutionStatusLabel(latestCamera, plan.playableUrl || latestCamera.streamUrl), {
          resolvedUrl: plan.playableUrl || latestCamera.streamUrl,
          error: plan.resolutionError || null,
          processing_status: latestCamera.status === "running" ? "running" : "idle",
        });
      })
      .catch((error) => {
        const latestCamera = cameraRepository.getByUser(camera.id, userId);
        if (!latestCamera) {
          return;
        }
        this.updateCameraResolutionStatus(latestCamera, userId, "unresolved", {
          error: error.message,
          processing_status: latestCamera.status === "running" ? "warming_up" : "idle",
        });
      })
      .finally(() => {
        this.resolutionCache.delete(cacheKey);
      });
  }

  scheduleNextRun(id, delay = 5000) {
    const worker = this.getWorker(id);
    if (!worker || worker.stopped || worker.paused) {
      return;
    }

    this.clearWorkerTimer(worker);
    worker.timer = setTimeout(() => {
      void this.runWorkerTick(id);
    }, Math.max(delay, 5000));
  }

  async resolveCameraStream(camera, worker) {
    if (isIngestibleSource(camera.streamUrl)) {
      const localRtsp = getLocalRtspUrl(camera.id);
      worker.lastResolvedStreamUrl = localRtsp;
      worker.lastResolvedAt = Date.now();
      worker.lastResolvedSourceUrl = camera.streamUrl;
      worker.lastResolvedSourceType = camera.sourceType;
      return localRtsp;
    }

    const needsRefresh =
      !worker.lastResolvedStreamUrl
      || worker.lastResolvedAt <= 0
      || worker.lastResolvedAt + 5 * 60 * 1000 < Date.now()
      || worker.lastResolvedSourceUrl !== camera.streamUrl
      || worker.lastResolvedSourceType !== camera.sourceType;

    if (!needsRefresh) {
      return worker.lastResolvedStreamUrl;
    }

    try {
      const plan = await resolveSourceInput({
        sourceUrl: camera.streamUrl,
        sourceType: camera.sourceType,
      });

      const resolved = plan.playableUrl || camera.streamUrl;
      worker.lastResolvedStreamUrl = resolved;
      worker.lastResolvedAt = Date.now();
      worker.lastResolvedSourceUrl = camera.streamUrl;
      worker.lastResolvedSourceType = camera.sourceType;
      worker.lastError = plan.resolutionError || null;
      worker.consecutiveFailures = plan.isValid ? 0 : worker.consecutiveFailures + 1;
      return resolved;
    } catch (error) {
      worker.lastError = error.message;
      worker.consecutiveFailures += 1;
      console.error(`[camera-worker] stream resolution failed for ${camera.id}`);
      console.error(error.message);
      const normalizedType = String(camera.sourceType || "").toLowerCase();
      if (["public", "hls", "mjpeg"].includes(normalizedType)) {
        return worker.lastResolvedStreamUrl || null;
      }
      return worker.lastResolvedStreamUrl || camera.streamUrl;
    }
  }

  async runWorkerTick(id) {
    const worker = this.getWorker(id);
    if (!worker || worker.stopped || worker.paused || worker.busy) {
      return;
    }

    const camera = cameraRepository.getByUser(id, worker.userId);
    if (!camera) {
      this.stopWorkerOnly(id);
      return;
    }

    worker.busy = true;

    try {
      const playableStreamUrl = await this.resolveCameraStream(camera, worker);
      if (!playableStreamUrl) {
        camera.metrics = {
          ...camera.metrics,
          stream_resolution_status: worker.lastResolutionStatus || "connecting",
          processing_status: "warming_up",
          camera_health: worker.consecutiveFailures > 3 ? "degraded" : "connecting",
          updatedAt: new Date().toISOString(),
        };
        cameraRepository.save(camera);
        emitCamera(worker.userId, camera);
        this.broadcastDashboard(worker.userId);
        return;
      }

      const prediction = await mockPredict({
        sourceType: camera.sourceType || "rtsp",
        source: playableStreamUrl,
        cameraId: camera.id,
        userId: worker.userId,
        zoneName: camera.zoneName,
      });

      if (worker.stopped || worker.paused) {
        return;
      }

      const frameSignature = prediction.frame_id
        ? `${prediction.frame_id}:${prediction.updated_at || ""}`
        : prediction.updated_at || null;

      if (frameSignature && worker.lastFrameSignature === frameSignature) {
        return;
      }

      worker.lastFrameSignature = frameSignature;
      worker.consecutiveFailures = 0;

      const predCount = getLiveCount(prediction);
      const isTemporaryStatus =
        ["warming_up", "connecting", "mock_fallback"].includes(prediction.processing_status) ||
        Boolean(prediction.fallback_reason);
      const effectiveCount = isTemporaryStatus && predCount === 0 && (camera.metrics?.current_count ?? 0) > 0
        ? (camera.metrics?.current_count ?? camera.metrics?.count ?? 0)
        : predCount;

      camera.status = "running";
      camera.metrics = {
        ...camera.metrics,
        ...prediction,
        count: effectiveCount,
        current_count: effectiveCount,
        people_count: effectiveCount,
        total_count: Number.isFinite(prediction.total_count) && prediction.total_count > 0
          ? Math.max(prediction.total_count, camera.metrics?.total_count ?? 0)
          : (camera.metrics?.total_count ?? 0),
        risk: prediction.risk || camera.metrics?.risk || "Low",
        confidence: prediction.confidence ?? camera.metrics?.confidence ?? 0,
        latency_ms: prediction.latency_ms ?? camera.metrics?.latency_ms ?? 0,
        inference_ms: prediction.inference_ms ?? camera.metrics?.inference_ms ?? 0,
        camera_health: prediction.camera_health || camera.metrics?.camera_health || "good",
        processing_status: prediction.processing_status || "running",
        updatedAt: prediction.updated_at || new Date().toISOString(),
      };
      camera.lastFrameAt = camera.metrics.updatedAt;
      cameraRepository.save(camera);
      emitCamera(worker.userId, camera);

      for (const alert of this.buildAlertsFromPrediction(prediction, camera, worker.userId)) {
        alertRepository.add(alert);
        emitAlert(worker.userId, alert);
      }

      this.broadcastDashboard(worker.userId);
    } catch (error) {
      worker.consecutiveFailures += 1;
      worker.lastError = error.message;
      console.error(`[camera-worker] prediction failed for ${camera.id}`);
      console.error(error.message);

      camera.status = "running";
      camera.metrics = {
        ...camera.metrics,
        camera_health: worker.consecutiveFailures > 3 ? "degraded" : "unstable",
        processing_status: "error",
        updatedAt: new Date().toISOString(),
      };
      cameraRepository.save(camera);
      emitCamera(worker.userId, camera);
      this.broadcastDashboard(worker.userId);
    } finally {
      worker.busy = false;
      if (!worker.stopped && !worker.paused) {
        this.scheduleNextRun(id);
      }
    }
  }

  stopWorkerOnly(id) {
    const worker = this.getWorker(id);
    if (!worker) {
      return;
    }

    worker.stopped = true;
    worker.paused = false;
    this.clearWorkerTimer(worker);
    this.workers.delete(id);
    console.log(`[camera-worker] Worker timers stopped & resources deleted for camera_id=${id}`);
    void stopStreamAnalysis(id);
  }

  buildDashboard(userId) {
    const cameras = cameraRepository.listByUser(userId);
    const alerts = alertRepository.listByUser(userId);
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
    const global = buildGlobalAnalytics(cameras, alerts);

    return {
      summary,
      global,
      cameras,
      alerts,
      timestamp: new Date().toISOString(),
    };
  }

  broadcastDashboard(userId) {
    const payload = this.buildDashboard(userId);
    emitDashboard(userId, payload);
    emitGlobal(userId, payload.global);
  }

  addCamera(camera) {
    cameraRepository.save(camera);
    this.broadcastDashboard(camera.userId);
    void this.warmupCameraSource(camera, camera.userId);
    return camera;
  }

  async startCamera(id, userId) {
    const camera = cameraRepository.getByUser(id, userId);
    if (!camera) {
      throw new Error("Camera not found");
    }

    const webrtcUrl = getWhepUrl(id);
    console.log(`[CameraWorker-Debug] Starting camera ${id}, ensuring MediaMTX path...`);
    await ensureMediaMtxPath(id, camera.streamUrl);

    const existingWorker = this.getWorker(id);
    if (existingWorker && !existingWorker.stopped) {
      existingWorker.paused = false;
      existingWorker.userId = userId;
      camera.status = "running";
      camera.webrtcUrl = webrtcUrl;
      camera.metrics.webrtc_url = webrtcUrl;
      cameraRepository.save(camera);
      emitCamera(userId, camera);
      this.scheduleNextRun(id, 0);
      return camera;
    }

    camera.status = "running";
    camera.webrtcUrl = webrtcUrl;
    camera.lastStartedAt = new Date().toISOString();
    camera.metrics = buildResetMetrics(camera.metrics);
    camera.metrics.webrtc_url = webrtcUrl;
    camera.metrics.stream_resolution_status = camera.metrics.stream_resolution_status || "connecting";
    camera.metrics.processing_status = "warming_up";
    cameraRepository.save(camera);
    emitCamera(userId, camera);

    const worker = this.createWorkerState(camera);
    this.workers.set(id, worker);
    void this.warmupCameraSource(camera, userId);
    const aiStreamUrl = isIngestibleSource(camera.streamUrl)
      ? getLocalRtspUrl(id)
      : camera.streamUrl;

    void ensureStreamStarted({
      cameraId: id,
      streamUrl: aiStreamUrl,
      userId,
      zoneName: camera.zoneName,
    }).catch((err) => console.warn(`[camera-worker] Could not start AI stream for ${id}: ${err.message}`));
    void this.runWorkerTick(id);
    this.broadcastDashboard(userId);
    return camera;
  }

  pauseCamera(id, userId) {
    const camera = cameraRepository.getByUser(id, userId);
    if (!camera) {
      throw new Error("Camera not found");
    }

    const worker = this.getWorker(id);
    if (!worker) {
      camera.status = "paused";
      camera.metrics = {
        ...camera.metrics,
        processing_status: "paused",
        stream_resolution_status: camera.metrics?.stream_resolution_status || "connecting",
        updatedAt: new Date().toISOString(),
      };
      cameraRepository.save(camera);
      emitCamera(userId, camera);
      this.broadcastDashboard(userId);
      return camera;
    }

    worker.paused = true;
    this.clearWorkerTimer(worker);
    camera.status = "paused";
    camera.metrics = {
      ...camera.metrics,
      processing_status: "paused",
      updatedAt: new Date().toISOString(),
    };
    cameraRepository.save(camera);
    emitCamera(userId, camera);
    this.broadcastDashboard(userId);
    return camera;
  }

  async resumeCamera(id, userId) {
    const camera = cameraRepository.getByUser(id, userId);
    if (!camera) {
      throw new Error("Camera not found");
    }

    await ensureMediaMtxPath(id, camera.streamUrl);
    const worker = this.getWorker(id);
    if (!worker) {
      return this.startCamera(id, userId);
    }

    worker.userId = userId;
    worker.paused = false;
    worker.stopped = false;
    camera.status = "running";
    camera.webrtcUrl = getWhepUrl(id);
    camera.metrics = {
      ...camera.metrics,
      webrtc_url: getWhepUrl(id),
      processing_status: "running",
      stream_resolution_status: camera.metrics?.stream_resolution_status || "connecting",
      updatedAt: new Date().toISOString(),
    };
    cameraRepository.save(camera);
    emitCamera(userId, camera);
    void this.warmupCameraSource(camera, userId);
    this.scheduleNextRun(id, 0);
    this.broadcastDashboard(userId);
    return camera;
  }

  async restartCamera(id, userId) {
    this.stopCamera(id, userId);
    return this.startCamera(id, userId);
  }

  stopCamera(id, userId) {
    const camera = cameraRepository.getByUser(id, userId);
    if (!camera) {
      throw new Error("Camera not found");
    }

    this.stopWorkerOnly(id);
    this.alertCache.delete(id);
    void removeMediaMtxPath(id);
    void stopStreamAnalysis(id).catch((err) => console.warn(`[camera-worker] Could not stop AI stream for ${id}: ${err.message}`));

    camera.status = "stopped";
    camera.metrics = buildResetMetrics(camera.metrics);
    camera.metrics.stream_resolution_status = camera.metrics.stream_resolution_status || "idle";
    camera.lastFrameAt = camera.metrics.updatedAt;
    cameraRepository.save(camera);
    emitCamera(userId, camera);
    this.broadcastDashboard(userId);
    return camera;
  }

  deleteCamera(id, userId) {
    this.stopCamera(id, userId);
    void removeMediaMtxPath(id);
    const removed = cameraRepository.remove(id);
    this.broadcastDashboard(userId);
    return removed;
  }

  shutdown() {
    for (const [cameraId, worker] of this.workers.entries()) {
      this.clearWorkerTimer(worker);
      worker.stopped = true;
      void stopStreamAnalysis(cameraId);
    }
    this.workers.clear();
    this.alertCache.clear();
    shutdownAllIngests();
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
