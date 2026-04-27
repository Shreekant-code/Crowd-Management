const streamStates = new Map();
const uploadResults = new Map();
const pendingUploadFiles = new Map();

function getStreamState(cameraId) {
  return streamStates.get(cameraId) || null;
}

function markStreamStarted(cameraId) {
  streamStates.set(cameraId, {
    ...(streamStates.get(cameraId) || {}),
    active: true,
    lastStartAttemptAt: Date.now(),
    lastError: null,
  });
}

function markStreamStopped(cameraId) {
  streamStates.delete(cameraId);
}

function markStreamFailure(cameraId, error) {
  streamStates.set(cameraId, {
    ...(streamStates.get(cameraId) || {}),
    active: false,
    lastStartAttemptAt: Date.now(),
    lastError: error.message,
  });
}

function saveUploadResult(jobId, payload) {
  uploadResults.set(jobId, {
    ...payload,
    receivedAt: new Date().toISOString(),
  });
}

function getUploadResult(jobId) {
  return uploadResults.get(jobId) || null;
}

function registerUploadFiles(jobId, paths) {
  pendingUploadFiles.set(jobId, [...new Set((paths || []).filter(Boolean))]);
}

function takeUploadFiles(jobId) {
  const paths = pendingUploadFiles.get(jobId) || [];
  pendingUploadFiles.delete(jobId);
  return paths;
}

export {
  getStreamState,
  markStreamStarted,
  markStreamStopped,
  markStreamFailure,
  saveUploadResult,
  getUploadResult,
  registerUploadFiles,
  takeUploadFiles,
};
