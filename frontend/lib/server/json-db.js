import fs from "fs";
import path from "path";

const dataDir = path.resolve(process.cwd(), "..", "data");

function ensureDir() {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
}

function resolveFile(fileName) {
  ensureDir();
  return path.join(dataDir, fileName);
}

export function readJson(fileName, fallback) {
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

export function writeJson(fileName, value) {
  const filePath = resolveFile(fileName);
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2));
  return value;
}

