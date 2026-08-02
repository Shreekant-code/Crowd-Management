import { execFile } from "node:child_process";
import { promisify } from "node:util";
import ffmpegPath from "ffmpeg-static";
import { detectSourceType, normalizeSourceUrl } from "./videoSource.js";
import { resolvePlayableStreamUrl } from "./liveStreamResolver.js";

const execFileAsync = promisify(execFile);
const VALIDATION_CACHE_TTL_MS = 60 * 1000;
const validationCache = new Map();

function getCacheKey(sourceUrl = "", sourceType = "") {
  return `${String(sourceType || "").toLowerCase()}:${String(sourceUrl || "")}`;
}

function safeNormalizeSource(sourceUrl, preferredType = "") {
  const normalizedUrl = normalizeSourceUrl(sourceUrl);
  const normalizedType = detectSourceType(normalizedUrl, preferredType);
  return { normalizedUrl, normalizedType };
}

async function validateSourceReachability(sourceUrl, sourceType = "") {
  const normalizedUrl = String(sourceUrl || "").trim();
  const normalizedType = String(sourceType || "").toLowerCase();
  if (!normalizedUrl) {
    throw new Error("stream URL is empty");
  }

  const cacheKey = getCacheKey(normalizedUrl, normalizedType);
  const cached = validationCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < VALIDATION_CACHE_TTL_MS) {
    return cached.value;
  }

  if (normalizedType === "file") {
    const value = { isValid: true, reason: "file" };
    validationCache.set(cacheKey, { cachedAt: Date.now(), value });
    return value;
  }

  const ffmpegBinary = ffmpegPath || "ffmpeg";
  const probeArgs = [
    "-v",
    "error",
    "-t",
    "0.1",
    "-i",
    normalizedUrl,
    "-frames:v",
    "1",
    "-f",
    "null",
    "-",
  ];

  try {
    await execFileAsync(ffmpegBinary, probeArgs, {
      timeout: 4000,
      windowsHide: true,
    });

    const value = { isValid: true, reason: "probe_ok" };
    validationCache.set(cacheKey, { cachedAt: Date.now(), value });
    return value;
  } catch (error) {
    const value = { isValid: false, reason: error.message };
    validationCache.set(cacheKey, { cachedAt: Date.now(), value });
    return value;
  }
}

async function resolveSourceInput({ sourceUrl, sourceType = "" } = {}) {
  const { normalizedUrl, normalizedType } = safeNormalizeSource(sourceUrl, sourceType);
  let playableUrl = normalizedUrl;
  let resolutionStatus = "direct";
  let resolutionError = null;

  try {
    playableUrl = await resolvePlayableStreamUrl(normalizedUrl, normalizedType);
    resolutionStatus = playableUrl !== normalizedUrl ? "resolved" : "direct";
  } catch (error) {
    resolutionError = error.message;
    resolutionStatus = "unresolved";
  }

  const validation = await validateSourceReachability(playableUrl || normalizedUrl, normalizedType).catch((error) => ({
    isValid: false,
    reason: error.message,
  }));

  return {
    sourceUrl: normalizedUrl,
    sourceType: normalizedType,
    playableUrl,
    resolutionStatus,
    resolutionError,
    isValid: Boolean(validation?.isValid),
    validationReason: validation?.reason || null,
  };
}

export { resolveSourceInput, safeNormalizeSource, validateSourceReachability };
