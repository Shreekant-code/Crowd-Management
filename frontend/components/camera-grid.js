"use client";

import { useState } from "react";
import {
  Camera,
  Cpu,
  Eye,
  Grid2X2,
  Grid3X3,
  LayoutGrid,
  Maximize2,
  PauseCircle,
  PlayCircle,
  Radio,
  Search,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
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
      tone: "bg-red-500/20 text-red-300 border-red-500/40",
    };
  }
  if (normalized === "ACCUMULATING") {
    return {
      label: `Accumulating (${rateStr})`,
      icon: TrendingUp,
      tone: "bg-amber-500/20 text-amber-300 border-amber-500/40",
    };
  }
  if (normalized === "DISPERSING") {
    return {
      label: `Dispersing (${rateStr})`,
      icon: TrendingDown,
      tone: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
    };
  }
  return {
    label: `Stable (${rateStr || "Nominal"})`,
    icon: Sparkles,
    tone: "bg-teal-500/20 text-teal-300 border-teal-500/40",
  };
}

function getRiskBar(camera = {}) {
  const risk = camera.metrics?.risk || "Low";
  if (risk === "Critical") return "from-red-500 via-rose-500 to-red-600";
  if (risk === "High") return "from-red-500 via-amber-500 to-orange-500";
  if (risk === "Medium") return "from-amber-500 via-yellow-500 to-emerald-500";
  return "from-teal-500 via-emerald-500 to-cyan-500";
}

export function CameraGrid({
  cameras = [],
  onCameraChanged,
  onInspectCamera,
  onCameraLiveUpdate,
  onAddCamera,
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [filterMode, setFilterMode] = useState("ALL"); // ALL | RUNNING | RISK | DENSE
  const [layoutCols, setLayoutCols] = useState(3); // 1 | 2 | 3

  async function handleAction(id, action) {
    try {
      if (action === "delete") {
        await deleteCamera(id);
      } else {
        await changeCameraState(id, action);
      }
      if (onCameraChanged) {
        await onCameraChanged();
      }
    } catch (error) {
      console.error("[CameraGrid] Action failed:", error?.message || error);
    }
  }

  // Filter cameras
  const filteredCameras = cameras.filter((camera) => {
    const matchesSearch =
      (camera.zoneName || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (camera.name || "").toLowerCase().includes(searchTerm.toLowerCase()) ||
      (camera.location || "").toLowerCase().includes(searchTerm.toLowerCase());

    if (!matchesSearch) return false;

    if (filterMode === "RUNNING") return camera.status === "running";
    if (filterMode === "RISK") return ["High", "Critical"].includes(camera.metrics?.risk);
    if (filterMode === "DENSE") return camera.metrics?.dominant_regime === "DENSE" || Boolean(camera.metrics?.density_mode);

    return true;
  });

  if (!cameras.length) {
    return (
      <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-slate-800 bg-slate-900/70 p-12 text-center text-sm text-slate-300 backdrop-blur-2xl">
        <Radio className="mx-auto h-12 w-12 text-teal-400 animate-pulse mb-3" />
        <p className="text-xl font-extrabold text-white">No Surveillance Feeds Registered</p>
        <p className="mt-1.5 text-xs text-slate-300 max-w-md mx-auto leading-relaxed">
          Add an RTSP or HTTP camera stream, or use the Viva Presentation Simulator to inject instant test streams.
        </p>
        {onAddCamera && (
          <button
            onClick={onAddCamera}
            type="button"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-white hover:bg-slate-100 text-slate-950 font-black px-6 py-3 text-xs shadow-xl shadow-white/20 hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer border border-white/80"
          >
            Add First Surveillance Zone
          </button>
        )}
      </div>
    );
  }

  const gridClass =
    layoutCols === 1
      ? "grid gap-6 grid-cols-1"
      : layoutCols === 2
      ? "grid gap-6 md:grid-cols-2"
      : "grid gap-6 xl:grid-cols-3";

  return (
    <div className="space-y-6">
      {/* Grid Controls Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/90 p-4 shadow-xl backdrop-blur-2xl">
        {/* Search Input */}
        <div className="relative min-w-[240px] flex-1 sm:max-w-xs">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search zones, locations..."
            className="w-full rounded-xl border border-slate-800 bg-slate-950/90 py-2.5 pl-10 pr-4 text-xs text-white placeholder-slate-500 outline-none transition focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
          />
        </div>

        {/* Filter Pills */}
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {[
            { id: "ALL", label: `All Feeds (${cameras.length})` },
            { id: "RUNNING", label: `Active (${cameras.filter((c) => c.status === "running").length})` },
            { id: "RISK", label: `High Risk (${cameras.filter((c) => ["High", "Critical"].includes(c.metrics?.risk)).length})` },
            { id: "DENSE", label: "Dense Clusters" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterMode(tab.id)}
              type="button"
              className={`rounded-xl px-3.5 py-1.5 font-bold transition ${
                filterMode === tab.id
                  ? "bg-teal-500/20 text-teal-300 border border-teal-500/40 shadow-sm"
                  : "bg-slate-950/70 text-slate-400 hover:text-white border border-slate-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Layout Switcher */}
        <div className="hidden sm:flex items-center gap-1 rounded-xl border border-slate-800 bg-slate-950 p-1">
          <button
            onClick={() => setLayoutCols(3)}
            type="button"
            className={`rounded-lg p-1.5 transition ${layoutCols === 3 ? "bg-slate-800 text-teal-400" : "text-slate-500 hover:text-white"}`}
            title="3 Columns"
          >
            <Grid3X3 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setLayoutCols(2)}
            type="button"
            className={`rounded-lg p-1.5 transition ${layoutCols === 2 ? "bg-slate-800 text-teal-400" : "text-slate-500 hover:text-white"}`}
            title="2 Columns"
          >
            <Grid2X2 className="h-4 w-4" />
          </button>
          <button
            onClick={() => setLayoutCols(1)}
            type="button"
            className={`rounded-lg p-1.5 transition ${layoutCols === 1 ? "bg-slate-800 text-teal-400" : "text-slate-500 hover:text-white"}`}
            title="Single Focus"
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Main Camera Cards Grid */}
      <div className={gridClass}>
        {filteredCameras.map((camera) => {
          const liveCount = getLiveCount(camera);
          const forecastCount = camera.metrics?.prediction_10min_count ?? camera.metrics?.predicted_crowd ?? liveCount;
          const trend = getTrendBadge(camera.metrics?.trend_direction, camera.metrics?.growth_rate_per_min);
          const TrendIcon = trend.icon;
          const isDensityMode = Boolean(camera.metrics?.density_mode);
          const overlapPercent = Math.round((camera.metrics?.overlap_ratio ?? camera.metrics?.crowd_features?.congestion_score ?? 0) * 100);
          const inferenceMs = camera.metrics?.inference_ms ? Math.round(camera.metrics.inference_ms) : 24;

          return (
            <article
              key={camera.id}
              className="flex flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/90 shadow-2xl backdrop-blur-2xl transition-all duration-300 hover:border-slate-700 hover:shadow-cyan-950/20"
            >
              {/* Glowing Risk Accent Top Bar */}
              <div className={`h-1.5 bg-gradient-to-r ${getRiskBar(camera)}`} />

              <div className="flex flex-col space-y-4 p-5">
                {/* Card Title & Badges */}
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-base font-extrabold text-white">{camera.zoneName}</h3>
                    <p className="text-xs text-slate-300 font-medium">{camera.name} • {camera.location || "Main Venue"}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-lg border border-slate-800 bg-slate-950 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-300">
                        {camera.sourceType || "source"}
                      </span>
                      <span className={`rounded-lg border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                        camera.status === "running" ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border-slate-800 bg-slate-950 text-slate-400"
                      }`}>
                        {camera.status}
                      </span>
                      {isDensityMode ? (
                        <span className="rounded-lg border border-amber-500/40 bg-amber-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-300">
                          MobileCount Dense
                        </span>
                      ) : (
                        <span className="rounded-lg border border-teal-500/40 bg-teal-500/15 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-teal-300">
                          YOLOv8 Head
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-col items-end gap-1.5">
                    <span className={riskClass(camera.metrics?.risk)}>
                      {camera.metrics?.risk || "Low"}
                    </span>
                    {onInspectCamera && (
                      <button
                        onClick={() => onInspectCamera(camera)}
                        type="button"
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-teal-400 transition hover:text-teal-300"
                      >
                        <Maximize2 className="h-3 w-3" />
                        Spotlight
                      </button>
                    )}
                  </div>
                </div>

                {/* Video Feed Component with 60 FPS LERP Canvas */}
                <div className="overflow-hidden rounded-2xl bg-slate-950 p-3 shadow-inner border border-slate-800/80">
                  <div className="flex items-center justify-between pb-1.5 text-xs text-slate-300">
                    <span className="inline-flex items-center gap-1.5 text-teal-400 font-bold text-[11px]">
                      <Radio className="h-3 w-3 animate-pulse" />
                      WebRTC WHEP Stream
                    </span>
                    <span className="text-[11px] font-semibold text-slate-400">{camera.status}</span>
                  </div>
                  <CameraFeed camera={camera} compact onLiveMetricsChange={onCameraLiveUpdate} />
                </div>

                {/* Analytics & Zone Summary Grid */}
                <div className="grid gap-3 sm:grid-cols-2">
                  {/* Local Analytics Panel */}
                  <div className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-950/80 p-3.5">
                    <div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Zone Heads</span>
                        <span className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[10px] font-bold ${trend.tone}`}>
                          <TrendIcon className="h-2.5 w-2.5" />
                          {trend.label}
                        </span>
                      </div>
                      <div className="mt-2 flex items-baseline justify-between">
                        <span className="text-3xl font-extrabold text-white">{liveCount}</span>
                        <span className="text-xs text-indigo-400 font-bold">10m: {forecastCount}</span>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-800 pt-2 text-[11px]">
                      <div>
                        <span className="text-slate-400 text-[10px]">DirectML Latency</span>
                        <p className="font-bold text-teal-400">{inferenceMs} ms</p>
                      </div>
                      <div>
                        <span className="text-slate-400 text-[10px]">Congestion Drag</span>
                        <p className="font-bold text-white">{overlapPercent}%</p>
                      </div>
                    </div>
                  </div>

                  {/* Zone Summary & Flow */}
                  <div className="flex flex-col justify-between rounded-2xl border border-slate-800 bg-slate-950/80 p-3.5">
                    <div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Crowd Regime</span>
                        <span className={`rounded-lg px-2 py-0.5 text-[10px] font-bold uppercase ${
                          (camera.metrics?.dominant_regime === "DENSE" || (camera.metrics?.dense_count ?? 0) > 10)
                            ? "bg-red-500/20 text-red-300 border border-red-500/40"
                            : "bg-teal-500/20 text-teal-300 border border-teal-500/40"
                        }`}>
                          {camera.metrics?.dominant_regime || "SPARSE"}
                        </span>
                      </div>

                      <div className="mt-2 space-y-1 text-xs text-slate-200">
                        <div className="flex justify-between">
                          <span className="text-slate-400">Sparse Heads</span>
                          <span className="font-bold text-white">{camera.metrics?.sparse_count ?? liveCount}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-slate-400">Dense Clusters</span>
                          <span className="font-bold text-white">{camera.metrics?.dense_count ?? 0}</span>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 border-t border-slate-800 pt-2 text-[11px] text-slate-300 flex items-center justify-between">
                      <span className="text-slate-400">Flow</span>
                      <span className="font-bold text-emerald-400">
                        +{camera.metrics?.line_crossing?.entry ?? 0} in <span className="text-slate-400 font-normal">/</span> -{camera.metrics?.line_crossing?.exit ?? 0} out
                      </span>
                    </div>
                  </div>
                </div>

                {/* Card Action Controls */}
                <div className="flex items-center gap-2.5 pt-2 border-t border-slate-800">
                  {camera.status !== "running" ? (
                    <button
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-white font-extrabold px-4 py-2.5 text-xs shadow-lg shadow-emerald-950/40 hover:scale-[1.02] active:scale-95 transition-all duration-200 cursor-pointer"
                      onClick={() => handleAction(camera.id, "start")}
                      type="button"
                    >
                      <PlayCircle className="h-4 w-4" />
                      Start Feeds
                    </button>
                  ) : (
                    <button
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-amber-600 to-orange-600 hover:from-amber-500 hover:to-orange-500 text-white font-extrabold px-4 py-2.5 text-xs shadow-lg shadow-amber-950/40 hover:scale-[1.02] active:scale-95 transition-all duration-200 cursor-pointer"
                      onClick={() => handleAction(camera.id, "stop")}
                      type="button"
                    >
                      <PauseCircle className="h-4 w-4" />
                      Stop Feeds
                    </button>
                  )}

                  {onInspectCamera && (
                    <button
                      className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-teal-300 hover:text-white hover:bg-slate-700 transition cursor-pointer"
                      onClick={() => onInspectCamera(camera)}
                      type="button"
                      title="Spotlight View"
                    >
                      <Eye className="h-4 w-4" />
                    </button>
                  )}

                  <button
                    className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800 p-2.5 text-slate-400 hover:border-red-500/50 hover:bg-red-500/20 hover:text-red-300 transition cursor-pointer"
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
    </div>
  );
}
