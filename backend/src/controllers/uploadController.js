import fs from "fs";
import path from "path";
import { v4 as uuidv4 } from "uuid";
import { processedDir } from "../config/env.js";
import { ensureDir, normalizeVideo } from "../utils/ffmpeg.js";
import { cleanupFiles } from "../utils/fileCleanup.js";
import { mockPredict } from "../utils/mockPredict.js";

async function processVideoUpload(req, res) {
  if (!req.file) {
    return res.status(400).json({ message: "Video file is required" });
  }

  let outputPath;

  try {
    const outputDir = path.join(processedDir, req.platformUser.id);
    ensureDir(outputDir);
    const outputName = `${uuidv4()}.mp4`;
    outputPath = await normalizeVideo(req.file.path, outputDir, outputName);
    await cleanupFiles([req.file.path]);

    const prediction = await mockPredict({
      sourceType: "file",
      source: outputPath,
      userId: req.platformUser.id,
      fileId: outputName,
      originalName: req.file.originalname,
      cleanupPaths: [outputPath],
    });

    if (prediction.processing_status !== "processing_started") {
      res.on("finish", () => {
        void cleanupFiles([outputPath]);
      });
    }

    res.status(201).json({
      file: {
        originalName: req.file.originalname,
        storedName: path.basename(outputPath),
        path: outputPath,
        size: fs.statSync(outputPath).size,
      },
      analysis: {
        ...prediction,
        processedAt: new Date().toISOString(),
      },
      message:
        prediction.processing_status === "processing_started"
          ? "processing started"
          : "processing completed with fallback",
    });
  } catch (error) {
    console.error("[upload] video processing failed");
    console.error(error.message);

    await cleanupFiles([req.file?.path, outputPath]);

    res.status(500).json({
      message: "Video processing failed.",
      error: error.message,
    });
  }
}

export { processVideoUpload };
