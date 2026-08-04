"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, VideoOff } from "lucide-react";
import { useStreamManager, STREAM_STATES, STREAM_MODES } from "@/lib/stream-manager";

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
  const mediaSizeRef = useRef({ width: 960, height: 540 });
  const [mediaSize, setMediaSize] = useState({ width: 960, height: 540 });

  const containerRef = useRef(null);
  const boundsRef = useRef({ width: 960, height: 540, naturalWidth: 960, naturalHeight: 540 });

  const {
    status: streamStatus,
    streamMode,
    feedSource,
    liveMetrics,
    streamResolutionStatus,
    sourceBadge,
    handleImageLoad: onStreamManagerLoad,
    handleImageError: onStreamManagerError,
  } = useStreamManager({ camera, onLiveMetricsChange });

  const metricsRef = useRef(liveMetrics);

  useEffect(() => {
    metricsRef.current = liveMetrics;
  }, [liveMetrics]);

  useEffect(() => {
    mediaSizeRef.current = mediaSize;
  }, [mediaSize]);

  // Use ResizeObserver to cache layout dimensions without layout thrashing inside rAF
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateBounds = () => {
      const rect = container.getBoundingClientRect();
      const image = imageRef.current;
      boundsRef.current = {
        width: Math.max(Math.round(rect.width), 1),
        height: Math.max(Math.round(rect.height), 1),
        naturalWidth: image?.naturalWidth || mediaSizeRef.current.width || 960,
        naturalHeight: image?.naturalHeight || mediaSizeRef.current.height || 540,
      };
    };

    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  const isLive = streamStatus === STREAM_STATES.LIVE;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isLive) {
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
      if (now - lastDrawAt < 80) {
        animationFrameId = window.requestAnimationFrame(drawOverlay);
        return;
      }
      lastDrawAt = now;

      const { width, height, naturalWidth, naturalHeight } = boundsRef.current;
      const dpr = window.devicePixelRatio || 1;

      if (canvas.width !== width * dpr || canvas.height !== height * dpr) {
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        canvas.style.width = `${width}px`;
        canvas.style.height = `${height}px`;
      }

      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      context.clearRect(0, 0, width, height);

      const metrics = metricsRef.current || {};
      const sourceWidth = mediaSizeRef.current.width || naturalWidth || width;
      const sourceHeight = mediaSizeRef.current.height || naturalHeight || height;

      // Pure math scaling calculation without DOM query reflows
      const ratioX = width / Math.max(naturalWidth, 1);
      const ratioY = height / Math.max(naturalHeight, 1);
      const scale = Math.min(ratioX, ratioY);
      const displayWidth = naturalWidth * scale;
      const displayHeight = naturalHeight * scale;
      const offsetX = Math.max((width - displayWidth) / 2, 0);
      const offsetY = Math.max((height - displayHeight) / 2, 0);

      const scaleX = displayWidth / Math.max(sourceWidth, 1);
      const scaleY = displayHeight / Math.max(sourceHeight, 1);
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
  }, [isLive]);

  useEffect(() => {
    if (camera.status !== "running" || !feedSource) {
      return undefined;
    }

    const checkLoaded = () => {
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
      }
      onStreamManagerLoad();
    };

    checkLoaded();
    const interval = setInterval(checkLoaded, 2000);
    return () => clearInterval(interval);
  }, [camera.id, camera.status, feedSource, onStreamManagerLoad]);

  return (
    <div className="mt-4 space-y-3">
      <div
        ref={containerRef}
        className={`relative overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_top,rgba(72,208,193,0.18),transparent_35%),rgba(255,255,255,0.04)] ${compact ? "aspect-video" : "h-[38rem]"}`}
      >
        {camera.status === "running" && feedSource ? (
          <>
            <img
              ref={imageRef}
              alt={`${camera.zoneName} live feed`}
              fetchPriority="high"
              decoding="async"
              loading="eager"
              className={`h-full w-full bg-slate-950 ${compact ? "object-cover" : "object-contain"}`}
              onError={() => {
                console.error(`[CameraFeed] Stream image failed to render on DOM: camera=${camera.id}, src=${feedSource}`);
                onStreamManagerError();
              }}
              onLoad={(event) => {
                const target = event.currentTarget;
                const naturalWidth = target.naturalWidth || 960;
                const naturalHeight = target.naturalHeight || 540;
                setMediaSize({
                  width: naturalWidth,
                  height: naturalHeight,
                });
                onStreamManagerLoad();
              }}
              src={feedSource}
            />
            {isLive ? (
              <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
            ) : null}
            {isLive ? (
              <>
                <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-slate-950/70 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-white">
                  {streamMode === STREAM_MODES.AI ? "Live" : "Preview"}
                </div>
                <div className={`pointer-events-none absolute left-3 top-3 z-10 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${sourceBadge.tone}`}>
                  {sourceBadge.label}
                </div>
                <div className="pointer-events-none absolute left-3 top-11 z-10 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
                  Count {Number(liveMetrics?.current_count ?? liveMetrics?.count ?? liveMetrics?.people_count ?? 0)}
                </div>
              </>
            ) : null}
            {streamStatus !== STREAM_STATES.LIVE ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/68">
                <div className="text-center text-white">
                  <LoaderCircle className="mx-auto h-7 w-7 animate-spin text-teal-300" />
                  <p className="mt-2 text-sm font-medium">
                    {streamStatus === STREAM_STATES.RECONNECTING ? "Reconnecting..." : streamStatus === STREAM_STATES.FALLBACK_PREVIEW ? "Connecting Fallback..." : "Connecting..."}
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
