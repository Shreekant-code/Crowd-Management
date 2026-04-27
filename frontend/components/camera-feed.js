"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { LoaderCircle, VideoOff } from "lucide-react";

function getFeedSource(camera, retrySeed) {
  if (!camera?.id) {
    return null;
  }

  return `/api/stream/${camera.id}?retry=${retrySeed}`;
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
    if (ageMs > 12000) {
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

export function CameraFeed({ camera }) {
  const imageRef = useRef(null);
  const canvasRef = useRef(null);
  const [liveMetrics, setLiveMetrics] = useState(camera.metrics || {});
  const metricsRef = useRef(camera.metrics || {});
  const mediaSizeRef = useRef({ width: 960, height: 540 });
  const [retrySeed, setRetrySeed] = useState(0);
  const [isLoaded, setIsLoaded] = useState(false);
  const [imageErrored, setImageErrored] = useState(false);
  const [mediaSize, setMediaSize] = useState({ width: 960, height: 540 });
  const streamStatus = getStreamStatus(camera, liveMetrics, imageErrored, isLoaded);
  const feedSource = useMemo(
    () => getFeedSource(camera, retrySeed),
    [camera, retrySeed]
  );
  const currentCount =
    liveMetrics?.current_count ??
    liveMetrics?.count ??
    liveMetrics?.people_count ??
    0;
  const totalCount = liveMetrics?.total_count ?? currentCount;
  const densityCount = liveMetrics?.density_count ?? currentCount;
  const finalCount =
    liveMetrics?.final_count ??
    liveMetrics?.smoothed_count ??
    currentCount;
  const risk = liveMetrics?.risk || "Low";
  const densityScore = liveMetrics?.crowd_features?.density_score ?? 0;
  const movementScore = liveMetrics?.crowd_features?.movement_score ?? 0;
  const congestionScore = liveMetrics?.crowd_features?.congestion_score ?? 0;
  const entryCount = liveMetrics?.line_crossing?.entry ?? 0;
  const exitCount = liveMetrics?.line_crossing?.exit ?? 0;
  const zoneCounts = liveMetrics?.zone_counts || {};
  const riskAccent = getRiskAccent(risk);

  useEffect(() => {
    const mergedMetrics = camera.metrics || {};
    setLiveMetrics(mergedMetrics);
    metricsRef.current = mergedMetrics;
  }, [camera.metrics]);

  useEffect(() => {
    setRetrySeed(0);
    setIsLoaded(false);
    setImageErrored(false);
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
      } catch (_error) {
        // Keep last known metrics when polling briefly fails.
      }
    }

    void refreshStats();
    const interval = setInterval(() => {
      void refreshStats();
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [camera.id, camera.status]);

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
      setRetrySeed((current) => current + 1);
      setImageErrored(false);
      setIsLoaded(false);
    }, 1500);

    return () => clearTimeout(timeout);
  }, [camera.status, imageErrored]);

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

    const drawOverlay = () => {
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
      const scaleX = width / sourceWidth;
      const scaleY = height / sourceHeight;
      const heatmapPoints = Array.isArray(metrics.heatmap_points) ? metrics.heatmap_points : [];
      const recentHeatmapPoints = heatmapPoints.slice(-220);

      for (let index = 0; index < recentHeatmapPoints.length; index += 1) {
        const point = recentHeatmapPoints[index];
        const recency = (index + 1) / Math.max(recentHeatmapPoints.length, 1);
        const x = (point.x ?? 0) * scaleX;
        const y = (point.y ?? 0) * scaleY;
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
      const lineY = height / 2;
      const accent = getRiskAccent(metrics.risk || "Low");

      context.save();
      context.setLineDash([8, 8]);
      context.strokeStyle = accent.line;
      context.lineWidth = 1.5;
      context.beginPath();
      context.moveTo(12, lineY);
      context.lineTo(width - 12, lineY);
      context.stroke();
      context.restore();

      context.fillStyle = "rgba(15, 23, 42, 0.74)";
      context.fillRect(width - 120, Math.max(lineY - 12, 10), 108, 24);
      context.fillStyle = "#e2e8f0";
      context.fillText("Crossing Line", width - 108, Math.max(lineY + 4, 24));

      context.lineWidth = 2;
      context.font = "12px sans-serif";
      for (const detection of detections) {
        const [x = 0, y = 0, w = 0, h = 0] = detection.bbox || [];
        const left = x * scaleX;
        const top = y * scaleY;
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
  }, [isLoaded, mediaSize, retrySeed]);

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
      <div className="relative h-44 overflow-hidden rounded-2xl border border-white/10 bg-[radial-gradient(circle_at_top,rgba(72,208,193,0.18),transparent_35%),rgba(255,255,255,0.04)]">
        {camera.status === "running" && feedSource ? (
          <>
            <img
              ref={imageRef}
              alt={`${camera.zoneName} live feed`}
              className="h-full w-full object-cover"
              onError={() => {
                setImageErrored(true);
                setIsLoaded(false);
              }}
              onLoad={(event) => {
                const target = event.currentTarget;
                setMediaSize({
                  width: target.naturalWidth || 960,
                  height: target.naturalHeight || 540,
                });
                setIsLoaded(true);
                setImageErrored(false);
              }}
              src={feedSource}
            />
            {isLoaded ? (
              <>
                <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
                <div className="pointer-events-none absolute right-3 top-3 z-10 rounded-full bg-slate-950/70 px-2.5 py-1 text-[11px] font-medium uppercase tracking-[0.14em] text-white">
                  Live Analytics
                </div>
              </>
            ) : null}
            {streamStatus !== "live" ? (
              <div className="absolute inset-0 flex items-center justify-center bg-slate-950/68">
                <div className="text-center text-white">
                  <LoaderCircle className="mx-auto h-7 w-7 animate-spin text-teal-300" />
                  <p className="mt-2 text-sm font-medium">
                    {streamStatus === "reconnecting" ? "Reconnecting..." : "Connecting camera feed..."}
                  </p>
                  <p className="mt-1 text-xs text-white/65">
                    Trying synchronized AI stream
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
            </div>
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 px-3 py-3 text-white/92">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]">
            Current Count {currentCount}
          </span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]">
            Total Count {totalCount}
          </span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]">
            Density Count {densityCount}
          </span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]">
            Final Count {finalCount}
          </span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]">
            Risk {risk}
          </span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]">
            Density {densityScore.toFixed(2)}
          </span>
          <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]">
            Movement {movementScore.toFixed(2)}
          </span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-white/78">
          <span>Congestion {congestionScore.toFixed(2)}</span>
          <span>Entry {entryCount}</span>
          <span>Exit {exitCount}</span>
          <span>Frame {liveMetrics?.frame_id ?? "-"}</span>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="rounded-full bg-white/10 px-2 py-0.5">Left {zoneCounts.left ?? 0}</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5">Center {zoneCounts.center ?? 0}</span>
          <span className="rounded-full bg-white/10 px-2 py-0.5">Right {zoneCounts.right ?? 0}</span>
        </div>

        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-400 via-amber-400 to-red-500"
            style={{ width: `${Math.min(100, Math.max(6, congestionScore * 100))}%` }}
          />
        </div>
      </div>
    </div>
  );
}
