import { mediaMtxApiUrl, mediaMtxWhepBaseUrl, enableMediaMtx } from "../config/env.js";

/**
 * Normalizes camera ID into a valid MediaMTX path name
 */
export function getMediaMtxPathName(cameraId) {
  const safeId = String(cameraId || "").replace(/[^a-zA-Z0-9_-]/g, "_");
  return `cam_${safeId}`;
}

/**
 * Resolves the WHEP WebRTC playback URL for a given camera ID
 */
export function getWhepUrl(cameraId) {
  const pathName = getMediaMtxPathName(cameraId);
  return `${mediaMtxWhepBaseUrl}/${pathName}/whep`;
}

/**
 * Registers or updates a camera stream path in MediaMTX via its REST Control API
 */
export async function ensureMediaMtxPath(cameraId, sourceUrl) {
  if (!enableMediaMtx || !cameraId || !sourceUrl) {
    return null;
  }

  const pathName = getMediaMtxPathName(cameraId);
  const normalizedSource = String(sourceUrl || "").trim();

  const addUrl = `${mediaMtxApiUrl}/v3/config/paths/add/${encodeURIComponent(pathName)}`;
  const patchUrl = `${mediaMtxApiUrl}/v3/config/paths/patch/${encodeURIComponent(pathName)}`;

  const payload = {
    source: normalizedSource,
    sourceOnDemand: true,
    sourceOnDemandCloseAfter: "10s",
    sourceOnDemandStartTimeout: "10s",
  };

  try {
    const addRes = await fetch(addUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (addRes.ok || addRes.status === 200 || addRes.status === 201) {
      console.log(`[MediaGateway] Path registered in MediaMTX: ${pathName} -> ${normalizedSource}`);
      return getWhepUrl(cameraId);
    }

    // If path already exists, patch/update it
    if (addRes.status === 400 || addRes.status === 409) {
      const patchRes = await fetch(patchUrl, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (patchRes.ok) {
        console.log(`[MediaGateway] Path updated in MediaMTX: ${pathName} -> ${normalizedSource}`);
        return getWhepUrl(cameraId);
      }
    }
  } catch (err) {
    console.warn(`[MediaGateway] Could not connect to MediaMTX at ${mediaMtxApiUrl}: ${err.message}`);
  }

  return getWhepUrl(cameraId);
}

/**
 * Removes a camera stream path from MediaMTX when stopped or deleted
 */
export async function removeMediaMtxPath(cameraId) {
  if (!enableMediaMtx || !cameraId) {
    return;
  }

  const pathName = getMediaMtxPathName(cameraId);
  const deleteUrl = `${mediaMtxApiUrl}/v3/config/paths/delete/${encodeURIComponent(pathName)}`;

  try {
    const res = await fetch(deleteUrl, { method: "DELETE" });
    if (res.ok) {
      console.log(`[MediaGateway] Path removed from MediaMTX: ${pathName}`);
    }
  } catch (err) {
    console.warn(`[MediaGateway] Failed to delete path from MediaMTX: ${err.message}`);
  }
}
