import { v4 as uuidv4 } from "uuid";
import cameraRepository from "../data/cameraRepository.js";
import workerManager from "../services/cameraWorkerManager.js";
import { streamVideoPreview } from "../utils/ffmpeg.js";

function detectSourceType(streamUrl) {
  return /^https?:\/\//i.test(streamUrl) ? "http" : "rtsp";
}

function listCameras(req, res) {
  res.json({ cameras: cameraRepository.listByUser(req.platformUser.id) });
}

function addCamera(req, res) {
  const { name, zoneName, streamUrl, location } = req.body;

  if (!name || !zoneName || !streamUrl) {
    return res.status(400).json({ message: "name, zoneName and streamUrl are required" });
  }

  const camera = {
    id: uuidv4(),
    userId: req.platformUser.id,
    name,
    zoneName,
    location: location || "Unknown",
    streamUrl,
    sourceType: detectSourceType(streamUrl),
    status: "stopped",
    createdAt: new Date().toISOString(),
    metrics: {
      count: 0,
      current_count: 0,
      total_count: 0,
      people_count: 0,
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
      risk: "Low",
      updatedAt: null,
    },
  };

  workerManager.addCamera(camera);
  res.status(201).json({ camera });
}

function startCamera(req, res) {
  try {
    const camera = workerManager.startCamera(req.params.id, req.platformUser.id);
    res.json({ camera });
  } catch (error) {
    res.status(404).json({ message: error.message });
  }
}

function previewCamera(req, res) {
  const camera = cameraRepository.getByUser(req.params.id, req.platformUser.id);
  if (!camera) {
    return res.status(404).json({ message: "Camera not found" });
  }

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Connection", "keep-alive");

  streamVideoPreview(camera.streamUrl, res);
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
  stopCamera,
  deleteCamera,
};
