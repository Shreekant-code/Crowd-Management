"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, VideoOff, AlertCircle } from "lucide-react";
import { useStreamManager, STREAM_STATES, STREAM_MODES } from "@/lib/stream-manager";
import { WhepClient } from "@/lib/whep-client";

function getRiskAccent(risk) {
  if (risk === "Critical") {
    return {
      stroke: "rgba(248, 113, 113, 0.98)",
      fill: "rgba(127, 29, 29, 0.18)",
      chip: "rgba(127, 29, 29, 0.85)",
      line: "rgba(248, 113, 113, 0.85)",
    };
  }

  if (risk === "High") {
    return {
      stroke: "rgba(251, 146, 60, 0.98)",
      fill: "rgba(154, 52, 18, 0.16)",
      chip: "rgba(154, 52, 18, 0.82)",
      line: "rgba(251, 146, 60, 0.82)",
    };
  }

  if (risk === "Medium") {
    return {
      stroke: "rgba(250, 204, 21, 0.98)",
      fill: "rgba(133, 77, 14, 0.15)",
      chip: "rgba(133, 77, 14, 0.80)",
      line: "rgba(250, 204, 21, 0.80)",
    };
  }

  return {
    stroke: "rgba(45, 212, 191, 0.98)",
    fill: "rgba(15, 118, 110, 0.16)",
    chip: "rgba(15, 118, 110, 0.80)",
    line: "rgba(45, 212, 191, 0.78)",
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
  const videoRef = useRef(null);
  const imageRef = useRef(null);
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const boundsRef = useRef({ width: 960, height: 540, videoWidth: 960, videoHeight: 540 });
  const trackStatesRef = useRef(new Map());

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

  // Ingest telemetry into Track-ID-keyed LERP state machine (2 FPS -> 60 FPS)
  useEffect(() => {
    metricsRef.current = liveMetrics;
    const detections = Array.isArray(liveMetrics?.detections) ? liveMetrics.detections : [];
    const now = performance.now();

    detections.forEach((det, idx) => {
      const trackId = det.id ?? det.track_id ?? (det.trackId != null ? det.trackId : idx);
      if (trackId == null) return;

      const [x, y, w, h] = getDetectionBox(det);
      const existing = trackStatesRef.current.get(trackId);

      if (existing) {
        existing.target = [x, y, w, h];
        existing.lastSeen = now;
        existing.confidence = det.confidence ?? existing.confidence;
      } else {
        trackStatesRef.current.set(trackId, {
          current: [x, y, w, h], // Snap immediately on first sighting
          target: [x, y, w, h],
          lastSeen: now,
          confidence: det.confidence ?? 0.85,
        });
      }
    });

    // Prune stale tracks older than 1200ms
    for (const [trackId, state] of trackStatesRef.current.entries()) {
      if (now - state.lastSeen > 1200) {
        trackStatesRef.current.delete(trackId);
      }
    }
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
        width: Math.max(Math.round(rect.width), 1),
        height: Math.max(Math.round(rect.height), 1),
        videoWidth: vw,
        videoHeight: vh,
      };
    };

    updateBounds();
    const observer = new ResizeObserver(updateBounds);
    observer.observe(container);

    return () => observer.disconnect();
  }, []);

  // WebRTC WHEP connection lifecycle with React 19 Strict Mode protection
  useEffect(() => {
    if (!isRunning || !whepUrl || streamMode !== STREAM_MODES.WEBRTC) {
      if (streamMode !== STREAM_MODES.PREVIEW && streamMode !== STREAM_MODES.AI) {
        setStreamStatus(STREAM_STATES.IDLE);
      }
      return undefined;
    }

    const video = videoRef.current;
    if (!video) return undefined;

    let isSubscribed = true;

    const client = new WhepClient({
      url: whepUrl,
      onStateChange: (newState) => {
        if (!isSubscribed) return;
        if (newState === "live") {
          setStreamStatus(STREAM_STATES.LIVE);
        } else if (newState === "connecting") {
          setStreamStatus(STREAM_STATES.CONNECTING);
        } else if (newState === "reconnecting") {
          setStreamStatus(STREAM_STATES.RECONNECTING);
        } else if (newState === "failed") {
          // If WebRTC fails while camera is running, fallback to direct preview
          if (isSubscribed && isRunning) {
            console.warn(`[CameraFeed] WebRTC failed for camera ${camera.id}, switching to Preview mode.`);
            setStreamMode(STREAM_MODES.PREVIEW);
            setStreamStatus(STREAM_STATES.FALLBACK_PREVIEW);
          } else {
            setStreamStatus(STREAM_STATES.IDLE);
          }
        } else {
          setStreamStatus(STREAM_STATES.IDLE);
        }
      },
      onError: (err) => {
        if (!isSubscribed || !isRunning) return;
        console.warn(`[CameraFeed] WHEP connection warning for camera ${camera.id}:`, err?.message);
      },
    });

    client.connect(video).catch((err) => {
      if (isSubscribed && isRunning) {
        console.warn(`[CameraFeed] WebRTC failed to connect: ${err?.message}`);
        setStreamMode(STREAM_MODES.PREVIEW);
        setStreamStatus(STREAM_STATES.FALLBACK_PREVIEW);
      }
    });

    return () => {
      isSubscribed = false;
      client.disconnect();
      if (video) {
        video.srcObject = null;
      }
    };
  }, [camera.id, isRunning, whepUrl, streamMode, setStreamStatus, setStreamMode]);

  const isLive = streamStatus === STREAM_STATES.LIVE || streamStatus === STREAM_STATES.FALLBACK_PREVIEW;

  // 60 FPS HTML5 Canvas Overlay rendering loop with Track-ID LERP
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !isLive) {
      return undefined;
    }

    const context = canvas.getContext("2d");
    if (!context) {
      return undefined;
    }

    let animationFrameId = 0;
    const ALPHA = 0.22; // LERP smoothing factor

    const drawOverlay = () => {
      const now = performance.now();
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

      // Calculate letterbox/pillarbox geometry for pixel-perfect alignment
      const containerRatio = width / height;
      const videoRatio = videoWidth / videoHeight;

      let renderWidth, renderHeight, offsetX, offsetY;

      if (compact) {
        // object-fit: cover
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
        // object-fit: contain
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

      // Adaptive coordinate projection mapping (handles normalized 0..1, 640x640 model space, and 1080p canvas)
      function toScreen(x, y, w, h) {
        const isNorm = x <= 1.0 && y <= 1.0 && w <= 1.0 && h <= 1.0 && (w > 0 || h > 0);
        
        let normX, normY, normW, normH;
        if (isNorm) {
          normX = Math.max(0, Math.min(x, 1.0));
          normY = Math.max(0, Math.min(y, 1.0));
          normW = Math.max(w, 0.01);
          normH = Math.max(h, 0.01);
        } else {
          // If max coordinate <= 640, detections are in 640x640 model coordinate space
          const coordBaseW = (x <= 640 && y <= 640 && w <= 640 && h <= 640) ? 640.0 : 1920.0;
          const coordBaseH = coordBaseW === 640.0 ? 640.0 : 1080.0;
          normX = Math.max(0, Math.min(x / coordBaseW, 1.0));
          normY = Math.max(0, Math.min(y / coordBaseH, 1.0));
          normW = Math.max(w / coordBaseW, 0.015);
          normH = Math.max(h / coordBaseH, 0.015);
        }

        return {
          left: offsetX + normX * renderWidth,
          top: offsetY + normY * renderHeight,
          boxWidth: Math.max(normW * renderWidth, 8),
          boxHeight: Math.max(normH * renderHeight, 8),
        };
      }

      // 1. Update LERP interpolation for all active tracks & prune stale
      for (const [trackId, state] of trackStatesRef.current.entries()) {
        if (now - state.lastSeen > 1200) {
          trackStatesRef.current.delete(trackId);
          continue;
        }

        // LERP interpolation towards target coordinates
        for (let i = 0; i < 4; i++) {
          state.current[i] += (state.target[i] - state.current[i]) * ALPHA;
        }
      }

      // 2. Collect render items (tracked states with LERP, or fallback to raw detections)
      const renderItems = [];
      if (trackStatesRef.current.size > 0) {
        for (const [trackId, state] of trackStatesRef.current.entries()) {
          const [x, y, w, h] = state.current;
          const proj = toScreen(x, y, w, h);
          renderItems.push({
            trackId,
            ...proj,
          });
        }
      } else if (Array.isArray(metrics.detections) && metrics.detections.length > 0) {
        metrics.detections.forEach((det, idx) => {
          const [x, y, w, h] = getDetectionBox(det);
          const proj = toScreen(x, y, w, h);
          renderItems.push({
            trackId: det.id ?? det.track_id ?? idx + 1,
            ...proj,
          });
        });
      }

      // 3. Draw P2PNet Head Center Focal Dots & Sheer Radial Auras
      renderItems.forEach((item) => {
        const centerX = item.left + item.boxWidth / 2;
        const centerY = item.top + item.boxHeight / 2;

        // Circular Radial Aura
        const gradient = context.createRadialGradient(
          centerX,
          centerY,
          2,
          centerX,
          centerY,
          16
        );
        gradient.addColorStop(0, "rgba(249, 115, 22, 0.45)"); // Sheer Orange-Red Core
        gradient.addColorStop(0.5, "rgba(249, 115, 22, 0.15)"); // Mid-tone
        gradient.addColorStop(1, "rgba(249, 115, 22, 0.00)");  // Transparent Falloff

        context.beginPath();
        context.arc(centerX, centerY, 16, 0, 2 * Math.PI);
        context.fillStyle = gradient;
        context.fill();

        // High-Visibility Head Center Dot (P2PNet Point)
        context.beginPath();
        context.arc(centerX, centerY, 4, 0, 2 * Math.PI);
        context.fillStyle = "#F97316";
        context.fill();
      });

      // 4. Draw Smooth Track-ID LERP Bounding Boxes and Chips
      const accent = getRiskAccent(metrics.risk || "Low");
      context.lineWidth = 1.5;
      context.font = "12px sans-serif";

      renderItems.forEach((item) => {
        context.strokeStyle = accent.stroke;
        context.fillStyle = accent.fill;
        context.strokeRect(item.left, item.top, item.boxWidth, item.boxHeight);
        context.fillRect(item.left, item.top, item.boxWidth, item.boxHeight);

        const label = `ID: ${item.trackId}`;
        const textWidth = context.measureText(label).width;
        context.fillStyle = accent.chip;
        context.fillRect(item.left, Math.max(item.top - 18, 0), textWidth + 10, 18);
        context.fillStyle = "#f8fafc";
        context.fillText(label, item.left + 5, Math.max(item.top - 5, 12));
      });

      animationFrameId = window.requestAnimationFrame(drawOverlay);
    };

    animationFrameId = window.requestAnimationFrame(drawOverlay);
    return () => window.cancelAnimationFrame(animationFrameId);
  }, [isLive, compact]);

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
                onLoadedMetadata={() => {
                  const video = videoRef.current;
                  if (video) {
                    boundsRef.current.videoWidth = video.videoWidth || 960;
                    boundsRef.current.videoHeight = video.videoHeight || 540;
                  }
                }}
              />
            ) : (
              <img
                ref={imageRef}
                src={feedSource}
                alt={camera.name || "Live Stream Preview"}
                className={`h-full w-full bg-slate-950 ${compact ? "object-cover" : "object-contain"}`}
                onLoad={() => {
                  setStreamStatus(STREAM_STATES.FALLBACK_PREVIEW);
                  const img = imageRef.current;
                  if (img) {
                    boundsRef.current.videoWidth = img.naturalWidth || 960;
                    boundsRef.current.videoHeight = img.naturalHeight || 540;
                  }
                }}
              />
            )}

            {isLive ? (
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
                  Count {Number(liveMetrics?.current_count ?? liveMetrics?.count ?? liveMetrics?.people_count ?? 0)}
                  {liveMetrics?.prediction_10min_count != null ? (
                    <span className="ml-1.5 text-white/70">
                      (10m: {liveMetrics.prediction_10min_count})
                    </span>
                  ) : null}
                </div>
              </>
            ) : null}

            {streamStatus === STREAM_STATES.CONNECTING || streamStatus === STREAM_STATES.RECONNECTING ? (
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
