import fs from "fs";
import path from "path";
import { ensureDir } from "../utils/ffmpeg.js";
import { dataDir } from "../config/env.js";

function resolveFile(fileName) {
  ensureDir(dataDir);
  return path.join(dataDir, fileName);
}

function readJson(fileName, fallback) {
  const filePath = resolveFile(fileName);

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, JSON.stringify(fallback, null, 2));
    return fallback;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return raw ? JSON.parse(raw) : fallback;
  } catch (_error) {
    return fallback;
  }
}

function writeJson(fileName, value) {
  const filePath = resolveFile(fileName);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  return value;
}

export { readJson, writeJson };
