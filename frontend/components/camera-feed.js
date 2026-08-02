"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, VideoOff } from "lucide-react";

const STREAM_STALE_MS = 12000;
const STREAM_RETRY_MS = 8000;

function getFeedSource(camera, retrySeed, streamMode) {
  if (!camera?.id) {
    return null;
  }

  if (streamMode === "ai") {
    return `/api/stream/${camera.id}?retry=${retrySeed}`;
  }

  return `/api/platform/cameras/${camera.id}/preview?retry=${retrySeed}&mode=${streamMode}`;
}

function getStreamStatus(camera, metrics, imageErrored, isLoaded) {
  if (camera.status !== "running") {
    return "idle";
  }

  if (imageErrored) {
    return "reconnecting";
  }

  const updatedAt = metrics?.updatedAt || camera.lastFrameAt || camera.lastStartedAt;
  if (updatedAt) {
    const ageMs = Date.now() - new Date(updatedAt).getTime();
    if (ageMs > STREAM_STALE_MS) {
      return "reconnecting";
    }
  }

  return isLoaded ? "live" : "connecting";
}

function getRiskAccent(risk) {
  if (risk === "Critical") {
    return {
      stroke: "rgba(248, 113, 113, 0.98)",
      fill: "rgba(127, 29, 29, 0.18)",
      chip: "rgba(127, 29, 29, 0.74)",
      line: "rgba(248, 113, 113, 0.85)",
    };
  }

  if (risk === "High") {
    return {
      stroke: "rgba(251, 146, 60, 0.98)",
      fill: "rgba(154, 52, 18, 0.16)",
      chip: "rgba(154, 52, 18, 0.72)",
      line: "rgba(251, 146, 60, 0.82)",
    };
  }

  if (risk === "Medium") {
    return {
      stroke: "rgba(250, 204, 21, 0.98)",
      fill: "rgba(133, 77, 14, 0.15)",
      chip: "rgba(133, 77, 14, 0.72)",
      line: "rgba(250, 204, 21, 0.80)",
    };
  }

  return {
    stroke: "rgba(45, 212, 191, 0.98)",
    fill: "rgba(15, 118, 110, 0.16)",
    chip: "rgba(15, 118, 110, 0.72)",
    line: "rgba(45, 212, 191, 0.78)",
  };
}

function getDisplayRect(image, width, height) {
  const naturalWidth = image.naturalWidth || 0;
  const naturalHeight = image.naturalHeight || 0;
  if (!naturalWidth || !naturalHeight) {
    return {
      scale: 1,
      displayWidth: width,
      displayHeight: height,
      offsetX: 0,
      offsetY: 0,
    };
  }

  const ratioX = width / naturalWidth;
  const ratioY = height / naturalHeight;
  const scale = Math.min(ratioX, ratioY);
  const displayWidth = naturalWidth * scale;
  const displayHeight = naturalHeight * scale;
  return {
    scale,
    displayWidth,
    displayHeight,
    offsetX: Math.max((width - displayWidth) / 2, 0),
    offsetY: Math.max((height - displayHeight) / 2, 0),
  };
}

function getDetectionBox(detection = {}) {
  if (Array.isArray(detection.bbox) && detection.bbox.length >= 4) {
    const [x = 0, y = 0, w = 0, h = 0] = detection.bbox;
    return [x, y, w, h];
  }

  if (Array.isArray(detection.bbox_xyxy) && detection.bbox_xyxy.length >= 4) {
    const [x1 = 0, y1 = 0, x2 = 0, y2 = 0] = detection.bbox_xyxy;
    return [x1, y1, Math.max(x2 - x1, 0), Math.max(y2 - y1, 0)];
  }

  if (Array.isArray(detection.bbox_xywh) && detection.bbox_xywh.length >= 4) {
    const [x = 0, y = 0, w = 0, h = 0] = detection.bbox_xywh;
    return [x, y, w, h];
  }

  return [0, 0, 0, 0];
}

export function CameraFeed({ camera, onLiveMetricsChange, compact = false }) {
  const imageRef = useRef(null);
  const canvasRef = useRef(null);
  const [liveMetrics, setLiveMetrics] = useState(camera.metrics || {});
  const metricsRef = useRef(camera.metrics || {});
  const mediaSizeRef = useRef({ width: 960, height: 540 });
  const [retrySeed, setRetrySeed] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [imageErrored, setImageErrored] = useState(false);
  const [mediaSize, setMediaSize] = useState({ width: 960, height: 540 });
  const [streamStartedAt, setStreamStartedAt] = useState(() => Date.now());
  const [streamMode, setStreamMode] = useState("ai");
  const [streamResolutionStatus, setStreamResolutionStatus] = useState("direct");
  const streamStatus = getStreamStatus(camera, liveMetrics, imageErrored, isLoaded);
  const feedSource = useMemo(
    () => getFeedSource(camera, retrySeed, streamMode),
    [camera, retrySeed, streamMode]
  );
  const riskAccent = getRiskAccent(liveMetrics?.risk || "Low");
  const sourceBadge = useMemo(() => {
    if (camera.status !== "running") {
      return { label: "Stopped", tone: "bg-slate-100 text-slate-500 border-slate-200" };
    }

    if (camera.sourceType === "public") {
      if (streamResolutionStatus === "fallback_preview") {
        return { label: "Fallback preview", tone: "bg-amber-100 text-amber-700 border-amber-200" };
      }
      if (streamResolutionStatus === "unresolved") {
        return { label: "Unresolved", tone: "bg-red-100 text-red-700 border-red-200" };
      }
      return { label: "Public stream", tone: "bg-sky-100 text-sky-700 border-sky-200" };
    }

    return { label: "Direct stream", tone: "bg-teal-100 text-teal-700 border-teal-200" };
  }, [camera.sourceType, camera.status, streamResolutionStatus]);

  useEffect(() => {
    const mergedMetrics = camera.metrics || {};
    setLiveMetrics(mergedMetrics);
    metricsRef.current = mergedMetrics;
  }, [camera.metrics]);

  useEffect(() => {
    setRetrySeed(0);
    setIsLoaded(false);
    setImageErrored(false);
    setStreamStartedAt(Date.now());
    setStreamMode("ai");
    setStreamResolutionStatus("direct");
  }, [camera.id]);

  useEffect(() => {
    mediaSizeRef.current = mediaSize;
  }, [mediaSize]);

  useEffect(() => {
    if (camera.status !== "running" || !camera.id) {
      return undefined;
    }

    let cancelled = false;

    async function refreshStats() {
      try {
        const response = await fetch(`/api/stream/${camera.id}/stats`, { cache: "no-store" });
        if (!response.ok) {
          return;
        }

        const payload = await response.json();
        if (cancelled) {
          return;
        }

        const nextMetrics = payload?.metrics || {};
        setLiveMetrics(nextMetrics);
        metricsRef.current = nextMetrics;
        if (payload?.stream_resolution_status) {
          setStreamResolutionStatus(payload.stream_resolution_status);
        } else if (nextMetrics?.stream_resolution_status) {
          setStreamResolutionStatus(nextMetrics.stream_resolution_status);
        } else if (camera.sourceType === "public") {
          setStreamResolutionStatus(streamMode === "preview" ? "fallback_preview" : "direct");
        } else {
          setStreamResolutionStatus("direct");
        }
        if (onLiveMetricsChange) {
          onLiveMetricsChange(camera.id, nextMetrics, payload?.updatedAt);
        }
      } catch (_error) {
        // Keep last known metrics when polling briefly fails.
      }
    }

    void refreshStats();
    const interval = setInterval(() => {
      void refreshStats();
    }, 400);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [camera.id, camera.status, camera.sourceType, onLiveMetricsChange, streamMode]);

  useEffect(() => {
    if (camera.status !== "running") {
      setIsLoaded(false);
      setImageErrored(false);
      return;
    }

    if (!imageErrored) {
      return;
    }

    const timeout = setTimeout(() => {
      if (streamMode === "ai") {
        setStreamMode("preview");
        if (camera.sourceType === "public") {
          setStreamResolutionStatus("fallback_preview");
        }
        setRetrySeed(0);
      } else {
        setRetrySeed((current) => current + 1);
      }
      setImageErrored(false);
      setIsLoaded(false);
    }, 1500);

    return () => clearTimeout(timeout);
  }, [camera.status, imageErrored, streamMode]);

  useEffect(() => {
    if (camera.status !== "running" || isLoaded) {
      return undefined;
    }

    const timeout = setTimeout(() => {
      if (streamMode === "ai") {
        setStreamMode("preview");
        if (camera.sourceType === "public") {
          setStreamResolutionStatus("fallback_preview");
        }
        setRetrySeed(0);
      } else {
        setRetrySeed((current) => current + 1);
      }
      setImageErrored(false);
      setIsLoaded(false);
      setStreamStartedAt(Date.now());
    }, STREAM_RETRY_MS);

    return () => clearTimeout(timeout);
  }, [camera.status, isLoaded, retrySeed, streamMode]);

  useEffect(() => {
    if (camera.status !== "running" || isLoaded || !feedSource) {
      return undefined;
    }

    const interval = setInterval(() => {
      const image = imageRef.current;
      if (!image) {
        return;
      }

      const naturalWidth = image.naturalWidth || 0;
      const naturalHeight = image.naturalHeight || 0;
      if (naturalWidth > 0 && naturalHeight > 0) {
        setMediaSize({
          width: naturalWidth,
          height: naturalHeight,
        });
        setIsLoaded(true);
        setImageErrored(false);
      }
    }, 500);

    return () => clearInterval(interval);
  }, [camera.status, feedSource, isLoaded]);

  useEffect(() => {
    const updatedAt = liveMetrics?.updatedAt || camera.lastFrameAt || camera.lastStartedAt;
    if (!updatedAt || isLoaded || camera.status !== "running") {
      return;
    }

    const ageMs = Date.now() - new Date(updatedAt).getTime();
    const loadingMs = Date.now() - streamStartedAt;
    if (ageMs < STREAM_STALE_MS / 2 && loadingMs > STREAM_RETRY_MS) {
      if (streamMode === "ai") {
        setStreamMode("preview");
        if (camera.sourceType === "public") {
          setStreamResolutionStatus("fallback_preview");
        }
        setRetrySeed(0);
      } else {
        setRetrySeed((current) => current + 1);
      }
      setImageErrored(false);
      setIsLoaded(false);
      setStreamStartedAt(Date.now());
    }
  }, [camera.lastFrameAt, camera.lastStartedAt, camera.status, isLoaded, liveMetrics?.updatedAt, streamMode, streamStartedAt]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const image = imageRef.current;
    if (!canvas || !image || !isLoaded) {
      return;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }
    let animationFrameId = 0;
    let lastDrawAt = 0;

    const drawOverlay = () => {
      const now = performance.now();
      if (now - lastDrawAt < 100) {
        animationFrameId = window.requestAnimationFrame(drawOverlay);
        return;
      }
      lastDrawAt = now;

      const rect = image.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(Math.round(rect.width), 1);
      const height = Math.max(Math.round(rect.height), 1);

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const metrics = metricsRef.current || {};
      const sourceWidth = mediaSizeRef.current.width || width;
      const sourceHeight = mediaSizeRef.current.height || height;
      const display = getDisplayRect(image, width, height);
      const scaleX = display.displayWidth / sourceWidth;
      const scaleY = display.displayHeight / sourceHeight;
      const offsetX = display.offsetX;
      const offsetY = display.offsetY;
      const heatmapPoints = Array.isArray(metrics.heatmap_points) ? metrics.heatmap_points : [];
      const recentHeatmapPoints = heatmapPoints.slice(-120);

      for (let index = 0; index < recentHeatmapPoints.length; index += 1) {
        const point = recentHeatmapPoints[index];
        const recency = (index + 1) / Math.max(recentHeatmapPoints.length, 1);
        const x = offsetX + (point.x ?? 0) * scaleX;
        const y = offsetY + (point.y ?? 0) * scaleY;
        const radius = 10 + recency * 24;
        const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
        gradient.addColorStop(0, `rgba(239, 68, 68, ${0.22 + recency * 0.28})`);
        gradient.addColorStop(0.35, `rgba(249, 115, 22, ${0.12 + recency * 0.18})`);
        gradient.addColorStop(0.68, `rgba(250, 204, 21, ${0.06 + recency * 0.12})`);
        gradient.addColorStop(1, "rgba(250, 204, 21, 0)");
        context.fillStyle = gradient;
        context.beginPath();
        context.arc(x, y, radius, 0, Math.PI * 2);
        context.fill();
      }

      const detections = Array.isArray(metrics.detections) ? metrics.detections : [];
      const accent = getRiskAccent(metrics.risk || "Low");

      context.lineWidth = 2;
      context.font = "12px sans-serif";
      for (const detection of detections) {
        const [x = 0, y = 0, w = 0, h = 0] = getDetectionBox(detection);
        const left = offsetX + x * scaleX;
        const top = offsetY + y * scaleY;
        const boxWidth = w * scaleX;
        const boxHeight = h * scaleY;

        context.strokeStyle = accent.stroke;
        context.fillStyle = accent.fill;
        context.strokeRect(left, top, boxWidth, boxHeight);
        context.fillRect(left, top, boxWidth, boxHeight);

        const label = `ID: ${detection.id ?? "-"}`;
        const textWidth = context.measureText(label).width;
        context.fillStyle = accent.chip;
        context.fillRect(left, Math.max(top - 18, 0), textWidth + 10, 18);
        context.fillStyle = "#f8fafc";
        context.fillText(label, left + 5, Math.max(top - 5, 12));
      }
      animationFrameId = window.requestAnimationFrame(drawOverlay);
    };

    animationFrameId = window.requestAnimationFrame(drawOverlay);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [isLoaded, mediaSize, retrySeed, streamMode]);

  useEffect(() => {
    function handleResize() {
      const image = imageRef.current;
      if (!image || !image.complete) {
        return;
      }

      setMediaSize({
        width: image.naturalWidth || 960,
        height: image.naturalHeight || 540,
      });
    }

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  return (
    <div className="mt-4 space-y-3">
      <div className={`relative overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_top,rgba(72,208,193,0.18),transparent_35%),rgba(255,255,255,0.04)] ${compact ? "aspect-video" : "h-[38rem]"}`}>
        {camera.status === "running" && feedSource ? (
          <>
            <img
              key={feedSource}
              ref={imageRef}
              alt={`${camera.zoneName} live feed`}
              className={`h-full w-full bg-slate-950 ${compact ? "object-cover" : "object-contain"}`}
              onError={() => {
                setImageErrored(true);
                setIsLoaded(false);
                setStreamStartedAt(Date.now());
                if (camera.sourceType === "public") {
                  setStreamResolutionStatus("unresolved");
                }
              }}
              onLoad={(event) => {
                const target = event.currentTarget;
                setMediaSize({
                  width: target.naturalWidth || 960,
                  height: target.naturalHeight || 540,
                });
                setIsLoaded(true);
                setImageErrored(false);
                setStreamStartedAt(Date.now());
                if (camera.sourceType === "public") {
                  setStreamResolutionStatus(streamMode === "preview" ? "fallback_preview" : "direct");
                }
              }}
              src={feedSource}
            />
            {isLoaded ? (
              <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
            ) : null}
            {isLoaded ? (
              <>
                <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-slate-950/70 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-white">
                  {streamMode === "ai" ? "Live" : "Preview"}
                </div>
                <div className={`pointer-events-none absolute left-3 top-3 z-10 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${sourceBadge.tone}`}>
                  {sourceBadge.label}
                </div>
                <div className="pointer-events-none absolute left-3 top-11 z-10 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
                  Count {Number(liveMetrics?.current_count ?? liveMetrics?.count ?? liveMetrics?.people_count ?? 0)}
                </div>
              </>
            ) : null}
            {streamStatus !== "live" ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/68">
                <div className="text-center text-white">
                  <LoaderCircle className="mx-auto h-7 w-7 animate-spin text-teal-300" />
                  <p className="mt-2 text-sm font-medium">
                    {streamStatus === "reconnecting" ? "Reconnecting..." : "Connecting..."}
                  </p>
                  <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-white/55">
                    {sourceBadge.label}
                  </p>
                </div>
              </div>
            ) : null}
          </>
        ) : (
          <div className="flex h-full items-center justify-center">
            <div className="text-center text-white">
              <VideoOff className="mx-auto h-8 w-8 text-white/70" />
              <p className="mt-2 text-sm text-white/70">Start camera to view live preview</p>
              <p className="mt-2 text-[11px] uppercase tracking-[0.16em] text-white/55">
                {sourceBadge.label}
              </p>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
