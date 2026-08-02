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

function getPredictionCount(metrics = {}) {
  if (Number.isFinite(metrics?.prediction_10min_count)) {
    return metrics.prediction_10min_count;
  }

  if (Number.isFinite(metrics?.predicted_count)) {
    return metrics.predicted_count;
  }

  if (Number.isFinite(metrics?.predicted_crowd)) {
    return metrics.predicted_crowd;
  }

  return getLiveCount(metrics);
}

function getDensityScore(metrics = {}) {
  const score = metrics?.crowd_features?.density_score ?? metrics?.density ?? 0;
  return Number.isFinite(score) ? score : 0;
}

function getCongestionScore(metrics = {}) {
  const score = metrics?.crowd_features?.congestion_score ?? 0;
  return Number.isFinite(score) ? score : 0;
}

function getRiskScore(metrics = {}) {
  if (Number.isFinite(metrics?.riskScore)) {
    return metrics.riskScore;
  }

  if (Number.isFinite(metrics?.risk_score)) {
    return metrics.risk_score;
  }

  const risk = String(metrics?.risk || "").toLowerCase();
  if (risk === "critical") return 0.92;
  if (risk === "high") return 0.76;
  if (risk === "medium") return 0.48;
  return 0.18;
}

function getRiskRank(metrics = {}) {
  const risk = String(metrics?.risk || metrics?.risk_level || "").toLowerCase();
  if (risk === "critical") return 4;
  if (risk === "high") return 3;
  if (risk === "medium") return 2;
  return 1;
}

function normalizeRisk(score) {
  if (score >= 0.82) {
    return "Critical";
  }
  if (score >= 0.62) {
    return "High";
  }
  if (score >= 0.34) {
    return "Medium";
  }
  return "Low";
}

function buildGlobalPrediction(cameras, globalCrowd, averageGrowth, averageDensity) {
  const runningCameras = cameras.filter((camera) => camera.status === "running");
  const totalRunning = Math.max(runningCameras.length, 1);
  const baseProjection = globalCrowd + Math.round(averageGrowth * 1.25);
  const densityBoost = Math.round(averageDensity * Math.max(globalCrowd * 0.35, 1));
  const projectedCrowd = Math.max(baseProjection + densityBoost, globalCrowd);
  const confidence = Math.max(
    0.35,
    Math.min(
      0.98,
      0.55
        + (Math.min(globalCrowd / Math.max(runningCameras.length * 40, 1), 1) * 0.18)
        + (Math.min(averageDensity, 1) * 0.12)
        + (Math.min(averageGrowth / Math.max(globalCrowd || 1, 1), 1) * 0.10)
    )
  );

  return {
    currentCount: globalCrowd,
    projectedCount: projectedCrowd,
    confidence: Number(confidence.toFixed(2)),
    horizonMinutes: 10,
    trend:
      averageGrowth > 1.5
        ? "rising"
        : averageGrowth < -1.5
          ? "falling"
          : "stable",
    label: `Global Prediction (10 min): ${normalizeRisk(projectedCrowd / Math.max(totalRunning * 28, 1) >= 1 ? 0.76 : projectedCrowd / Math.max(totalRunning * 28, 1) >= 0.55 ? 0.48 : 0.18).toUpperCase()}`,
  };
}

function buildAlertSummary(alerts = []) {
  const counts = {
    total: 0,
    low: 0,
    medium: 0,
    high: 0,
    critical: 0,
  };

  for (const alert of alerts) {
    counts.total += 1;
    const risk = String(alert?.risk || "Low").toLowerCase();
    if (risk === "critical") {
      counts.critical += 1;
    } else if (risk === "high") {
      counts.high += 1;
    } else if (risk === "medium") {
      counts.medium += 1;
    } else {
      counts.low += 1;
    }
  }

  return counts;
}

function buildGlobalAnalytics(cameras = [], alerts = []) {
  const cameraList = Array.isArray(cameras) ? cameras : [];
  const alertList = Array.isArray(alerts) ? alerts : [];
  const runningCameras = cameraList.filter((camera) => camera.status === "running");
  const offlineCameras = cameraList.filter((camera) => camera.status !== "running");
  const liveCounts = cameraList.map((camera) => getLiveCount(camera.metrics));
  const predictionCounts = cameraList.map((camera) => getPredictionCount(camera.metrics));
  const densityScores = cameraList.map((camera) => getDensityScore(camera.metrics));
  const congestionScores = cameraList.map((camera) => getCongestionScore(camera.metrics));
  const riskScores = cameraList.map((camera) => getRiskScore(camera.metrics));

  const totalCrowd = liveCounts.reduce((acc, value) => acc + value, 0);
  const averageCrowd = cameraList.length > 0 ? totalCrowd / cameraList.length : 0;
  const maximumCrowd = liveCounts.length > 0 ? Math.max(...liveCounts) : 0;
  const minimumCrowd = liveCounts.length > 0 ? Math.min(...liveCounts) : 0;
  const totalPrediction = predictionCounts.reduce((acc, value) => acc + value, 0);
  const averagePrediction = cameraList.length > 0 ? totalPrediction / cameraList.length : 0;
  const averageDensity = densityScores.length > 0
    ? densityScores.reduce((acc, value) => acc + value, 0) / densityScores.length
    : 0;
  const averageCongestion = congestionScores.length > 0
    ? congestionScores.reduce((acc, value) => acc + value, 0) / congestionScores.length
    : 0;
  const averageRisk = riskScores.length > 0
    ? riskScores.reduce((acc, value) => acc + value, 0) / riskScores.length
    : 0;
  const averageGrowth = cameraList.length > 0
    ? cameraList.reduce((acc, camera) => {
        const metrics = camera.metrics || {};
        const projected = getPredictionCount(metrics);
        return acc + (projected - getLiveCount(metrics));
      }, 0) / cameraList.length
    : 0;

  const mostCrowdedCamera = [...cameraList].sort(
    (left, right) => getLiveCount(right.metrics) - getLiveCount(left.metrics)
  )[0] || null;

  const leastCrowdedCamera = [...cameraList].sort(
    (left, right) => getLiveCount(left.metrics) - getLiveCount(right.metrics)
  )[0] || null;

  const highestDensityCamera = [...cameraList].sort(
    (left, right) => getDensityScore(right.metrics) - getDensityScore(left.metrics)
  )[0] || null;

  const highestRiskCamera = [...cameraList].sort(
    (left, right) =>
      (getRiskScore(right.metrics) + getRiskRank(right.metrics)) -
      (getRiskScore(left.metrics) + getRiskRank(left.metrics))
  )[0] || null;

  const fastestGrowingCamera = [...cameraList].sort((left, right) => {
    const leftGrowth = getPredictionCount(left.metrics) - getLiveCount(left.metrics);
    const rightGrowth = getPredictionCount(right.metrics) - getLiveCount(right.metrics);
    return rightGrowth - leftGrowth;
  })[0] || null;

  const venueOccupancy = cameraList.length > 0
    ? Math.max(0, Math.min(1, totalCrowd / Math.max(cameraList.length * 75, 1)))
    : 0;
  const globalDensity = cameraList.length > 0 ? averageDensity : 0;
  const globalCongestion = cameraList.length > 0 ? averageCongestion : 0;
  const overallRiskScore = Math.max(
    0,
    Math.min(
      1,
      (averageRisk * 0.45)
      + (venueOccupancy * 0.25)
      + (globalDensity * 0.20)
      + (globalCongestion * 0.10)
    )
  );
  const overallRisk = normalizeRisk(overallRiskScore);
  const globalPrediction = buildGlobalPrediction(cameraList, totalCrowd, averageGrowth, averageDensity);
  const alertSummary = buildAlertSummary(alertList);

  return {
    totalCameras: cameraList.length,
    onlineCameras: runningCameras.length,
    offlineCameras: offlineCameras.length,
    totalCrowd,
    averageCrowd: Number(averageCrowd.toFixed(2)),
    maximumCrowd,
    minimumCrowd,
    mostCrowdedCamera,
    leastCrowdedCamera,
    highestDensityCamera,
    highestRiskCamera,
    fastestGrowingCamera,
    globalDensity: Number(globalDensity.toFixed(4)),
    globalCongestion: Number(globalCongestion.toFixed(4)),
    overallRisk,
    overallRiskScore: Number(overallRiskScore.toFixed(4)),
    venueOccupancy: Number(venueOccupancy.toFixed(4)),
    globalPrediction,
    predictionConfidence: globalPrediction.confidence,
    alertSummary,
    trend: globalPrediction.trend,
    updatedAt: new Date().toISOString(),
  };
}

export { buildGlobalAnalytics };
