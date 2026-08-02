import { Readable } from "stream";
import { v4 as uuidv4 } from "uuid";
import cameraRepository from "../data/cameraRepository.js";
import workerManager from "../services/cameraWorkerManager.js";
import { proxyHttpVideoStream, streamVideoPreview } from "../utils/ffmpeg.js";
import { liveProxyTimeoutMs, pythonServiceUrl } from "../config/env.js";
import { resolveSourceInput } from "../utils/sourceResolver.js";
import { detectSourceType, normalizeSourceUrl } from "../utils/videoSource.js";

function buildLiveEndpoints(baseUrl, cameraId) {
  return [
    new URL(`/camera/${cameraId}/live`, baseUrl),
    new URL("/live", baseUrl),
  ];
}

async function proxyFirstLiveStream(endpoints, res) {
  let lastError = null;

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), liveProxyTimeoutMs);
      const response = await fetch(endpoint, {
        cache: "no-store",
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (!response.ok || !response.body) {
        lastError = new Error(`Live stream unavailable with status ${response.status}`);
        continue;
      }

      res.setHeader(
        "Content-Type",
        response.headers.get("content-type") || "multipart/x-mixed-replace; boundary=frame"
      );
      res.flushHeaders?.();

      const bodyStream = Readable.fromWeb(response.body);
      bodyStream.on("error", (error) => {
        if (!res.headersSent) {
          res.status(502).end(error.message);
        } else {
          res.end();
        }
      });
      bodyStream.pipe(res);
      return true;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) {
    throw lastError;
  }

  return false;
}

function listCameras(req, res) {
  res.json({ cameras: cameraRepository.listByUser(req.platformUser.id) });
}

function addCamera(req, res) {
  const { name, zoneName, streamUrl, location, sourceType } = req.body;

  if (!name || !zoneName || !streamUrl) {
    return res.status(400).json({ message: "name, zoneName and streamUrl are required" });
  }

  const normalizedStreamUrl = normalizeSourceUrl(streamUrl);
  const normalizedSourceType = detectSourceType(normalizedStreamUrl, sourceType);

  const camera = {
    id: uuidv4(),
    userId: req.platformUser.id,
    name,
    zoneName,
    location: location || "Unknown",
    streamUrl: normalizedStreamUrl,
    sourceType: normalizedSourceType,
    status: "stopped",
    createdAt: new Date().toISOString(),
    metrics: {
      count: 0,
      current_count: 0,
      total_count: 0,
      people_count: 0,
      prediction_10min_count: 0,
      prediction_10min_risk: "LOW",
      prediction_10min_label: "Prediction (10 min): LOW RISK",
      prediction_horizon_minutes: 10,
      active_track_ids: [],
      detections: [],
      heatmap_points: [],
      line_crossing: { entry: 0, exit: 0 },
      zone_counts: { left: 0, center: 0, right: 0 },
      crowd_features: {
        density_score: 0,
        movement_score: 0,
        congestion_score: 0,
        hotspot_ratio: 0,
      },
      prediction: 0,
      confidence: 0,
      latency_ms: 0,
      inference_ms: 0,
      camera_health: "good",
      fps: 0,
      risk: "Low",
      risk_score: 0,
      processing_status: "idle",
      updatedAt: null,
    },
  };

  workerManager.addCamera(camera);
  res.status(201).json({ camera });
}

function startCamera(req, res) {
  try {
    const existing = cameraRepository.getByUser(req.params.id, req.platformUser.id);
    if (!existing) {
      return res.status(404).json({ message: "Camera not found" });
    }

    const normalizedStreamUrl = normalizeSourceUrl(existing.streamUrl);
    if (normalizedStreamUrl !== existing.streamUrl) {
      existing.streamUrl = normalizedStreamUrl;
      existing.sourceType = detectSourceType(normalizedStreamUrl, existing.sourceType);
      cameraRepository.save(existing);
    }

    const camera = workerManager.startCamera(req.params.id, req.platformUser.id);
    res.json({ camera });
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

function pauseCamera(req, res) {
  try {
    const camera = workerManager.pauseCamera(req.params.id, req.platformUser.id);
    res.json({ camera });
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

function resumeCamera(req, res) {
  try {
    const camera = workerManager.resumeCamera(req.params.id, req.platformUser.id);
    res.json({ camera });
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

function restartCamera(req, res) {
  try {
    const camera = workerManager.restartCamera(req.params.id, req.platformUser.id);
    res.json({ camera });
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

async function previewCamera(req, res) {
  const camera = cameraRepository.getByUser(req.params.id, req.platformUser.id);
  if (!camera) {
    return res.status(404).json({ message: "Camera not found" });
  }

  const normalizedStreamUrl = normalizeSourceUrl(camera.streamUrl);
  if (normalizedStreamUrl !== camera.streamUrl) {
    camera.streamUrl = normalizedStreamUrl;
    camera.sourceType = detectSourceType(normalizedStreamUrl, camera.sourceType);
    cameraRepository.save(camera);
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let playableStreamUrl = normalizedStreamUrl;
  try {
    const plan = await resolveSourceInput({
      sourceUrl: normalizedStreamUrl,
      sourceType: camera.sourceType,
    });
    playableStreamUrl = plan.playableUrl || normalizedStreamUrl;
  } catch (error) {
    console.error(`[camera-controller] stream resolution failed for ${camera.id}`);
    console.error(error.message);
  }

  if (camera.sourceType === "http" && playableStreamUrl === normalizedStreamUrl) {
    try {
      await proxyHttpVideoStream(playableStreamUrl, res);
      return;
    } catch (error) {
      console.error(`[camera-controller] direct proxy failed for ${camera.id}`);
      console.error(error.message);
    }
  }

  try {
    const liveEndpoints = buildLiveEndpoints(pythonServiceUrl, camera.id).map((endpoint) => {
      endpoint.searchParams.set("source", playableStreamUrl);
      endpoint.searchParams.set("camera_id", camera.id);
      return endpoint;
    });
    console.log(
      `[camera-controller] proxying fallback AI live stream camera_id=${camera.id} python_urls=${liveEndpoints
        .map((endpoint) => endpoint.toString())
        .join(",")}`
    );
    await proxyFirstLiveStream(liveEndpoints, res);
    return;
  } catch (error) {
    console.error(`[camera-controller] fallback live stream failed for ${camera.id}`);
    console.error(error.message);
  }

  streamVideoPreview(playableStreamUrl, res);
}

function stopCamera(req, res) {
  try {
    const camera = workerManager.stopCamera(req.params.id, req.platformUser.id);
    res.json({ camera });
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

function deleteCamera(req, res) {
  try {
    const camera = workerManager.deleteCamera(req.params.id, req.platformUser.id);
    res.json({ camera });
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

export default {
  listCameras,
  addCamera,
  previewCamera,
  startCamera,
  pauseCamera,
  resumeCamera,
  restartCamera,
  stopCamera,
  deleteCamera,
};
