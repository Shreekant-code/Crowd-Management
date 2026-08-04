import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const RESOLVE_CACHE_TTL_MS = 30 * 60 * 1000;
const resolveCache = new Map();
const inFlightResolutions = new Map();
const YOUTUBE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const YT_DLP_COMMANDS = ["yt-dlp", "yt-dlp.exe", "youtube-dl", "youtube-dl.exe"];

function isDirectMediaUrl(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return (
    normalized.startsWith("rtsp://")
    || normalized.startsWith("http://")
    || normalized.startsWith("https://")
    || normalized.startsWith("webcam://")
  );
}

function coerceSourceUrl(value = "") {
  const raw = String(value || "").trim();
  if (!raw) {
    return raw;
  }

  if (/<iframe\b/i.test(raw) || /src\s*=\s*["'][^"']+["']/i.test(raw)) {
    const srcMatch = raw.match(/src\s*=\s*["']([^"']+)["']/i);
    if (srcMatch?.[1]) {
      return coerceSourceUrl(srcMatch[1]);
    }

    const urlMatch = raw.match(/https?:\/\/[^"' <>\]]+/i);
    if (urlMatch?.[0]) {
      return coerceSourceUrl(urlMatch[0]);
    }
  }

  return raw;
}

function getHostName(value = "") {
  try {
    return new URL(coerceSourceUrl(value)).hostname.toLowerCase();
  } catch (_error) {
    return "";
  }
}

function extractYouTubeVideoId(rawUrl = "") {
  const value = String(rawUrl || "").trim();
  if (!value) {
    return null;
  }

  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }

    if (host.includes("youtube.com")) {
      const pathname = parsed.pathname || "";
      if (pathname.startsWith("/watch")) {
        return parsed.searchParams.get("v");
      }

      const pathParts = pathname.split("/").filter(Boolean);
      const candidateIndex = pathParts.findIndex((part) => ["embed", "shorts", "live"].includes(part));
      if (candidateIndex >= 0 && pathParts[candidateIndex + 1]) {
        return pathParts[candidateIndex + 1];
      }
    }
  } catch (_error) {
    const shortMatch = value.match(/youtu\.be\/([A-Za-z0-9_-]{6,})/i);
    if (shortMatch) {
      return shortMatch[1];
    }

    const watchMatch = value.match(/[?&]v=([A-Za-z0-9_-]{6,})/i);
    if (watchMatch) {
      return watchMatch[1];
    }
  }

  return null;
}

function extractBalancedJson(text, startIndex) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(startIndex, index + 1);
      }
    }
  }

  return null;
}

function parsePlayerResponseFromText(text = "") {
  const directJsonMatch = text.match(/ytInitialPlayerResponse\s*=\s*/);
  if (directJsonMatch) {
    const startIndex = text.indexOf("{", directJsonMatch.index);
    if (startIndex >= 0) {
      const jsonBlock = extractBalancedJson(text, startIndex);
      if (jsonBlock) {
        try {
          return JSON.parse(jsonBlock);
        } catch (_error) {
          // continue
        }
      }
    }
  }

  const manifestPatterns = [
    /"hlsManifestUrl":"([^"]+)"/i,
    /hlsManifestUrl\\u0026?[:=]([^"&,\\s]+)/i,
    /"streamingData"[^\n]*"hlsManifestUrl":"([^"]+)"/i,
    /https:\/\/[^"'\s]+\/playlist\/index\.m3u8/i,
  ];

  for (const pattern of manifestPatterns) {
    const manifestMatch = text.match(pattern);
    if (manifestMatch?.[1]) {
      try {
        const value = decodeURIComponent(manifestMatch[1]);
        return {
          streamingData: {
            hlsManifestUrl: value,
          },
        };
      } catch (_error) {
        // continue
      }
    }
  }

  const playerResponseMatch = text.match(/[?&]player_response=([^&]+)/);
  if (playerResponseMatch) {
    try {
      const decoded = decodeURIComponent(playerResponseMatch[1].replace(/\+/g, "%20"));
      return JSON.parse(decoded);
    } catch (_error) {
      // continue
    }
  }

  return null;
}

async function fetchTextWithTimeout(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": YOUTUBE_USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.8",
      },
    });

    if (!response.ok) {
      throw new Error(`stream resolver request failed with status ${response.status}`);
    }

    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJsonWithTimeout(url, body, timeoutMs = 8000, headers = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "User-Agent": YOUTUBE_USER_AGENT,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`stream resolver request failed with status ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function extractInnertubeConfig(text = "") {
  const apiKeyMatch =
    text.match(/INNERTUBE_API_KEY":"([^"]+)"/) ||
    text.match(/"INNERTUBE_API_KEY"\s*:\s*"([^"]+)"/);
  const clientVersionMatch =
    text.match(/INNERTUBE_CLIENT_VERSION":"([^"]+)"/) ||
    text.match(/"INNERTUBE_CLIENT_VERSION"\s*:\s*"([^"]+)"/);
  const visitorDataMatch =
    text.match(/VISITOR_DATA":"([^"]+)"/) ||
    text.match(/"VISITOR_DATA"\s*:\s*"([^"]+)"/);

  return {
    apiKey: apiKeyMatch?.[1] || null,
    clientVersion: clientVersionMatch?.[1] || "2.20260715.00.00",
    visitorData: visitorDataMatch?.[1] || null,
  };
}

function extractPlayerResponseData(text = "") {
  return {
    playerResponse: parsePlayerResponseFromText(text),
    innertube: extractInnertubeConfig(text),
  };
}

function getPythonCandidates() {
  const repoRoot = path.resolve(process.cwd(), "..");
  const pythonCandidates = [
    process.env.PYTHON,
    process.env.PYTHON_EXECUTABLE,
    process.env.PYTHON_PATH,
    process.platform === "win32"
      ? path.resolve(repoRoot, ".venv", "Scripts", "python.exe")
      : path.resolve(repoRoot, ".venv", "bin", "python"),
    "python",
    "python3",
  ];

  return Array.from(new Set(pythonCandidates.filter(Boolean)));
}

async function tryResolveWithPythonYtDlp(targetUrl) {
  const pythonCandidates = getPythonCandidates();
  const commonArgs = [
    "-m",
    "yt_dlp",
    "--no-warnings",
    "--no-playlist",
    "--skip-download",
    "--get-url",
    "--format",
    "best[protocol^=m3u8]/best",
    targetUrl,
  ];

  for (const pythonBinary of pythonCandidates) {
    try {
      const { stdout } = await execFileAsync(pythonBinary, commonArgs, {
        timeout: 12000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      const candidate = String(stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (candidate) {
        return candidate;
      }
    } catch (_error) {
      continue;
    }
  }

  return null;
}

async function tryResolveWithYtDlp(videoUrl = "") {
  const targetUrl = String(videoUrl || "").trim();
  if (!targetUrl) {
    return null;
  }

  const commonArgs = [
    "--no-warnings",
    "--no-playlist",
    "--skip-download",
    "--get-url",
    "--format",
    "best[protocol^=m3u8]/best",
    targetUrl,
  ];

  for (const command of YT_DLP_COMMANDS) {
    try {
      const { stdout } = await execFileAsync(command, commonArgs, {
        timeout: 12000,
        maxBuffer: 1024 * 1024,
        windowsHide: true,
      });
      const candidate = String(stdout || "")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (candidate) {
        return candidate;
      }
    } catch (_error) {
      continue;
    }
  }

  return tryResolveWithPythonYtDlp(targetUrl);
}

async function fetchYoutubePlayerData(videoId) {
  const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en&gl=US&bpctr=9999999999&has_verified=1`;
  const watchPage = await fetchTextWithTimeout(watchUrl, 10000);
  const { playerResponse, innertube } = extractPlayerResponseData(watchPage);

  if (playerResponse?.streamingData?.hlsManifestUrl) {
    return playerResponse;
  }

  const pageManifestMatch = watchPage.match(/https:\/\/[^"'\s]+\/playlist\/index\.m3u8/i);
  if (pageManifestMatch?.[0]) {
    return {
      streamingData: {
        hlsManifestUrl: pageManifestMatch[0],
      },
    };
  }

  if (innertube.apiKey) {
    const endpoint = `https://www.youtube.com/youtubei/v1/player?key=${encodeURIComponent(innertube.apiKey)}`;
    const body = {
      context: {
        client: {
          clientName: "WEB",
          clientVersion: innertube.clientVersion,
          hl: "en",
          gl: "US",
          visitorData: innertube.visitorData || undefined,
        },
      },
      videoId,
      playbackContext: {
        contentPlaybackContext: {
          html5Preference: "HTML5_PREF_WANTS",
        },
      },
      contentCheckOk: true,
      racyCheckOk: true,
    };

    try {
      const apiResponse = await fetchJsonWithTimeout(endpoint, body, 10000, {
        Origin: "https://www.youtube.com",
        Referer: watchUrl,
      });
      if (apiResponse?.streamingData?.hlsManifestUrl) {
        return apiResponse;
      }
      if (apiResponse?.videoDetails && apiResponse?.streamingData) {
        return apiResponse;
      }
    } catch (_error) {
      // ignore
    }
  }

  return playerResponse;
}

async function resolveYouTubeStreamUrl(videoId) {
  const cacheKey = `youtube:${videoId}`;
  const cached = resolveCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < RESOLVE_CACHE_TTL_MS) {
    return cached.value;
  }

  const inFlight = inFlightResolutions.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const resolutionPromise = (async () => {
    const playerData = await fetchYoutubePlayerData(videoId);
    const hlsManifestUrl = playerData?.streamingData?.hlsManifestUrl;
    if (hlsManifestUrl) {
      resolveCache.set(cacheKey, { cachedAt: Date.now(), value: hlsManifestUrl });
      return hlsManifestUrl;
    }

    const ytDlpResolved = await tryResolveWithYtDlp(`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`);
    if (ytDlpResolved) {
      resolveCache.set(cacheKey, { cachedAt: Date.now(), value: ytDlpResolved });
      return ytDlpResolved;
    }

    const watchUrl = `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&hl=en&gl=US`;
    const embedPage = await fetchTextWithTimeout(`https://www.youtube.com/embed/${encodeURIComponent(videoId)}`, 10000);
    const iframeMatch = embedPage.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/i);
    if (iframeMatch?.[1] && iframeMatch[1] !== videoId) {
      return resolveYouTubeStreamUrl(iframeMatch[1]);
    }

    const embeddedManifestMatch = embedPage.match(/https:\/\/[^"'\s]+\/playlist\/index\.m3u8/i);
    if (embeddedManifestMatch?.[0]) {
      resolveCache.set(cacheKey, { cachedAt: Date.now(), value: embeddedManifestMatch[0] });
      return embeddedManifestMatch[0];
    }

    throw new Error(`Unable to resolve YouTube stream URL for video ${videoId} from ${watchUrl}`);
  })();

  inFlightResolutions.set(cacheKey, resolutionPromise);
  try {
    return await resolutionPromise;
  } finally {
    inFlightResolutions.delete(cacheKey);
  }
}

async function resolvePlayableStreamUrl(sourceUrl, sourceType = "") {
  const rawUrl = coerceSourceUrl(sourceUrl);
  if (!rawUrl) {
    throw new Error("stream URL is empty");
  }

  const cacheKey = `${String(sourceType || "").toLowerCase()}:${rawUrl}`;
  const cached = resolveCache.get(cacheKey);
  if (cached && Date.now() - cached.cachedAt < RESOLVE_CACHE_TTL_MS) {
    return cached.value;
  }

  const inFlight = inFlightResolutions.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const resolutionPromise = (async () => {
    if (
      isDirectMediaUrl(rawUrl)
      && !rawUrl.toLowerCase().includes("youtube.com")
      && !rawUrl.toLowerCase().includes("youtu.be")
      && !rawUrl.toLowerCase().includes("earthlive.tv")
    ) {
      resolveCache.set(cacheKey, { cachedAt: Date.now(), value: rawUrl });
      return rawUrl;
    }

    const normalizedType = String(sourceType || "").toLowerCase();
    const host = getHostName(rawUrl);
    const isPublicPage =
      normalizedType === "public"
      || host.includes("youtube.com")
      || host.includes("youtu.be")
      || host.includes("earthlive.tv");

    if (!isPublicPage) {
      resolveCache.set(cacheKey, { cachedAt: Date.now(), value: rawUrl });
      return rawUrl;
    }

    const videoId = extractYouTubeVideoId(rawUrl);
    if (videoId) {
      const resolved = await resolveYouTubeStreamUrl(videoId);
      resolveCache.set(cacheKey, { cachedAt: Date.now(), value: resolved });
      return resolved;
    }

    const pageText = await fetchTextWithTimeout(rawUrl);
    const pagePlayerData = extractPlayerResponseData(pageText);
    const pageHlsManifest = pagePlayerData.playerResponse?.streamingData?.hlsManifestUrl;
    if (pageHlsManifest) {
      resolveCache.set(cacheKey, { cachedAt: Date.now(), value: pageHlsManifest });
      return pageHlsManifest;
    }

    const ytDlpPageResolved = await tryResolveWithYtDlp(rawUrl);
    if (ytDlpPageResolved) {
      resolveCache.set(cacheKey, { cachedAt: Date.now(), value: ytDlpPageResolved });
      return ytDlpPageResolved;
    }

    const embeddedIdMatch = pageText.match(/youtube\.com\/embed\/([A-Za-z0-9_-]{6,})/i);
    if (embeddedIdMatch?.[1]) {
      const resolved = await resolveYouTubeStreamUrl(embeddedIdMatch[1]);
      resolveCache.set(cacheKey, { cachedAt: Date.now(), value: resolved });
      return resolved;
    }

    const parsedPublicId = extractYouTubeVideoId(rawUrl);
    if (parsedPublicId) {
      const resolved = await resolveYouTubeStreamUrl(parsedPublicId);
      resolveCache.set(cacheKey, { cachedAt: Date.now(), value: resolved });
      return resolved;
    }

    throw new Error(`Unable to resolve playable stream from ${rawUrl}`);
  })();

  inFlightResolutions.set(cacheKey, resolutionPromise);
  try {
    return await resolutionPromise;
  } finally {
    inFlightResolutions.delete(cacheKey);
  }
}

export { resolvePlayableStreamUrl, extractYouTubeVideoId };
