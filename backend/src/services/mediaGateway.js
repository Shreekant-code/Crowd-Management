import { mediaMtxApiUrl, mediaMtxWhepBaseUrl, enableMediaMtx } from "../config/env.js";
import { resolvePlayableStreamUrl } from "../utils/liveStreamResolver.js";
import streamIngestor, { isIngestibleSource, getMediaMtxPathName } from "./streamIngestor.js";

export { getMediaMtxPathName };

/**
 * Resolves the WHEP WebRTC playback URL for a given camera ID
 */
export function getWhepUrl(cameraId) {
  const pathName = getMediaMtxPathName(cameraId);
  return `${mediaMtxWhepBaseUrl}/${pathName}/whep`;
}

/**
 * Checks if a URL is a direct media source that MediaMTX can ingest (RTSP, RTMP, direct HTTP)
 */
function isDirectMediaStream(url = "") {
  const lower = url.toLowerCase();
  if (lower.startsWith("rtsp://") || lower.startsWith("rtsps://") || lower.startsWith("rtmp://")) {
    return true;
  }
  if (lower.includes(".m3u8") || lower.includes("/playlist") || lower.includes("/manifest")) {
    return true;
  }
  return false;
}

/**
 * Registers or updates a camera stream path in MediaMTX or launches intermediate ingest
 */
export async function ensureMediaMtxPath(cameraId, sourceUrl) {
  if (!enableMediaMtx || !cameraId || !sourceUrl) {
    console.warn(`[MediaGateway-Debug] Skipping registration: enableMediaMtx=${enableMediaMtx}, cameraId=${cameraId}, hasSource=${Boolean(sourceUrl)}`);
    return null;
  }

  // Handle object or string inputs
  const rawSource = typeof sourceUrl === "object"
    ? (sourceUrl.playableUrl || sourceUrl.url || sourceUrl.streamUrl || "")
    : sourceUrl;
  let normalizedSource = String(rawSource || "").trim();

  if (!normalizedSource) {
    return null;
  }

  const pathName = getMediaMtxPathName(cameraId);

  // If source is a YouTube webpage, route through local streamIngestor worker (yt-dlp -> FFmpeg -> MediaMTX RTSP push)
  // This bypasses MediaMTX internal Go HLS client limit ("size exceeds maximum allowed")
  if (isIngestibleSource(normalizedSource) || normalizedSource.includes("youtube.com") || normalizedSource.includes("youtu.be")) {
    console.log(`[MediaGateway-Debug] Routing YouTube source through StreamIngestor for cam_${cameraId}`);
    
    // Clean up any stale on-demand path registration in MediaMTX REST API
    try {
      await fetch(`${mediaMtxApiUrl}/v3/config/paths/delete/${encodeURIComponent(pathName)}`, { method: "DELETE" });
    } catch (_e) {
      // ignore
    }

    streamIngestor.startIngest(cameraId, normalizedSource);
    return getWhepUrl(cameraId);
  }

  const addUrl = `${mediaMtxApiUrl}/v3/config/paths/add/${encodeURIComponent(pathName)}`;
  const patchUrl = `${mediaMtxApiUrl}/v3/config/paths/patch/${encodeURIComponent(pathName)}`;

  const payload = {
    source: normalizedSource,
    sourceOnDemand: false,
  };

  console.log(`[MediaGateway-Debug] Registering direct path in MediaMTX at ${addUrl} with source: ${normalizedSource.slice(0, 60)}...`);

  try {
    const addRes = await fetch(addUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (addRes.ok || addRes.status === 200 || addRes.status === 201) {
      console.log(`[MediaGateway-Debug] Path registered in MediaMTX: ${pathName}`);
      return getWhepUrl(cameraId);
    }

    const addErrText = await addRes.text().catch(() => "");
    console.log(`[MediaGateway-Debug] MediaMTX add returned status ${addRes.status}: ${addErrText}`);

    // If path already exists, patch/update it
    if (addRes.status === 400 || addRes.status === 409) {
      const patchRes = await fetch(patchUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (patchRes.ok) {
        console.log(`[MediaGateway-Debug] Path updated in MediaMTX: ${pathName}`);
        return getWhepUrl(cameraId);
      }

      const patchErrText = await patchRes.text().catch(() => "");
      console.log(`[MediaGateway-Debug] MediaMTX patch returned status ${patchRes.status}: ${patchErrText}`);
    }
  } catch (err) {
    console.warn(`[MediaGateway-Debug] Could not connect to MediaMTX at ${mediaMtxApiUrl}: ${err.message}`);
  }

  return getWhepUrl(cameraId);
}

/**
 * Removes a camera stream path from MediaMTX and stops any active ingest processes
 */
export async function removeMediaMtxPath(cameraId) {
  if (!cameraId) {
    return;
  }

  // Stop any active YouTube FFmpeg / yt-dlp ingest processes
  streamIngestor.stopIngest(cameraId);

  if (!enableMediaMtx) {
    return;
  }

  const pathName = getMediaMtxPathName(cameraId);
  const deleteUrl = `${mediaMtxApiUrl}/v3/config/paths/delete/${encodeURIComponent(pathName)}`;

  try {
    const res = await fetch(deleteUrl, { method: "DELETE" });
    if (res.ok) {
      console.log(`[MediaGateway-Debug] Path removed from MediaMTX: ${pathName}`);
    }
  } catch (err) {
    console.warn(`[MediaGateway-Debug] Failed to delete path from MediaMTX: ${err.message}`);
  }
}
