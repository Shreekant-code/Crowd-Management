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
  AI: "ai",
  PREVIEW: "preview",
};

const STREAM_STALE_MS = 12000;
const INITIAL_RETRY_DELAY_MS = 1000;

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

export function getFeedSource(camera, retrySeed, streamMode) {
  if (!camera?.id) {
    return null;
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

  return { label: "Direct Stream", tone: "bg-teal-100 text-teal-700 border-teal-200" };
}

export function useStreamManager({ camera, onLiveMetricsChange }) {
  const [status, setStatus] = useState(() =>
    camera?.status === "running" ? STREAM_STATES.CONNECTING : STREAM_STATES.IDLE
  );
  const [streamMode, setStreamMode] = useState(STREAM_MODES.AI);
  const [retrySeed, setRetrySeed] = useState(0);
  const [liveMetrics, setLiveMetrics] = useState(camera?.metrics || {});
  const [streamResolutionStatus, setStreamResolutionStatus] = useState(
    camera?.metrics?.stream_resolution_status || "direct"
  );

  const cameraRef = useRef(camera);
  const metricsRef = useRef(camera?.metrics || {});
  const reconnectTimerRef = useRef(null);
  const staleCheckTimerRef = useRef(null);
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

      if (merged.stream_resolution_status === "fallback_preview") {
        setStreamMode(STREAM_MODES.PREVIEW);
      }
    }
  }, [camera?.metrics]);

  useEffect(() => {
    setRetrySeed(0);
    setStreamMode(STREAM_MODES.AI);

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

    if (camera?.status === "running") {
      setStatus(STREAM_STATES.CONNECTING);
    } else {
      setStatus(STREAM_STATES.IDLE);
    }
  }, [camera?.id, camera?.status]);

  useEffect(() => {
    console.log(
      `[StreamManager] Stream status transition: camera=${camera?.id}, status=${status}, mode=${streamMode}, resolutionStatus=${streamResolutionStatus}`
    );
  }, [camera?.id, status, streamMode, streamResolutionStatus]);

  const handleBackendCameraUpdate = useCallback((updatedCamera) => {
    if (!updatedCamera?.id) return;
    cameraRef.current = updatedCamera;

    const nextMetrics = {
      ...(metricsRef.current || {}),
      ...(updatedCamera.metrics || {}),
      updatedAt: updatedCamera.metrics?.updatedAt || updatedCamera.lastFrameAt || new Date().toISOString(),
    };

    console.log(
      `[StreamManager] WebSocket metrics response received from backend: camera=${updatedCamera.id}, count=${nextMetrics.current_count ?? nextMetrics.count}, risk=${nextMetrics.risk}, resolution=${nextMetrics.stream_resolution_status}`
    );

    metricsRef.current = nextMetrics;
    setLiveMetrics(nextMetrics);

    const backendResStatus = nextMetrics.stream_resolution_status || updatedCamera.streamResolutionStatus;
    if (backendResStatus) {
      setStreamResolutionStatus(backendResStatus);
      if (backendResStatus === "fallback_preview") {
        setStreamMode(STREAM_MODES.PREVIEW);
      }
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

  const triggerReconnect = useCallback(() => {
    if (reconnectTimerRef.current) return;

    console.log(`[StreamManager] Triggering stream reconnect retry for camera=${cameraRef.current?.id}`);

    setStatus(STREAM_STATES.RECONNECTING);

    const currentResStatus = metricsRef.current?.stream_resolution_status;
    if (currentResStatus === "fallback_preview") {
      setStreamMode(STREAM_MODES.PREVIEW);
      setStatus(STREAM_STATES.FALLBACK_PREVIEW);
    }

    setRetrySeed((prev) => prev + 1);

    reconnectTimerRef.current = setTimeout(() => {
      reconnectTimerRef.current = null;
      if (cameraRef.current?.status === "running") {
        setStatus((curr) => (curr === STREAM_STATES.LIVE ? curr : STREAM_STATES.CONNECTING));
      }
    }, INITIAL_RETRY_DELAY_MS);
  }, []);

  const lastImageLoadAtRef = useRef(Date.now());

  const handleImageLoad = useCallback(() => {
    lastImageLoadAtRef.current = Date.now();
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    setStatus((curr) => {
      if (curr !== STREAM_STATES.LIVE) {
        console.log(`[StreamManager] Stream feed image loaded successfully in DOM: camera=${cameraRef.current?.id}`);
        return STREAM_STATES.LIVE;
      }
      return curr;
    });
  }, []);

  const handleImageError = useCallback(() => {
    console.error(`[StreamManager] Stream feed image load error on DOM element: camera=${cameraRef.current?.id}`);
    triggerReconnect();
  }, [triggerReconnect]);

  useEffect(() => {
    if (camera?.status !== "running" || status !== STREAM_STATES.LIVE) {
      return;
    }

    const checkStale = () => {
      // If the DOM image element loaded frames recently, the stream is active
      const imageAge = Date.now() - lastImageLoadAtRef.current;
      if (imageAge < STREAM_STALE_MS) {
        return;
      }

      const updatedAt = metricsRef.current?.updatedAt || cameraRef.current?.lastFrameAt;
      if (updatedAt) {
        const metricsAge = Date.now() - new Date(updatedAt).getTime();
        if (metricsAge > STREAM_STALE_MS) {
          console.warn(
            `[StreamManager] Stream declared stale: imageAge=${imageAge}ms, metricsAge=${metricsAge}ms for camera=${cameraRef.current?.id}`
          );
          triggerReconnect();
        }
      }
    };

    staleCheckTimerRef.current = setInterval(checkStale, 3000);

    return () => {
      if (staleCheckTimerRef.current) {
        clearInterval(staleCheckTimerRef.current);
      }
    };
  }, [camera?.status, status, triggerReconnect]);

  const feedSource = getFeedSource(camera, retrySeed, streamMode);
  const sourceBadge = getSourceBadgeInfo(camera, streamResolutionStatus, streamMode);

  return {
    status,
    streamMode,
    retrySeed,
    feedSource,
    liveMetrics,
    streamResolutionStatus,
    sourceBadge,
    handleImageLoad,
    handleImageError,
    reconnect: triggerReconnect,
  };
}
