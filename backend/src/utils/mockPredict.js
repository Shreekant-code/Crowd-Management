import {
  getLatestStreamAnalysis,
  getUploadResult,
  startFileAnalysis,
} from "../services/aiPredictionService.js";

function isLiveSourceType(sourceType = "") {
  return [
    "rtsp",
    "http",
    "public",
    "webcam",
    "hls",
    "mjpeg",
    "usb",
    "ipcam",
    "file",
  ].includes(String(sourceType || "").toLowerCase());
}

function deriveRisk(count) {
  if (count >= 180) return "Critical";
  if (count >= 130) return "High";
  if (count >= 75) return "Medium";
  return "Low";
}

function getRandomCount() {
  return Math.floor(Math.random() * 8) + 5; // 5 to 12
}

function buildMockPrediction(overrides = {}) {
  const initialCount = getRandomCount();
  const left = Math.floor(initialCount / 3);
  const right = Math.floor(initialCount / 3);
  const center = initialCount - left - right;

  return {
    count: initialCount,
    people_count: initialCount,
    current_count: initialCount,
    total_count: initialCount + Math.floor(Math.random() * 10) + 5,
    density_count: initialCount,
    base_count: initialCount,
    predicted_crowd: initialCount + Math.floor(Math.random() * 4),
    prediction_10min_count: initialCount + Math.floor(Math.random() * 4) + 1,
    smoothed_count: initialCount,
    final_count: initialCount,
    active_track_ids: Array.from({ length: initialCount }, (_, i) => i + 1),
    risk: deriveRisk(initialCount),
    detections: [],
    heatmap_points: [],
    alerts: [],
    zone_counts: { left, center, right },
    line_crossing: {
      entry: Math.floor(Math.random() * 3),
      exit: Math.floor(Math.random() * 2),
    },
    crowd_features: {
      density_score: Number((initialCount / 20).toFixed(2)),
      movement_score: 0.15,
      congestion_score: Number((initialCount / 25).toFixed(2)),
      hotspot_ratio: 0.35,
    },
    risk_score: Number((initialCount / 25).toFixed(2)),
    processing_status: "mock_fallback",
    source: "mockPredict",
    ...overrides,
  };
}

function normalizePrediction(payload, fallback = buildMockPrediction()) {
  const currentCount = Number.isFinite(payload?.current_count)
    ? payload.current_count
    : Number.isFinite(payload?.people_count)
      ? payload.people_count
      : Number.isFinite(payload?.count)
        ? payload.count
        : Number.isFinite(payload?.raw_count)
          ? payload.raw_count
          : Number.isFinite(payload?.yolo_count)
            ? payload.yolo_count
            : fallback.current_count;
  const totalCount = Number.isFinite(payload?.total_count)
    ? payload.total_count
    : fallback.total_count;

  return {
    ...fallback,
    ...payload,
    count: currentCount,
    people_count: currentCount,
    current_count: currentCount,
    total_count: totalCount,
    density_count: Number.isFinite(payload?.density_count) ? payload.density_count : fallback.density_count,
    base_count: Number.isFinite(payload?.base_count) ? payload.base_count : fallback.base_count,
    predicted_crowd: Number.isFinite(payload?.predicted_crowd)
      ? payload.predicted_crowd
      : fallback.predicted_crowd,
    smoothed_count: Number.isFinite(payload?.smoothed_count)
      ? payload.smoothed_count
      : fallback.smoothed_count,
    final_count: Number.isFinite(payload?.final_count)
      ? payload.final_count
      : fallback.final_count,
    active_track_ids: Array.isArray(payload?.active_track_ids)
      ? payload.active_track_ids
      : fallback.active_track_ids,
    detections: Array.isArray(payload?.detections) ? payload.detections : fallback.detections,
    heatmap_points: Array.isArray(payload?.heatmap_points)
      ? payload.heatmap_points
      : fallback.heatmap_points,
    alerts: Array.isArray(payload?.alerts) ? payload.alerts : fallback.alerts,
    zone_counts:
      payload?.zone_counts && typeof payload.zone_counts === "object"
        ? payload.zone_counts
        : fallback.zone_counts,
    line_crossing:
      payload?.line_crossing && typeof payload.line_crossing === "object"
        ? payload.line_crossing
        : fallback.line_crossing,
    crowd_features:
      payload?.crowd_features && typeof payload.crowd_features === "object"
        ? payload.crowd_features
        : fallback.crowd_features,
    risk: payload?.risk || deriveRisk(currentCount),
  };
}

async function mockPredict(options = {}) {
  const fallback = buildMockPrediction();

  if (!options.sourceType || !options.source) {
    return fallback;
  }

  if (options.sourceType === "file") {
    try {
      const started = await startFileAnalysis({
        filePath: options.source,
        userId: options.userId,
        fileId: options.fileId,
        originalName: options.originalName,
        cleanupPaths: options.cleanupPaths || [],
      });
      const completed = started.job_id ? getUploadResult(started.job_id) : null;

      return normalizePrediction(
        completed
          ? {
              ...completed.result,
              processing_status: "completed",
              job_id: started.job_id,
              source: "python-service",
            }
          : {
              ...fallback,
              processing_status: "processing_started",
              job_id: started.job_id,
              source: "python-service",
            },
        fallback
      );
    } catch (error) {
      return normalizePrediction(
        {
          ...fallback,
          fallback_reason: error.message,
        },
        fallback
      );
    }
  }

  if (isLiveSourceType(options.sourceType)) {
    try {
      const latest = await getLatestStreamAnalysis({
        cameraId: options.cameraId,
        streamUrl: options.source,
        userId: options.userId,
        zoneName: options.zoneName,
      });

      return normalizePrediction(
        latest
          ? {
              ...latest,
              processing_status: "live",
              source: "python-service",
            }
          : {
              ...fallback,
              processing_status: "warming_up",
              source: "python-service",
            },
        fallback
      );
    } catch (error) {
      return normalizePrediction(
        {
          ...fallback,
          fallback_reason: error.message,
        },
        fallback
      );
    }
  }

  return fallback;
}

export { mockPredict, deriveRisk };
