import path from "node:path";
import { exec, spawn } from "node:child_process";
import fs from "node:fs";
import ffmpegStatic from "ffmpeg-static";
import cameraRepository from "../data/cameraRepository.js";
import { emitCamera } from "./socketHub.js";

const activeIngestions = new Map();
const YOUTUBE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * Normalizes camera ID into safe MediaMTX path name
 */
export function getMediaMtxPathName(cameraId) {
  const safeId = String(cameraId || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `cam_${safeId}`;
}

/**
 * Resolves local RTSP push/pull URL for MediaMTX
 */
export function getLocalRtspUrl(cameraId) {
  const pathName = getMediaMtxPathName(cameraId);
  return `rtsp://127.0.0.1:8554/${pathName}`;
}

/**
 * Determines if a source URL requires an intermediate ingest worker (e.g. YouTube / GoogleVideo)
 */
export function isIngestibleSource(url = "") {
  const lower = String(url || "").trim().toLowerCase();
  return (
    lower.includes("youtube.com/") ||
    lower.includes("youtu.be/") ||
    lower.includes("googlevideo.com/") ||
    lower.includes("earthlive.tv")
  );
}

/**
 * Finds available Python and yt-dlp executable candidates
 */
function getPythonYtDlpCandidate() {
  const candidates = [
    path.resolve(process.cwd(), ".venv", "Scripts", "python.exe"),
    path.resolve(process.cwd(), "..", ".venv", "Scripts", "python.exe"),
    "C:\\npm_projects\\Crowd-Management\\.venv\\Scripts\\python.exe",
    path.resolve(process.cwd(), ".venv", "bin", "python"),
    path.resolve(process.cwd(), "..", ".venv", "bin", "python"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) {
      return { command: c, prefixArgs: ["-m", "yt_dlp"] };
    }
  }

  if (process.env.PYTHON && fs.existsSync(process.env.PYTHON)) {
    return { command: process.env.PYTHON, prefixArgs: ["-m", "yt_dlp"] };
  }

  return { command: "yt-dlp", prefixArgs: [] };
}

/**
 * Resolves FFmpeg binary path
 */
function getFfmpegBinary() {
  if (ffmpegStatic && fs.existsSync(ffmpegStatic)) {
    return ffmpegStatic;
  }
  return "ffmpeg";
}

/**
 * Forcefully terminates a process and all its children to prevent zombie processes on Windows
 */
function killProcessTree(proc, label = "process") {
  if (!proc || !proc.pid) return;

  const pid = proc.pid;
  if (process.platform === "win32") {
    exec(`taskkill /PID ${pid} /T /F`, (err) => {
      if (err && !String(err).includes("not found") && !String(err).includes("no running instance")) {
        console.warn(`[StreamIngestor] Warning: taskkill for ${label} (PID ${pid}) exited with: ${err.message}`);
      }
    });
  } else {
    try {
      process.kill(-pid, "SIGKILL");
    } catch (_e) {
      try {
        proc.kill("SIGKILL");
      } catch (_e2) {
        // ignore if already exited
      }
    }
  }
}

/**
 * Starts YouTube to local MediaMTX RTSP ingestion worker
 */
export function startIngest(cameraId, sourceUrl) {
  if (!cameraId || !sourceUrl) {
    return null;
  }

  const existing = activeIngestions.get(cameraId);
  if (existing) {
    if (!existing.stopped && existing.sourceUrl === sourceUrl) {
      console.log(`[StreamIngestor] Ingest already active for cam_${cameraId}`);
      return getLocalRtspUrl(cameraId);
    }
    stopIngest(cameraId);
  }

  const pathName = getMediaMtxPathName(cameraId);
  const targetRtspUrl = getLocalRtspUrl(cameraId);

  const entry = {
    cameraId,
    sourceUrl,
    pathName,
    targetRtspUrl,
    ytProcess: null,
    ffmpegProcess: null,
    stopped: false,
    reconnectTimer: null,
    reconnectAttempts: 0,
    startedAt: Date.now(),
  };

  activeIngestions.set(cameraId, entry);

  console.log(`[StreamIngestor] Launching ingestion for cam_${cameraId} -> ${targetRtspUrl}`);

  runIngestCycle(entry);

  return targetRtspUrl;
}

/**
 * Updates camera repository and emits socket update
 */
function updateCameraIngestStatus(cameraId, status, errorMsg = null) {
  try {
    const camera = cameraRepository.getById(cameraId);
    if (!camera) return;
    camera.metrics = {
      ...(camera.metrics || {}),
      stream_resolution_status: status,
      stream_resolution_error: errorMsg,
      processing_status: status === "youtube_resolved" ? "streaming" : "error",
      camera_health: status === "youtube_resolved" ? "good" : "unstable",
      updatedAt: new Date().toISOString(),
    };
    cameraRepository.save(camera);
    emitCamera(camera.userId, camera);
  } catch (err) {
    console.warn(`[StreamIngestor] Could not update camera status for ${cameraId}: ${err.message}`);
  }
}

/**
 * Runs the yt-dlp -> FFmpeg pipe cycle
 */
function runIngestCycle(entry) {
  if (entry.stopped) return;

  const { command, prefixArgs } = getPythonYtDlpCandidate();
  const ytArgs = [
    ...prefixArgs,
    "--extractor-args",
    "youtube:player_client=web,android",
    "-f",
    "bestvideo[height<=720]/best[height<=720]/best[protocol^=m3u8]/best",
    "-g",
    "--no-warnings",
    "--no-playlist",
    entry.sourceUrl,
  ];

  console.log(`[StreamIngestor] Resolving live URL via ${command} for cam_${entry.cameraId}...`);

  let stdoutBuffer = "";
  let stderrBuffer = "";

  const ytProc = spawn(command, ytArgs, {
    windowsHide: true,
  });

  entry.ytProcess = ytProc;

  ytProc.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
  });

  ytProc.stderr.on("data", (chunk) => {
    stderrBuffer += chunk.toString();
  });

  ytProc.on("error", (err) => {
    console.error(`[StreamIngestor] yt-dlp process error for cam_${entry.cameraId}: ${err.message}`);
    updateCameraIngestStatus(entry.cameraId, "unresolved", err.message);
    scheduleReconnect(entry);
  });

  ytProc.on("close", (code) => {
    entry.ytProcess = null;
    if (entry.stopped) return;

    if (code !== 0) {
      const firstErrorLine = (stderrBuffer.trim() || "").split(/\r?\n/)[0] || `yt-dlp exited with code ${code}`;
      console.warn(
        `[StreamIngestor] yt-dlp exited with code ${code} for cam_${entry.cameraId}: ${stderrBuffer.trim()}`
      );
      updateCameraIngestStatus(entry.cameraId, "unresolved", firstErrorLine);
      scheduleReconnect(entry);
      return;
    }

    const streamUrl = stdoutBuffer
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.startsWith("http://") || l.startsWith("https://"));

    if (!streamUrl) {
      console.warn(`[StreamIngestor] yt-dlp produced no valid stream URL for cam_${entry.cameraId}`);
      updateCameraIngestStatus(entry.cameraId, "unresolved", "No valid stream URL extracted");
      scheduleReconnect(entry);
      return;
    }

    console.log(
      `[StreamIngestor] Live stream URL extracted for cam_${entry.cameraId}. Launching FFmpeg RTSP publisher...`
    );

    updateCameraIngestStatus(entry.cameraId, "youtube_resolved", null);
    launchFfmpegPublisher(entry, streamUrl);
  });
}

/**
 * Launches FFmpeg with hardened flags & verified User-Agent headers to push stream to MediaMTX
 */
function launchFfmpegPublisher(entry, streamUrl) {
  if (entry.stopped) return;

  const ffmpegBinary = getFfmpegBinary();

  // Detect if the stream is a live HLS broadcast vs a recorded VOD clip
  const isLiveBroadcast =
    streamUrl.includes(".m3u8") ||
    streamUrl.includes("/manifest/") ||
    streamUrl.includes("/hls/") ||
    entry.sourceUrl.includes("/live");

  const ffmpegArgs = [
    "-user_agent",
    YOUTUBE_USER_AGENT,
    "-headers",
    `User-Agent: ${YOUTUBE_USER_AGENT}\r\n`,
    "-probesize",
    "1000000",
    "-analyzeduration",
    "1000000",
    "-fflags",
    "+nobuffer+flush_packets",
    "-flags",
    "low_delay",
    "-reconnect",
    "1",
    "-reconnect_streamed",
    "1",
    "-reconnect_delay_max",
    "5",
  ];

  // For static clips / VODs: use -re (1.0x native pace) and -stream_loop -1 (infinite loop)
  // For live broadcasts: drop -re so FFmpeg naturally consumes live segments without falling behind
  if (!isLiveBroadcast) {
    ffmpegArgs.push("-re", "-stream_loop", "-1");
  }

  ffmpegArgs.push(
    "-i",
    streamUrl,
    "-c:v",
    "copy",
    "-an",
    "-f",
    "rtsp",
    "-rtsp_transport",
    "tcp",
    entry.targetRtspUrl
  );

  console.log(`[StreamIngestor] Spawning FFmpeg publisher: ${ffmpegBinary} -> ${entry.targetRtspUrl}`);

  const ffmpegProc = spawn(ffmpegBinary, ffmpegArgs, {
    windowsHide: true,
  });

  entry.ffmpegProcess = ffmpegProc;
  entry.reconnectAttempts = 0; // reset on successful spawn

  ffmpegProc.stderr.on("data", (data) => {
    const msg = data.toString().trim();
    if (
      msg.includes("Server returned 40") ||
      msg.includes("Connection refused") ||
      msg.includes("Error opening output")
    ) {
      console.warn(`[StreamIngestor cam_${entry.cameraId}] ${msg}`);
    }
  });

  ffmpegProc.on("error", (err) => {
    console.error(`[StreamIngestor] FFmpeg process error for cam_${entry.cameraId}: ${err.message}`);
    scheduleReconnect(entry);
  });

  ffmpegProc.on("close", (code) => {
    entry.ffmpegProcess = null;
    if (entry.stopped) return;

    console.warn(`[StreamIngestor] FFmpeg exited with code ${code} for cam_${entry.cameraId}. Reconnecting...`);
    scheduleReconnect(entry);
  });
}

/**
 * Schedules automatic reconnection with backoff
 */
function scheduleReconnect(entry) {
  if (entry.stopped || entry.reconnectTimer) return;

  entry.reconnectAttempts += 1;
  const delayMs = Math.min(entry.reconnectAttempts * 2000, 10000);

  console.log(
    `[StreamIngestor] Scheduling reconnect attempt #${entry.reconnectAttempts} for cam_${entry.cameraId} in ${delayMs}ms`
  );

  entry.reconnectTimer = setTimeout(() => {
    entry.reconnectTimer = null;
    if (!entry.stopped) {
      runIngestCycle(entry);
    }
  }, delayMs);
}

/**
 * Stops stream ingestion and forcefully kills all child processes
 */
export function stopIngest(cameraId) {
  if (!cameraId) return;

  const entry = activeIngestions.get(cameraId);
  if (!entry) return;

  entry.stopped = true;

  if (entry.reconnectTimer) {
    clearTimeout(entry.reconnectTimer);
    entry.reconnectTimer = null;
  }

  if (entry.ffmpegProcess) {
    killProcessTree(entry.ffmpegProcess, `ffmpeg_cam_${cameraId}`);
    entry.ffmpegProcess = null;
  }

  if (entry.ytProcess) {
    killProcessTree(entry.ytProcess, `ytdlp_cam_${cameraId}`);
    entry.ytProcess = null;
  }

  activeIngestions.delete(cameraId);
  console.log(`[StreamIngestor] Stopped ingestion and cleaned up processes for cam_${cameraId}`);
}

/**
 * Checks if ingestion is currently active for a camera
 */
export function isIngestActive(cameraId) {
  const entry = activeIngestions.get(cameraId);
  return Boolean(entry && !entry.stopped);
}

/**
 * Shuts down all active stream ingestions cleanly
 */
export function shutdownAllIngests() {
  console.log(`[StreamIngestor] Shutting down all active stream ingestions (${activeIngestions.size} active)...`);
  for (const cameraId of Array.from(activeIngestions.keys())) {
    stopIngest(cameraId);
  }
}

export default {
  startIngest,
  stopIngest,
  isIngestActive,
  isIngestibleSource,
  getLocalRtspUrl,
  getMediaMtxPathName,
  shutdownAllIngests,
};
