import {
  aiCallbackSecret,
  aiResultCallbackUrl,
  aiStreamFreshnessMs,
  aiStreamStartCooldownMs,
} from "../config/env.js";
import { requestJson } from "./aiHttpClient.js";
import {
  getStreamState,
  getUploadResult as readUploadResult,
  markStreamFailure,
  markStreamStarted,
  markStreamStopped,
  registerUploadFiles as storeUploadFiles,
  saveUploadResult,
  takeUploadFiles,
} from "./aiState.js";
import { cleanupFiles } from "../utils/fileCleanup.js";

async function startFileAnalysis({ filePath, userId, fileId, originalName, cleanupPaths = [] }) {
  const response = await requestJson("/jobs/file", {
    method: "POST",
    body: {
      file_path: filePath,
      user_id: userId,
      file_id: fileId,
      original_name: originalName,
      callback: {
        url: aiResultCallbackUrl,
        headers: {
          "x-ai-callback-secret": aiCallbackSecret,
        },
      },
    },
  });

  if (response?.job_id) {
    storeUploadFiles(response.job_id, cleanupPaths);
  }

  return response;
}

async function ensureStreamStarted({ cameraId, streamUrl, userId, zoneName }) {
  const state = getStreamState(cameraId);
  const now = Date.now();

  if (state?.active) {
    return;
  }

  if (state?.lastStartAttemptAt && now - state.lastStartAttemptAt < aiStreamStartCooldownMs) {
    return;
  }

  markStreamStarted(cameraId);

  try {
    await requestJson("/streams/start", {
      method: "POST",
      body: {
        camera_id: cameraId,
        stream_url: streamUrl,
        user_id: userId,
        zone_name: zoneName,
      },
    });
  } catch (error) {
    markStreamFailure(cameraId, error);
    throw error;
  }
}

async function getLatestStreamAnalysis({ cameraId, streamUrl, userId, zoneName }) {
  await ensureStreamStarted({ cameraId, streamUrl, userId, zoneName });

  try {
    const response = await requestJson(`/streams/${cameraId}/latest`);
    if (!response?.result) {
      return null;
    }

    const updatedAt = response.result.updated_at || response.updated_at;
    if (updatedAt) {
      const freshness = Date.now() - new Date(updatedAt).getTime();
      if (freshness > aiStreamFreshnessMs) {
        return null;
      }
    }

    return response.result;
  } catch (error) {
    markStreamFailure(cameraId, error);
    throw error;
  }
}

async function stopStreamAnalysis(cameraId) {
  markStreamStopped(cameraId);

  try {
    await requestJson("/streams/stop", {
      method: "POST",
      body: { camera_id: cameraId },
      retries: 0,
    });
  } catch (_error) {
    // The backend should stay stoppable even if the Python service is unavailable.
  }
}

async function registerUploadResult(jobId, payload) {
  saveUploadResult(jobId, payload);
  await cleanupFiles(takeUploadFiles(jobId));
}

function getUploadResult(jobId) {
  return readUploadResult(jobId);
}

export {
  startFileAnalysis,
  getLatestStreamAnalysis,
  stopStreamAnalysis,
  registerUploadResult,
  getUploadResult,
};
