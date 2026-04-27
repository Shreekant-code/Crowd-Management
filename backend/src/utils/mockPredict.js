import {
  getLatestStreamAnalysis,
  getUploadResult,
  startFileAnalysis,
} from "../services/aiPredictionService.js";

function deriveRisk(count) {
  if (count >= 180) return "Critical";
  if (count >= 130) return "High";
  if (count >= 75) return "Medium";
  return "Low";
}

function buildMockPrediction(overrides = {}) {
  return {
    count: 0,
    people_count: 0,
    current_count: 0,
    total_count: 0,
    density_count: 0,
    base_count: 0,
    predicted_crowd: 0,
    smoothed_count: 0,
    final_count: 0,
    active_track_ids: [],
    risk: "Low",
    detections: [],
    heatmap_points: [],
    alerts: [],
    zone_counts: { left: 0, center: 0, right: 0 },
    line_crossing: {
      entry: 0,
      exit: 0,
    },
    crowd_features: {
      density_score: 0,
      movement_score: 0,
      congestion_score: 0,
      hotspot_ratio: 0,
    },
    risk_score: 0,
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

  if (options.sourceType === "rtsp") {
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
