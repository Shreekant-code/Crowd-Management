"use client";

import { PauseCircle, PlayCircle, Trash2, TrendingUp, TrendingDown, Minus, Zap, Cpu } from "lucide-react";
import { CameraFeed } from "@/components/camera-feed";
import { changeCameraState, deleteCamera } from "@/lib/api";
import { riskClass } from "@/lib/risk";

function getLiveCount(item = {}) {
  const metrics = item?.metrics || item || {};
  const count =
    metrics.current_count ??
    metrics.count ??
    metrics.people_count ??
    0;
  return Number(count) || 0;
}

function getTrendBadge(trend = "STABLE", growthRate = 0) {
  const normalized = String(trend || "STABLE").toUpperCase();
  const rateStr = growthRate != null ? `${growthRate > 0 ? "+" : ""}${growthRate}/min` : "";

  if (normalized === "SURGING") {
    return {
      label: `Surging (${rateStr})`,
      icon: TrendingUp,
      tone: "bg-red-50 text-red-700 border-red-200",
    };
  }
  if (normalized === "ACCUMULATING") {
    return {
      label: `Accumulating (${rateStr})`,
      icon: TrendingUp,
      tone: "bg-amber-50 text-amber-700 border-amber-200",
    };
  }
  if (normalized === "DISPERSING") {
    return {
      label: `Dispersing (${rateStr})`,
      icon: TrendingDown,
      tone: "bg-emerald-50 text-emerald-700 border-emerald-200",
    };
  }
  return {
    label: "Stable",
    icon: Minus,
    tone: "bg-slate-50 text-slate-600 border-slate-200",
  };
}

export function CameraGrid({ cameras = [], onCameraChanged, onCameraLiveUpdate }) {
  function getRiskBar(camera) {
    if (camera.metrics?.risk === "Critical") {
      return "from-red-500 to-orange-400";
    }
    if (camera.metrics?.risk === "High") {
      return "from-orange-500 to-amber-400";
    }
    if (camera.metrics?.risk === "Medium") {
      return "from-amber-400 to-yellow-300";
    }
    return "from-emerald-400 to-teal-400";
  }

  async function handleAction(id, action) {
    try {
      if (action === "delete") {
        await deleteCamera(id);
        if (onCameraChanged) {
          await onCameraChanged();
        }
        return;
      }

      const result = await changeCameraState(id, action);
      if (result?.camera && onCameraChanged) {
        onCameraChanged(result.camera);
        return;
      }
      if (onCameraChanged) {
        await onCameraChanged();
      }
    } catch (error) {
      console.error("[CameraGrid] Action failed:", error?.message || error);
    }
  }

  if (!cameras.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
        No cameras registered yet. Add an RTSP or media stream to create your first surveillance zone.
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-3 xl:auto-rows-fr">
      {cameras.map((camera) => {
        const liveCount = getLiveCount(camera);
        const forecastCount = camera.metrics?.prediction_10min_count ?? camera.metrics?.predicted_crowd ?? liveCount;
        const trend = getTrendBadge(camera.metrics?.trend_direction, camera.metrics?.growth_rate_per_min);
        const TrendIcon = trend.icon;
        const isDensityMode = Boolean(camera.metrics?.density_mode);
        const overlapPercent = Math.round((camera.metrics?.overlap_ratio ?? camera.metrics?.crowd_features?.congestion_score ?? 0) * 100);

        return (
          <article key={camera.id} className="flex h-full min-h-[40rem] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            <div className={`h-2 bg-gradient-to-r ${getRiskBar(camera)}`} />
            <div className="flex h-full flex-col space-y-5 p-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-lg font-semibold text-slate-950">{camera.zoneName}</p>
                  <p className="text-sm text-slate-500">{camera.name}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {camera.sourceType || "source"}
                    </span>
                    <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                      {camera.status}
                    </span>
                    {isDensityMode ? (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-700">
                        MobileCount Sub-Batch
                      </span>
                    ) : (
                      <span className="rounded-full border border-teal-200 bg-teal-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-teal-700">
                        YOLOv8 Head
                      </span>
                    )}
                  </div>
                </div>
                <span className={`${riskClass(camera.metrics?.risk)} rounded-full`}>
                  {camera.metrics?.risk || "Low"}
                </span>
              </div>

              {/* Video Feed Component with 60 FPS LERP Canvas */}
              <div className="rounded-2xl bg-slate-950 p-4 text-white">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-[0.18em] text-white/55">Zone Feed (WebRTC)</p>
                  <p className="text-xs text-white/55">{camera.status}</p>
                </div>
                <CameraFeed camera={camera} compact onLiveMetricsChange={onCameraLiveUpdate} />
              </div>

              {/* Analytics & Zone Summary Grid */}
              <div className="grid flex-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(260px,0.9fr)]">
                {/* Local Analytics Panel */}
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Local Analytics</p>
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${trend.tone}`}>
                          <TrendIcon className="h-3 w-3" />
                          {trend.label}
                        </span>
                      </div>
                    </div>
                    <div className="rounded-2xl bg-white px-4 py-2.5 text-right shadow-sm">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Head Count</p>
                      <span className="text-2xl font-bold text-slate-950">{liveCount}</span>
                    </div>
                  </div>

                  <div className="mt-3.5 grid gap-2.5 sm:grid-cols-2">
                    <div className="rounded-xl bg-white p-3 shadow-sm">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Current</p>
                      <p className="mt-1 text-lg font-semibold text-slate-950">{liveCount}</p>
                    </div>
                    <div className="rounded-xl bg-white p-3 shadow-sm">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">10-Min Forecast</p>
                      <p className="mt-1 text-lg font-semibold text-slate-950">{forecastCount}</p>
                    </div>
                    <div className="rounded-xl bg-white p-3 shadow-sm">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">DirectML Latency</p>
                      <p className="mt-1 text-sm font-semibold text-slate-950">
                        {camera.metrics?.inference_ms ? Math.round(camera.metrics.inference_ms) : 24} ms
                      </p>
                    </div>
                    <div className="rounded-xl bg-white p-3 shadow-sm">
                      <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Congestion</p>
                      <p className="mt-1 text-sm font-semibold text-slate-950">{overlapPercent}%</p>
                    </div>
                  </div>
                </div>

                {/* Zone Summary Panel */}
                <div className="flex flex-col justify-between rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Zone Summary</p>
                    <div className="mt-3 space-y-2 text-sm text-slate-700">
                      <div className="flex items-center justify-between">
                        <span>Left Sector</span>
                        <span className="font-semibold text-slate-950">{camera.metrics?.zone_counts?.left ?? 0}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Center Sector</span>
                        <span className="font-semibold text-slate-950">{camera.metrics?.zone_counts?.center ?? 0}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span>Right Sector</span>
                        <span className="font-semibold text-slate-950">{camera.metrics?.zone_counts?.right ?? 0}</span>
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-200 pt-2 text-xs text-slate-500">
                        <span>Flow (Entry / Exit)</span>
                        <span className="font-medium text-slate-900">
                          {camera.metrics?.line_crossing?.entry ?? 0} in / {camera.metrics?.line_crossing?.exit ?? 0} out
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-3 border-t border-slate-200 pt-2.5">
                    <div className="flex items-center justify-between text-xs text-slate-600">
                      <span className="inline-flex items-center gap-1">
                        <Cpu className="h-3.5 w-3.5 text-teal-600" />
                        AMD VCN Ingestion
                      </span>
                      <span className="font-semibold text-teal-700">2 FPS Decimated</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex items-center gap-2 pt-1">
                {camera.status !== "running" ? (
                  <button
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-700"
                    onClick={() => handleAction(camera.id, "start")}
                    type="button"
                  >
                    <PlayCircle className="h-4 w-4" />
                    Start Zone
                  </button>
                ) : (
                  <button
                    className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-amber-600"
                    onClick={() => handleAction(camera.id, "stop")}
                    type="button"
                  >
                    <PauseCircle className="h-4 w-4" />
                    Stop Zone
                  </button>
                )}
                <button
                  className="inline-flex items-center justify-center rounded-xl border border-slate-200 px-3.5 py-2.5 text-slate-600 transition hover:bg-red-50 hover:text-red-600 hover:border-red-200"
                  onClick={() => handleAction(camera.id, "delete")}
                  type="button"
                  title="Delete Camera"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
