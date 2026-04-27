const fs = require("fs");
const path = require("path");

const nextDir = path.resolve(__dirname, "..", ".next");

try {
  fs.rmSync(nextDir, { recursive: true, force: true });
  console.log(`[clean-next-cache] cleared ${nextDir}`);
} catch (error) {
  console.warn(`[clean-next-cache] unable to clear ${nextDir}: ${error.message}`);
}
