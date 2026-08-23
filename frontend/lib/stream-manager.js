"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { getSocket } from "./socket";

export const STREAM_STATES = {
  IDLE: "idle",
  CONNECTING: "connecting",
  LIVE: "live",
  RECONNECTING: "reconnecting",
  FALLBACK_PREVIEW: "fallback_preview",
  FAILED: "failed",
};

export const STREAM_MODES = {
  WEBRTC: "webrtc",
  AI: "ai",
  PREVIEW: "preview",
};

export const MEDIAMTX_WHEP_BASE =
  process.env.NEXT_PUBLIC_MEDIAMTX_WHEP_URL || "http://localhost:8889";

// Centralized Socket Subscriber Hub to avoid duplicate socket listeners per camera
class StreamSocketHub {
  constructor() {
    this.listeners = new Map();
    this.socketPromise = null;
    this.activeSocket = null;
    this.isSubscribed = false;
  }

  async init() {
    if (this.socketPromise) return this.socketPromise;

    this.socketPromise = (async () => {
      try {
        const socket = await getSocket();
        this.activeSocket = socket;

        if (!this.isSubscribed) {
          this.isSubscribed = true;

          socket.on("camera:update", (camera) => {
            if (!camera?.id) return;
            const callbacks = this.listeners.get(camera.id);
            if (callbacks) {
              callbacks.forEach((cb) => cb(camera));
            }
          });

          socket.on("dashboard:update", (payload) => {
            if (!Array.isArray(payload?.cameras)) return;
            payload.cameras.forEach((camera) => {
              if (!camera?.id) return;
              const callbacks = this.listeners.get(camera.id);
              if (callbacks) {
                callbacks.forEach((cb) => cb(camera));
              }
            });
          });
        }
        return socket;
      } catch (err) {
        console.error("[StreamSocketHub] Failed to initialize socket", err);
        this.socketPromise = null;
        throw err;
      }
    })();

    return this.socketPromise;
  }

  subscribe(cameraId, callback) {
    if (!this.listeners.has(cameraId)) {
      this.listeners.set(cameraId, new Set());
    }
    this.listeners.get(cameraId).add(callback);
    this.init();

    return () => {
      const callbacks = this.listeners.get(cameraId);
      if (callbacks) {
        callbacks.delete(callback);
        if (callbacks.size === 0) {
          this.listeners.delete(cameraId);
        }
      }
    };
  }
}

const socketHub = new StreamSocketHub();

export function getWhepUrl(camera) {
  if (!camera?.id) return null;
  if (camera.webrtcUrl) return camera.webrtcUrl;
  if (camera.metrics?.webrtc_url) return camera.metrics.webrtc_url;
  const safeId = String(camera.id).replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${MEDIAMTX_WHEP_BASE}/cam_${safeId}/whep`;
}

export function getFeedSource(camera, retrySeed, streamMode) {
  if (!camera?.id) {
    return null;
  }

  if (streamMode === STREAM_MODES.WEBRTC) {
    return getWhepUrl(camera);
  }

  if (streamMode === STREAM_MODES.AI) {
    return `/api/stream/${camera.id}?retry=${retrySeed}`;
  }

  return `/api/platform/cameras/${camera.id}/preview?retry=${retrySeed}&mode=${streamMode}`;
}

export function getSourceBadgeInfo(camera, streamResolutionStatus, streamMode) {
  if (camera?.status !== "running") {
    return { label: "Stopped", tone: "bg-slate-100 text-slate-500 border-slate-200" };
  }

  const resStatus = String(
    streamResolutionStatus || camera?.metrics?.stream_resolution_status || ""
  ).toLowerCase();
  const sourceType = String(camera?.sourceType || "").toLowerCase();

  if (resStatus === "fallback_preview" || streamMode === STREAM_MODES.PREVIEW) {
    return { label: "Fallback preview", tone: "bg-amber-100 text-amber-700 border-amber-200" };
  }

  if (resStatus === "unresolved") {
    return { label: "Unresolved", tone: "bg-red-100 text-red-700 border-red-200" };
  }

  if (resStatus === "youtube_resolved") {
    return { label: "YouTube Live", tone: "bg-red-50 text-red-600 border-red-200" };
  }

  if (resStatus === "public_resolved" || sourceType === "public") {
    return { label: "Public Stream", tone: "bg-sky-100 text-sky-700 border-sky-200" };
  }

  if (resStatus === "connecting" || resStatus === "resolving") {
    return { label: "Resolving stream", tone: "bg-yellow-100 text-yellow-800 border-yellow-200" };
  }

  return { label: "WebRTC Live", tone: "bg-teal-100 text-teal-700 border-teal-200" };
}

export function useStreamManager({ camera, onLiveMetricsChange }) {
  const [status, setStatus] = useState(() =>
    camera?.status === "running" ? STREAM_STATES.CONNECTING : STREAM_STATES.IDLE
  );
  const [streamMode, setStreamMode] = useState(STREAM_MODES.WEBRTC);
  const [retrySeed, setRetrySeed] = useState(0);
  const [liveMetrics, setLiveMetrics] = useState(camera?.metrics || {});
  const [streamResolutionStatus, setStreamResolutionStatus] = useState(
    camera?.metrics?.stream_resolution_status || "direct"
  );

  const cameraRef = useRef(camera);
  const metricsRef = useRef(camera?.metrics || {});
  const onLiveMetricsChangeRef = useRef(onLiveMetricsChange);

  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  useEffect(() => {
    onLiveMetricsChangeRef.current = onLiveMetricsChange;
  }, [onLiveMetricsChange]);

  useEffect(() => {
    if (camera?.metrics) {
      const merged = camera.metrics;
      setLiveMetrics(merged);
      metricsRef.current = merged;

      if (merged.stream_resolution_status) {
        setStreamResolutionStatus(merged.stream_resolution_status);
      }
    }
  }, [camera?.metrics]);

  useEffect(() => {
    setRetrySeed(0);
    setStreamMode(STREAM_MODES.WEBRTC);

    if (camera?.status === "running") {
      setStatus(STREAM_STATES.CONNECTING);
    } else {
      setStatus(STREAM_STATES.IDLE);
    }
  }, [camera?.id, camera?.status]);

  const handleBackendCameraUpdate = useCallback((updatedCamera) => {
    if (!updatedCamera?.id) return;
    cameraRef.current = updatedCamera;

    const nextMetrics = {
      ...(metricsRef.current || {}),
      ...(updatedCamera.metrics || {}),
      updatedAt: updatedCamera.metrics?.updatedAt || updatedCamera.lastFrameAt || new Date().toISOString(),
    };

    metricsRef.current = nextMetrics;
    setLiveMetrics(nextMetrics);

    const backendResStatus = nextMetrics.stream_resolution_status || updatedCamera.streamResolutionStatus;
    if (backendResStatus) {
      setStreamResolutionStatus(backendResStatus);
    }

    if (nextMetrics.camera_health === "unstable" || nextMetrics.processing_status === "error") {
      if (updatedCamera.sourceType === "public" && backendResStatus === "unresolved") {
        setStatus(STREAM_STATES.FAILED);
      }
    }

    if (onLiveMetricsChangeRef.current) {
      onLiveMetricsChangeRef.current(updatedCamera.id, nextMetrics, nextMetrics.updatedAt);
    }
  }, []);

  useEffect(() => {
    if (!camera?.id || camera.status !== "running") return;

    const unsubscribe = socketHub.subscribe(camera.id, handleBackendCameraUpdate);
    return () => {
      unsubscribe();
    };
  }, [camera?.id, camera?.status, handleBackendCameraUpdate]);

  const whepUrl = getWhepUrl(camera);
  const feedSource = getFeedSource(camera, retrySeed, streamMode);
  const sourceBadge = getSourceBadgeInfo(camera, streamResolutionStatus, streamMode);

  return {
    status,
    setStatus,
    streamMode,
    setStreamMode,
    whepUrl,
    feedSource,
    liveMetrics,
    streamResolutionStatus,
    sourceBadge,
    retrySeed,
  };
}
