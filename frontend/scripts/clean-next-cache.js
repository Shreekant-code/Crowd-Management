const fs = require("fs");
const path = require("path");

const cacheDir = path.resolve(__dirname, "..", ".next", "cache");

try {
  if (fs.existsSync(cacheDir)) {
    fs.rmSync(cacheDir, { recursive: true, force: true });
    console.log(`[clean-next-cache] cleared ${cacheDir}`);
  }
} catch (error) {
  console.warn(`[clean-next-cache] unable to clear ${cacheDir}: ${error.message}`);
}
