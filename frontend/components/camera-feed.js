"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, VideoOff, AlertCircle, Scan, Disc, Layers } from "lucide-react";
import { useStreamManager, STREAM_STATES, STREAM_MODES } from "@/lib/stream-manager";
import { WhepClient } from "@/lib/whep-client";

function getRiskAccent(risk) {
  if (risk === "Critical") {
    return {
      stroke: "rgba(248, 113, 113, 0.95)",
      fill: "rgba(239, 68, 68, 0.12)",
      line: "rgba(248, 113, 113, 0.85)",
    };
  }

  if (risk === "High") {
    return {
      stroke: "rgba(251, 146, 60, 0.95)",
      fill: "rgba(249, 115, 22, 0.10)",
      line: "rgba(251, 146, 60, 0.82)",
    };
  }

  if (risk === "Medium") {
    return {
      stroke: "rgba(250, 204, 21, 0.95)",
      fill: "rgba(234, 179, 8, 0.10)",
      line: "rgba(250, 204, 21, 0.80)",
    };
  }

  return {
    stroke: "rgba(45, 212, 191, 0.95)",
    fill: "rgba(20, 184, 166, 0.10)",
    line: "rgba(45, 212, 191, 0.78)",
  };
}

function getDetectionBox(detection = {}) {
  if (Array.isArray(detection.bbox_norm) && detection.bbox_norm.length >= 4) {
    const [x = 0, y = 0, w = 0, h = 0] = detection.bbox_norm;
    return [x, y, w, h];
  }

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

function getDetectionPoint(detection = {}) {
  if (Array.isArray(detection.point_norm) && detection.point_norm.length >= 2) {
    return [detection.point_norm[0], detection.point_norm[1]];
  }

  if (Array.isArray(detection.point) && detection.point.length >= 2) {
    return [detection.point[0], detection.point[1]];
  }

  if (Array.isArray(detection.bbox_norm) && detection.bbox_norm.length >= 4) {
    return [
      detection.bbox_norm[0] + detection.bbox_norm[2] / 2,
      detection.bbox_norm[1] + detection.bbox_norm[3] / 2,
    ];
  }

  if (Array.isArray(detection.bbox) && detection.bbox.length >= 4) {
    return [
      detection.bbox[0] + detection.bbox[2] / 2,
      detection.bbox[1] + detection.bbox[3] / 2,
    ];
  }

  return [0, 0];
}

export function CameraFeed({ camera, onLiveMetricsChange, compact = false }) {
  const videoRef = useRef(null);
  const imageRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const boundsRef = useRef({ width: 960, height: 540, videoWidth: 960, videoHeight: 540 });
  const [overlayMode, setOverlayMode] = useState("off"); // "off" | "boxes" | "points" | "both"

  const {
    status: streamStatus,
    setStatus: setStreamStatus,
    streamMode,
    setStreamMode,
    whepUrl,
    feedSource,
    liveMetrics,
    sourceBadge,
  } = useStreamManager({ camera, onLiveMetricsChange });

  const metricsRef = useRef(liveMetrics);
  const isRunning = camera?.status === "running";

  useEffect(() => {
    metricsRef.current = liveMetrics;
  }, [liveMetrics]);

  // Layout bounds tracking via ResizeObserver
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const updateBounds = () => {
      const rect = container.getBoundingClientRect();
      const video = videoRef.current;
      const img = imageRef.current;
      const vw = video?.videoWidth || img?.naturalWidth || 960;
      const vh = video?.videoHeight || img?.naturalHeight || 540;

      boundsRef.current = {
        width: Math.max(Math.round(rect.width), 320),
        height: Math.max(Math.round(rect.height), 180),
        videoWidth: vw,
        videoHeight: vh,
      };
    };

    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  // WebRTC WHEP connection lifecycle
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !isRunning || !whepUrl || streamMode !== STREAM_MODES.WEBRTC) {
      return undefined;
    }

    let isSubscribed = true;
    const client = new WhepClient({
      url: whepUrl,
      onStateChange: (newState) => {
        if (!isSubscribed) return;
        if (newState === "live") {
          setStreamStatus(STREAM_STATES.LIVE);
        } else if (newState === "failed") {
          setStreamMode(STREAM_MODES.PREVIEW);
          setStreamStatus(STREAM_STATES.FALLBACK_PREVIEW);
        }
      },
    });

    client.connect(video).catch((err) => {
      if (isSubscribed && isRunning) {
        setStreamMode(STREAM_MODES.PREVIEW);
        setStreamStatus(STREAM_STATES.FALLBACK_PREVIEW);
      }
    });

    return () => {
      isSubscribed = false;
      client.disconnect();
    };
  }, [camera.id, isRunning, whepUrl, streamMode, setStreamStatus, setStreamMode]);

  const isLive = streamStatus === STREAM_STATES.LIVE || streamStatus === STREAM_STATES.FALLBACK_PREVIEW;

  // Clean Real-Time Per-Frame Canvas Overlay (Approach 3: Zero-lag Instant Identification)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isLive || overlayMode === "off") {
      return undefined;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return undefined;
    }

    let animationFrameId = 0;

    const drawOverlay = () => {
      const video = videoRef.current;
      const img = imageRef.current;
      const { width, height } = boundsRef.current;
      const videoWidth = video?.videoWidth || img?.naturalWidth || boundsRef.current.videoWidth || 960;
      const videoHeight = video?.videoHeight || img?.naturalHeight || boundsRef.current.videoHeight || 540;
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
      const detections = Array.isArray(metrics.detections) ? metrics.detections : [];

      const containerRatio = width / height;
      const videoRatio = videoWidth / videoHeight;

      let renderWidth, renderHeight, offsetX, offsetY;

      if (compact) {
        if (containerRatio > videoRatio) {
          renderWidth = width;
          renderHeight = width / videoRatio;
          offsetX = 0;
          offsetY = (height - renderHeight) / 2;
        } else {
          renderHeight = height;
          renderWidth = videoRatio * height;
          offsetX = (width - renderWidth) / 2;
          offsetY = 0;
        }
      } else {
        if (containerRatio > videoRatio) {
          renderHeight = height;
          renderWidth = videoRatio * height;
          offsetX = (width - renderWidth) / 2;
          offsetY = 0;
        } else {
          renderWidth = width;
          renderHeight = width / videoRatio;
          offsetX = 0;
          offsetY = (height - renderHeight) / 2;
        }
      }

      function toScreen(x, y, w, h) {
        const isNorm = x <= 1.0 && y <= 1.0 && w <= 1.0 && h <= 1.0 && (w > 0 || h > 0);
        let normX, normY, normW, normH;

        if (isNorm) {
          normX = Math.max(0, Math.min(x, 1.0));
          normY = Math.max(0, Math.min(y, 1.0));
          normW = Math.max(w, 0.005);
          normH = Math.max(h, 0.005);
        } else {
          const coordBaseW = videoWidth > 0 ? videoWidth : ((x <= 640 && y <= 640 && w <= 640 && h <= 640) ? 640.0 : 1920.0);
          const coordBaseH = videoHeight > 0 ? videoHeight : (coordBaseW === 640.0 ? 640.0 : 1080.0);
          normX = Math.max(0, Math.min(x / coordBaseW, 1.0));
          normY = Math.max(0, Math.min(y / coordBaseH, 1.0));
          normW = Math.max(w / coordBaseW, 0.005);
          normH = Math.max(h / coordBaseH, 0.005);
        }

        return {
          left: offsetX + normX * renderWidth,
          top: offsetY + normY * renderHeight,
          boxWidth: Math.max(normW * renderWidth, 6),
          boxHeight: Math.max(normH * renderHeight, 6),
        };
      }

      function toScreenPoint(x, y) {
        const isNorm = x <= 1.0 && y <= 1.0 && (x > 0 || y > 0);
        let normX, normY;

        if (isNorm) {
          normX = Math.max(0, Math.min(x, 1.0));
          normY = Math.max(0, Math.min(y, 1.0));
        } else {
          const coordBaseW = videoWidth > 0 ? videoWidth : (x <= 640 && y <= 640 ? 640.0 : 1920.0);
          const coordBaseH = videoHeight > 0 ? videoHeight : (coordBaseW === 640.0 ? 640.0 : 1080.0);
          normX = Math.max(0, Math.min(x / coordBaseW, 1.0));
          normY = Math.max(0, Math.min(y / coordBaseH, 1.0));
        }

        return {
          x: offsetX + normX * renderWidth,
          y: offsetY + normY * renderHeight,
        };
      }

      const showBoxes = overlayMode === "both" || overlayMode === "boxes";
      const showPoints = overlayMode === "both" || overlayMode === "points";
      const accent = getRiskAccent(metrics.risk || "Low");

      if (showBoxes && detections.length > 0) {
        context.lineWidth = 1.5;
        context.strokeStyle = accent.stroke;
        context.fillStyle = accent.fill;

        detections.forEach((det) => {
          const [bx, by, bw, bh] = getDetectionBox(det);
          const proj = toScreen(bx, by, bw, bh);

          context.strokeRect(proj.left, proj.top, proj.boxWidth, proj.boxHeight);
          context.fillRect(proj.left, proj.top, proj.boxWidth, proj.boxHeight);
        });
      }

      if (showPoints && detections.length > 0) {
        detections.forEach((det) => {
          const [px, py] = getDetectionPoint(det);
          const pt = toScreenPoint(px, py);

          const gradient = context.createRadialGradient(pt.x, pt.y, 2, pt.x, pt.y, 14);
          gradient.addColorStop(0, "rgba(249, 115, 22, 0.55)");
          gradient.addColorStop(0.5, "rgba(249, 115, 22, 0.15)");
          gradient.addColorStop(1, "rgba(249, 115, 22, 0.00)");

          context.beginPath();
          context.arc(pt.x, pt.y, 14, 0, 2 * Math.PI);
          context.fillStyle = gradient;
          context.fill();

          context.beginPath();
          context.arc(pt.x, pt.y, 3.5, 0, 2 * Math.PI);
          context.fillStyle = "#F97316";
          context.fill();
        });
      }

      animationFrameId = window.requestAnimationFrame(drawOverlay);
    };

    animationFrameId = window.requestAnimationFrame(drawOverlay);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [isLive, compact, overlayMode]);

  return (
    <div className="mt-4 space-y-3">
      <div
        ref={containerRef}
        className={`relative overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_top,rgba(72,208,193,0.18),transparent_35%),rgba(255,255,255,0.04)] ${compact ? "aspect-video" : "h-[38rem]"}`}
      >
        {isRunning ? (
          <>
            {streamMode === STREAM_MODES.WEBRTC ? (
              <video
                ref={videoRef}
                autoPlay
                playsInline
                muted
                className={`h-full w-full bg-slate-950 ${compact ? "object-cover" : "object-contain"}`}
              />
            ) : (
              <img
                ref={imageRef}
                src={feedSource}
                alt={camera.name || "Live Stream Preview"}
                className={`h-full w-full bg-slate-950 ${compact ? "object-cover" : "object-contain"}`}
                onLoad={() => {
                  setStreamStatus(STREAM_STATES.FALLBACK_PREVIEW);
                }}
              />
            )}

            {isLive && overlayMode !== "off" ? (
              <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
            ) : null}

            {isLive ? (
              <>
                <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-slate-950/70 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-white">
                  {streamMode === STREAM_MODES.WEBRTC ? "WebRTC Live" : "Direct Live Feed"}
                </div>
                <div className={`pointer-events-none absolute left-3 top-3 z-10 rounded-full border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] ${sourceBadge.tone}`}>
                  {sourceBadge.label}
                </div>
                <div className="pointer-events-none absolute left-3 top-11 z-10 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-white">
                  Count {Number(liveMetrics?.current_count ?? liveMetrics?.count ?? liveMetrics?.people_count ?? liveMetrics?.sparse_count ?? liveMetrics?.raw_count ?? 0)}
                  {liveMetrics?.prediction_10min_count != null ? (
                    <span className="ml-1.5 text-white/70">
                      (10m: {liveMetrics.prediction_10min_count})
                    </span>
                  ) : null}
                </div>

                <div className="absolute bottom-3 right-3 z-20 flex items-center gap-1 rounded-xl bg-slate-950/80 p-1 border border-slate-800/80 backdrop-blur-md">
                  <button
                    type="button"
                    onClick={() => setOverlayMode("both")}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold transition ${
                      overlayMode === "both"
                        ? "bg-teal-500 text-slate-950 shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                    title="Display both boundary boxes and head focal dots"
                  >
                    <Layers className="h-3 w-3" />
                    Combined
                  </button>
                  <button
                    type="button"
                    onClick={() => setOverlayMode("boxes")}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold transition ${
                      overlayMode === "boxes"
                        ? "bg-teal-500 text-slate-950 shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                    title="Display pixel-accurate boundary boxes only"
                  >
                    <Scan className="h-3 w-3" />
                    Boxes
                  </button>
                  <button
                    type="button"
                    onClick={() => setOverlayMode("points")}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold transition ${
                      overlayMode === "points"
                        ? "bg-teal-500 text-slate-950 shadow-sm"
                        : "text-slate-400 hover:text-white"
                    }`}
                    title="Display head center focal dots only"
                  >
                    <Disc className="h-3 w-3" />
                    Dots
                  </button>
                  <button
                    type="button"
                    onClick={() => setOverlayMode("off")}
                    className={`rounded-lg px-2 py-1 text-[10px] font-bold transition ${
                      overlayMode === "off"
                        ? "bg-slate-700 text-white"
                        : "text-slate-400 hover:text-white"
                    }`}
                    title="Hide AI overlay"
                  >
                    Off
                  </button>
                </div>
              </>
            ) : null}

            {streamStatus === STREAM_STATES.FAILED || sourceBadge.label === "Unresolved" ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/85 p-4">
                <div className="text-center text-white max-w-xs">
                  <AlertCircle className="mx-auto h-8 w-8 text-rose-400 mb-2" />
                  <p className="text-sm font-bold text-white">Live Stream Unavailable</p>
                  <p className="mt-1 text-xs text-slate-300">
                    {camera?.metrics?.stream_resolution_error || "The remote broadcast has ended or is temporarily unreachable."}
                  </p>
                  <p className="mt-2 text-[10px] uppercase tracking-wider text-rose-400/80 font-bold">
                    {sourceBadge.label}
                  </p>
                </div>
              </div>
            ) : streamStatus === STREAM_STATES.CONNECTING || streamStatus === STREAM_STATES.RECONNECTING ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/68">
                <div className="text-center text-white">
                  <LoaderCircle className="mx-auto h-7 w-7 animate-spin text-teal-300" />
                  <p className="mt-2 text-sm font-medium">
                    {streamStatus === STREAM_STATES.RECONNECTING
                      ? "Reconnecting Stream..."
                      : "Connecting Stream..."}
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
              <p className="mt-2 text-sm text-white/70">Start camera to view live feed</p>
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
