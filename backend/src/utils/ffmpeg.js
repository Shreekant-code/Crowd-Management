import fs from "fs";
import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegPath from "ffmpeg-static";

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

function streamVideoPreview(inputPath, response) {
  ffmpeg.setFfmpegPath(getFfmpegPath());

  const normalizedInput = String(inputPath || "").trim();
  const normalizedLower = normalizedInput.toLowerCase();
  const isRtsp = normalizedLower.startsWith("rtsp://");
  const isHttp = normalizedLower.startsWith("http://") || normalizedLower.startsWith("https://");

  const command = ffmpeg(normalizedInput)
    .outputOptions([
      "-vf",
      "fps=12,scale=960:-1",
      "-q:v",
      "6",
      "-preset",
      "ultrafast",
      "-tune",
      "zerolatency",
      "-an",
    ])
    .format("mpjpeg")
    .on("start", (commandLine) => {
      console.log(`[ffmpeg-preview] ${commandLine}`);
    })
    .on("error", (error) => {
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
      "-rtsp_transport tcp",
      "-stimeout 5000000",
    ]);
  } else if (isHttp) {
    command.inputOptions([
      "-rw_timeout 5000000",
      "-reconnect 1",
      "-reconnect_streamed 1",
      "-reconnect_delay_max 2",
    ]);
  }

  const stream = command.pipe(response, { end: true });

  response.on("close", () => {
    stream.destroy();
    command.kill("SIGKILL");
  });
}

export { ensureDir, normalizeVideo, streamVideoPreview };
