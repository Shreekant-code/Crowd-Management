import { Readable } from "stream";
import cameraRepository from "../data/cameraRepository.js";
import { streamVideoPreview } from "../utils/ffmpeg.js";
import { enablePythonLiveProxy, pythonLiveServiceUrl } from "../config/env.js";

const liveStatsFailureLog = new Map();

function shouldLogLiveStatsFailure(cameraId) {
  const now = Date.now();
  const lastLoggedAt = liveStatsFailureLog.get(cameraId) || 0;
  if (now - lastLoggedAt < 15000) {
    return false;
  }

  liveStatsFailureLog.set(cameraId, now);
  return true;
}

async function streamCamera(req, res) {
  const camera = cameraRepository.getByUser(req.params.cameraId, req.platformUser.id);
  if (!camera) {
    return res.status(404).json({ message: "Camera not found" });
  }

  console.log(
    `[stream-controller] preview request camera_id=${camera.id} source=${camera.streamUrl}`
  );

  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Connection", "keep-alive");

  if (enablePythonLiveProxy) {
    try {
      const liveUrl = new URL("/live", pythonLiveServiceUrl);
      liveUrl.searchParams.set("source", camera.streamUrl);
      console.log(
        `[stream-controller] proxying AI live stream camera_id=${camera.id} python_url=${liveUrl.toString()}`
      );

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const response = await fetch(liveUrl, {
        cache: "no-store",
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));

      if (!response.ok || !response.body) {
        throw new Error(`Live AI stream unavailable with status ${response.status}`);
      }

      res.setHeader(
        "Content-Type",
        response.headers.get("content-type") || "multipart/x-mixed-replace; boundary=frame"
      );

      const bodyStream = Readable.fromWeb(response.body);
      bodyStream.on("error", (error) => {
        if (!res.headersSent) {
          res.status(502).end(error.message);
        } else {
          res.end();
        }
      });
      bodyStream.pipe(res);
      return;
    } catch (error) {
      console.error(`[stream-controller] falling back to ffmpeg preview for ${camera.id}`);
      console.error(error.message);
    }
  }

  streamVideoPreview(camera.streamUrl, res);
}

async function getStreamStats(req, res) {
  const camera = cameraRepository.getByUser(req.params.cameraId, req.platformUser.id);
  if (!camera) {
    return res.status(404).json({ message: "Camera not found" });
  }

  if (enablePythonLiveProxy) {
    try {
      const statsUrl = new URL("/stats", pythonLiveServiceUrl);
      statsUrl.searchParams.set("source", camera.streamUrl);
      console.log(
        `[stream-controller] fetching live stats camera_id=${camera.id} python_url=${statsUrl.toString()}`
      );
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(statsUrl, {
        cache: "no-store",
        signal: controller.signal,
      }).finally(() => clearTimeout(timeout));
      if (response.ok) {
        const liveStats = await response.json();
        return res.json({
          cameraId: camera.id,
          status: camera.status,
          metrics: {
            ...(camera.metrics || {}),
            current_count: liveStats.current_count ?? camera.metrics?.current_count ?? 0,
            count: liveStats.current_count ?? camera.metrics?.count ?? 0,
            total_count: liveStats.total_count ?? camera.metrics?.total_count ?? 0,
            density_count: liveStats.density_count ?? camera.metrics?.density_count ?? 0,
            final_count: liveStats.final_count ?? camera.metrics?.final_count ?? 0,
            risk: liveStats.risk ?? camera.metrics?.risk ?? "Low",
            frame_id: liveStats.frame_id ?? camera.metrics?.frame_id ?? null,
            updatedAt: liveStats.updated_at || camera.metrics?.updatedAt || camera.lastFrameAt || camera.lastStartedAt || null,
          },
          updatedAt: liveStats.updated_at || camera.metrics?.updatedAt || camera.lastFrameAt || camera.lastStartedAt || null,
        });
      }
    } catch (error) {
      if (shouldLogLiveStatsFailure(camera.id)) {
        console.error(`[stream-controller] live stats fetch failed for ${camera.id}`);
        console.error(error.message);
      }
    }
  }

  return res.json({
    cameraId: camera.id,
    status: camera.status,
    metrics: camera.metrics || {},
    updatedAt: camera.metrics?.updatedAt || camera.lastFrameAt || camera.lastStartedAt || null,
  });
}

export { streamCamera, getStreamStats };
