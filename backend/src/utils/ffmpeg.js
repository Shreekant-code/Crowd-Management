import fs from "fs";
import path from "path";
import { Readable } from "stream";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";
import {
  previewInputTimeoutMs,
  previewStreamFps,
  previewStreamWidth,
} from "../config/env.js";

function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getFfmpegPath() {
  if (!ffmpegPath) {
    throw new Error(
      "ffmpeg binary is unavailable. Install ffmpeg-static or configure ffmpeg on the host machine."
    );
  }

  return ffmpegPath;
}

function runFfmpeg(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    let stderr = "";

    ffmpeg.setFfmpegPath(getFfmpegPath());

    ffmpeg(inputPath)
      .outputOptions([
        "-vf",
        "scale=1280:-2,fps=12",
        "-c:v",
        "libx264",
        "-preset",
        "fast",
        "-movflags",
        "+faststart",
        "-an",
      ])
      .on("start", (commandLine) => {
        console.log(`[ffmpeg] ${commandLine}`);
      })
      .on("stderr", (line) => {
        stderr += `${line}\n`;
      })
      .on("error", (error) => {
        console.error("[ffmpeg] processing failed");
        if (stderr.trim()) {
          console.error(stderr.trim());
        }

        reject(
          new Error(
            `ffmpeg processing failed: ${error.message}${stderr.trim() ? ` | ${stderr.trim()}` : ""}`
          )
        );
      })
      .on("end", () => {
        resolve();
      })
      .save(outputPath);
  });
}

async function normalizeVideo(inputPath, outputDir, outputName) {
  ensureDir(outputDir);
  const outputPath = path.join(outputDir, outputName);

  await runFfmpeg(inputPath, outputPath);

  return outputPath;
}

async function proxyHttpVideoStream(inputUrl, response) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, previewInputTimeoutMs || 3000));

  try {
    const upstream = await fetch(inputUrl, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "multipart/x-mixed-replace,image/jpeg,*/*",
      },
    });

    if (!upstream.ok || !upstream.body) {
      throw new Error(`Upstream camera responded with status ${upstream.status}`);
    }

    response.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") || "multipart/x-mixed-replace; boundary=frame"
    );
    response.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
    response.setHeader("Pragma", "no-cache");
    response.setHeader("Connection", "keep-alive");
    response.setHeader("X-Accel-Buffering", "no");
    response.flushHeaders?.();

    const bodyStream = Readable.fromWeb(upstream.body);
    bodyStream.on("error", (error) => {
      console.error("[camera-proxy] upstream stream failed");
      console.error(error.message);
      if (!response.headersSent) {
        response.status(502).json({ message: "Camera proxy failed", error: error.message });
      } else {
        response.end();
      }
    });
    bodyStream.pipe(response);

    response.on("close", () => {
      bodyStream.destroy();
      controller.abort();
    });

    return true;
  } finally {
    clearTimeout(timeout);
  }
}

function streamVideoPreview(inputPath, response) {
  ffmpeg.setFfmpegPath(getFfmpegPath());

  const normalizedInput = String(inputPath || "").trim();
  const normalizedLower = normalizedInput.toLowerCase();
  const isRtsp = normalizedLower.startsWith("rtsp://");
  const isHttp = normalizedLower.startsWith("http://") || normalizedLower.startsWith("https://");
  const targetFps = Math.max(4, previewStreamFps || 10);
  const targetWidth = Math.max(320, previewStreamWidth || 640);
  const timeoutUs = Math.max(1000, previewInputTimeoutMs || 3000) * 1000;
  let closedByClient = false;

  const command = ffmpeg(normalizedInput)
    .outputOptions([
      "-vf",
      `fps=${targetFps},scale=${targetWidth}:-1`,
      "-q:v",
      "7",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-fflags",
      "nobuffer",
      "-flags",
      "low_delay",
      "-flush_packets",
      "1",
      "-analyzeduration",
      "0",
      "-probesize",
      "32768",
      "-threads",
      "1",
      "-an",
    ])
    .format("mpjpeg")
    .on("start", (commandLine) => {
      console.log(`[ffmpeg-preview] ${commandLine}`);
    })
    .on("error", (error) => {
      if (closedByClient || response.writableEnded || response.destroyed) {
        return;
      }

      console.error("[ffmpeg-preview] stream failed");
      console.error(error.message);

      if (!response.headersSent) {
        response.status(502).json({ message: "Camera preview failed", error: error.message });
      } else {
        response.end();
      }
    });

  if (isRtsp) {
    command.inputOptions([
      "-rtsp_transport",
      "tcp",
      "-stimeout",
      String(timeoutUs),
      "-fflags",
      "nobuffer",
      "-flags",
      "low_delay",
      "-analyzeduration",
      "0",
      "-probesize",
      "32768",
    ]);
  } else if (isHttp) {
    command.inputOptions([
      "-rw_timeout",
      String(timeoutUs),
      "-reconnect",
      "1",
      "-reconnect_streamed",
      "1",
      "-reconnect_delay_max",
      "2",
      "-fflags",
      "nobuffer",
      "-flags",
      "low_delay",
      "-analyzeduration",
      "0",
      "-probesize",
      "32768",
    ]);
  }

  const stream = command.pipe(response, { end: true });

  response.on("close", () => {
    closedByClient = true;
    stream.destroy();
    command.kill("SIGTERM");
  });
}

export { ensureDir, normalizeVideo, proxyHttpVideoStream, streamVideoPreview };
