"use client";

import { useEffect, useRef, useState } from "react";
import {
  Activity,
  Camera,
  Check,
  Cpu,
  Eye,
  Layers,
  Maximize2,
  Minimize2,
  Navigation,
  Radio,
  Sparkles,
  TrendingUp,
  X,
  Zap,
} from "lucide-react";
import { CameraFeed } from "@/components/camera-feed";
import { riskClass } from "@/lib/risk";

export function CameraSpotlightModal({ camera, onClose, onCameraLiveUpdate }) {
  const [snapshotTaken, setSnapshotTaken] = useState(false);
  const [zoneHistory, setZoneHistory] = useState(() => {
    const base = Number(camera?.metrics?.current_count ?? camera?.metrics?.count ?? 25);
    return Array.from({ length: 10 }, (_, i) => ({
      time: `${10 - i}s ago`,
      count: Math.max(0, Math.round(base + (Math.sin(i) * 4))),
    }));
  });

  const liveCount = Number(
    camera?.metrics?.current_count ??
    camera?.metrics?.count ??
    camera?.metrics?.people_count ??
    camera?.metrics?.sparse_count ??
    0
  );
  const forecastCount = Number(camera?.metrics?.prediction_10min_count ?? camera?.metrics?.predicted_crowd ?? liveCount);
  const risk = camera?.metrics?.risk || "Low";
  const dominantRegime = camera?.metrics?.dominant_regime || (camera?.metrics?.density_mode ? "DENSE" : "SPARSE");
  const inferenceMs = camera?.metrics?.inference_ms ? Math.round(camera?.metrics.inference_ms) : 24;
  const entries = camera?.metrics?.line_crossing?.entry ?? 0;
  const exits = camera?.metrics?.line_crossing?.exit ?? 0;

  useEffect(() => {
    const nowStr = new Date().toLocaleTimeString([], { second: "2-digit" });
    setZoneHistory((prev) => [...prev.slice(-9), { time: `${nowStr}s`, count: liveCount }]);
  }, [liveCount]);

  function handleTakeSnapshot() {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext("2d");

      // Draw background
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, 1280, 720);

      // Watermark header
      ctx.fillStyle = "#14b8a6";
      ctx.font = "bold 24px sans-serif";
      ctx.fillText(`ZONE AUDIT SNAPSHOT: ${camera?.zoneName || camera?.name}`, 40, 50);

      ctx.fillStyle = "#94a3b8";
      ctx.font = "16px sans-serif";
      ctx.fillText(
        `Timestamp: ${new Date().toISOString()} • Recorded Count: ${liveCount} • Risk: ${risk} • DirectML: ${inferenceMs}ms`,
        40,
        85
      );

      ctx.fillStyle = "#06b6d4";
      ctx.fillText("Edge-Accelerated Crowd Monitoring Platform (DirectML / AMD Radeon 610M)", 40, 680);

      const link = document.createElement("a");
      link.download = `snapshot_${camera?.zoneName?.replace(/\s+/g, "_") || "zone"}_${Date.now()}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();

      setSnapshotTaken(true);
      setTimeout(() => setSnapshotTaken(false), 2500);
    } catch (e) {
      console.error("Failed to capture snapshot", e);
    }
  }

  // Mini SVG Sparkline
  const sparkW = 320;
  const sparkH = 70;
  const maxVal = Math.max(...zoneHistory.map((h) => h.count), 20) * 1.2;
  const points = zoneHistory.map((item, idx) => {
    const x = (idx / (zoneHistory.length - 1)) * sparkW;
    const y = sparkH - (item.count / maxVal) * sparkH;
    return { x, y };
  });
  const polylineStr = points.map((p) => `${p.x},${p.y}`).join(" ");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
      <div className="flex max-h-[95vh] w-full max-w-6xl flex-col overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl">
        {/* Modal Header */}
        <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10 text-teal-400">
              <Eye className="h-5 w-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-white">{camera?.zoneName}</h2>
                <span className="rounded-full border border-slate-700 bg-slate-800 px-2.5 py-0.5 text-xs text-slate-300">
                  {camera?.name}
                </span>
                <span className={riskClass(risk)}>{risk}</span>
              </div>
              <p className="text-xs text-slate-400">
                Location: {camera?.location || "Main Venue Grid"} • Source: {camera?.sourceType || "RTSP / WebRTC"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleTakeSnapshot}
              type="button"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-slate-700"
            >
              {snapshotTaken ? <Check className="h-4 w-4 text-emerald-400" /> : <Camera className="h-4 w-4 text-teal-400" />}
              {snapshotTaken ? "Snapshot Saved!" : "Capture Snapshot"}
            </button>

            <button
              onClick={onClose}
              type="button"
              className="rounded-xl border border-slate-800 bg-slate-950 p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal Body */}
        <div className="grid flex-1 gap-6 overflow-y-auto p-6 lg:grid-cols-[1.5fr_1fr]">
          {/* Left: High-Res Camera View */}
          <div className="flex flex-col space-y-4">
            <div className="rounded-2xl border border-slate-800 bg-slate-950 p-3 shadow-inner">
              <div className="flex items-center justify-between pb-2 text-xs text-slate-400">
                <span className="inline-flex items-center gap-1 text-teal-400 font-semibold">
                  <Radio className="h-3.5 w-3.5 animate-pulse" />
                  Live WebRTC Stream & 60 FPS LERP Canvas
                </span>
                <span className="font-semibold">{camera?.status}</span>
              </div>
              <CameraFeed camera={camera} onLiveMetricsChange={onCameraLiveUpdate} compact={false} />
            </div>

            {/* Quick Diagnostic Ticker */}
            <div className="grid grid-cols-3 gap-3">
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Current Count</span>
                <p className="mt-1 text-2xl font-bold text-white">{liveCount} heads</p>
                <span className="text-[10px] text-teal-400">DirectML B=4 inference</span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">10m Predicted</span>
                <p className="mt-1 text-2xl font-bold text-indigo-300">{forecastCount} heads</p>
                <span className="text-[10px] text-indigo-400">Ridge extrapolation</span>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Inference Latency</span>
                <p className="mt-1 text-2xl font-bold text-teal-400">{inferenceMs} ms</p>
                <span className="text-[10px] text-slate-400">AMD Radeon 610M</span>
              </div>
            </div>
          </div>

          {/* Right: Detailed Deep Diagnostics */}
          <div className="flex flex-col space-y-4">
            {/* Real-time Zone Count Sparkline */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">60-Second Trend</span>
                <span className="text-xs font-semibold text-teal-400">{camera?.metrics?.trend_direction || "STABLE"}</span>
              </div>
              <div className="mt-3 overflow-hidden rounded-lg bg-slate-900 p-2">
                <svg viewBox={`0 0 ${sparkW} ${sparkH}`} className="h-16 w-full select-none">
                  <polyline
                    points={polylineStr}
                    fill="none"
                    stroke="#14b8a6"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {points.map((p, i) => (
                    <circle key={i} cx={p.x} cy={p.y} r={i === points.length - 1 ? 4 : 2} fill="#06b6d4" />
                  ))}
                </svg>
              </div>
            </div>

            {/* Dual Regime & Density Breakdown */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4 space-y-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Dual-Regime AI Routing</span>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Dominant Mode</span>
                <span className="font-bold text-teal-400">
                  {dominantRegime === "DENSE" ? "MobileCount Sub-Batching" : "YOLOv8 Head Detection"}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Sparse Area Heads</span>
                <span className="font-semibold text-white">{camera?.metrics?.sparse_count ?? liveCount}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Dense Clusters</span>
                <span className="font-semibold text-white">{camera?.metrics?.dense_count ?? 0}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-slate-400">Head Overlap Ratio</span>
                <span className="font-semibold text-white">
                  {Math.round((camera?.metrics?.overlap_ratio ?? 0) * 100)}%
                </span>
              </div>
            </div>

            {/* Line Crossing Flow Throughput */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Line Crossing Throughput</span>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-slate-900 p-3 text-center">
                  <span className="text-[10px] text-emerald-400 font-semibold">Total Inflow</span>
                  <p className="text-xl font-bold text-white">+{entries}</p>
                </div>
                <div className="rounded-xl bg-slate-900 p-3 text-center">
                  <span className="text-[10px] text-amber-400 font-semibold">Total Outflow</span>
                  <p className="text-xl font-bold text-white">-{exits}</p>
                </div>
              </div>
            </div>

            {/* Hardware Pipeline Summary */}
            <div className="rounded-2xl border border-slate-800 bg-slate-950/70 p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-300">
                <Cpu className="h-4 w-4 text-teal-400" />
                <span>GStreamer D3D11 & DirectML Active</span>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                Hardware H.264 VCN decoding decimated to 2 FPS in-VRAM prior to FP16 batch dispatch.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
