import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..", "..");

export const port = Number(process.env.PORT || 4000);
export const frontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
export const maxAlerts = Number(process.env.MAX_ALERTS || 40);
export const dataDir = path.resolve(rootDir, process.env.DATA_DIR || "data");
export const uploadDir = path.resolve(rootDir, process.env.UPLOAD_DIR || "uploads");
export const processedDir = path.resolve(rootDir, process.env.PROCESSED_DIR || "processed");
export const platformApiSecret =
  process.env.PLATFORM_API_SECRET || "platform-secret-change-me";
export const socketTokenSecret =
  process.env.SOCKET_TOKEN_SECRET || "socket-token-secret-change-me";
export const pythonServiceUrl = process.env.PYTHON_SERVICE_URL || "http://127.0.0.1:8001";
export const pythonLiveServiceUrl =
  process.env.PYTHON_LIVE_SERVICE_URL || "http://127.0.0.1:8002";
export const enablePythonLiveProxy =
  process.env.ENABLE_PYTHON_LIVE_PROXY !== "false";
export const aiRequestTimeoutMs = Number(process.env.AI_REQUEST_TIMEOUT_MS || 1500);
export const aiRetryCount = Number(process.env.AI_RETRY_COUNT || 1);
export const aiStreamStartCooldownMs = Number(process.env.AI_STREAM_START_COOLDOWN_MS || 10000);
export const aiStreamFreshnessMs = Number(process.env.AI_STREAM_FRESHNESS_MS || 12000);
export const aiCallbackSecret =
  process.env.AI_CALLBACK_SECRET || "ai-callback-secret-change-me";
export const aiResultCallbackUrl =
  process.env.AI_RESULT_CALLBACK_URL || `http://127.0.0.1:${port}/internal/ai/upload-result`;
export const aiStreamPollIntervalMs = Number(process.env.AI_STREAM_POLL_INTERVAL_MS || 750);
