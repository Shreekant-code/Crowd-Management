"use client";

import { useEffect, useState } from "react";
import { AlertOctagon, ArrowRight, ShieldAlert, X } from "lucide-react";

export function TopAlertBanner({ cameras = [], global = {}, onInspectCamera }) {
  const [dismissedKey, setDismissedKey] = useState(null);

  // Find critical camera or high risk camera
  const criticalCam = cameras.find((c) => c.status === "running" && c.metrics?.risk === "Critical");
  const highCam = !criticalCam && cameras.find((c) => c.status === "running" && c.metrics?.risk === "High");
  const activeAlertCam = criticalCam || highCam;

  const alertKey = activeAlertCam ? `${activeAlertCam.id}-${activeAlertCam.metrics?.risk}-${Math.floor(Date.now() / 15000)}` : null;
  const isDismissed = alertKey && dismissedKey === alertKey;

  if (!activeAlertCam || isDismissed) {
    return null;
  }

  const isCritical = activeAlertCam.metrics?.risk === "Critical";
  const liveCount = activeAlertCam.metrics?.current_count ?? activeAlertCam.metrics?.count ?? 0;
  const projectedCount = activeAlertCam.metrics?.prediction_10min_count ?? activeAlertCam.metrics?.predicted_crowd ?? liveCount;
  const growthRate = activeAlertCam.metrics?.growth_rate_per_min || 0;

  return (
    <div
      className={`relative z-40 mb-4 overflow-hidden rounded-3xl border px-5 py-4 shadow-2xl transition-all duration-300 ${
        isCritical
          ? "border-red-500/60 bg-red-950/90 text-red-100 shadow-[0_0_35px_rgba(239,68,68,0.35)] backdrop-blur-2xl"
          : "border-amber-500/60 bg-amber-950/90 text-amber-100 shadow-[0_0_35px_rgba(245,158,11,0.3)] backdrop-blur-2xl"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border ${
              isCritical ? "bg-red-500/20 text-red-300 border-red-500/40 animate-pulse" : "bg-amber-500/20 text-amber-300 border-amber-500/40"
            }`}
          >
            {isCritical ? <AlertOctagon className="h-6 w-6" /> : <ShieldAlert className="h-6 w-6" />}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span
                className={`rounded-full px-3 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                  isCritical ? "bg-red-500 text-white" : "bg-amber-500 text-slate-950"
                }`}
              >
                {isCritical ? "CRITICAL SURGE DETECTED" : "HIGH CROWD CONGESTION"}
              </span>
              <span className="text-xs font-bold text-white">{activeAlertCam.zoneName} ({activeAlertCam.name})</span>
            </div>
            <p className="mt-1 text-xs text-slate-200 leading-relaxed">
              Current Head Count: <strong className="text-white font-extrabold">{liveCount}</strong> • 10-Min Forecast:{" "}
              <strong className="text-white font-extrabold">{projectedCount}</strong>
              {growthRate > 0 && <span> • Influx Velocity: <strong className="text-white font-bold">+{growthRate}/min</strong></span>}
              {" "}— Recommendation: Initiate automated crowd diversion & open auxiliary exit corridors.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-center">
          {onInspectCamera && (
            <button
              onClick={() => onInspectCamera(activeAlertCam)}
              type="button"
              className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3.5 py-2 text-xs font-extrabold text-slate-950 transition hover:bg-slate-200 shadow-md shrink-0"
            >
              Inspect Camera
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}

          <button
            onClick={() => setDismissedKey(alertKey)}
            type="button"
            className="rounded-xl p-2 text-white/70 hover:bg-white/10 hover:text-white transition"
            title="Dismiss Alert Banner"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
