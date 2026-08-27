"use client";

import { useState } from "react";
import {
  AlertOctagon,
  ArrowRight,
  Check,
  Flame,
  Layers,
  Play,
  PlusCircle,
  RefreshCw,
  Sliders,
  Sparkles,
  TrendingUp,
  Users,
  X,
  Zap,
} from "lucide-react";
import { createCamera } from "@/lib/api";

const DEMO_SCENARIOS = [
  {
    id: "normal",
    title: "Scenario 1: Steady Baseline Inflow",
    description: "Standard venue operations with safe density across all zones (15-25 heads/zone).",
    risk: "Low",
    badgeTone: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
    metrics: {
      current_count: 22,
      count: 22,
      prediction_10min_count: 26,
      risk: "Low",
      trend_direction: "STABLE",
      growth_rate_per_min: 0.5,
      density_mode: false,
      overlap_ratio: 0.08,
      dominant_regime: "SPARSE",
      line_crossing: { entry: 12, exit: 8 },
    },
  },
  {
    id: "surge",
    title: "Scenario 2: Sudden Crowd Accumulation Surge",
    description: "Concourse bottleneck forming: triggers YOLOv8 to MobileCount dynamic sub-batch switch.",
    risk: "High",
    badgeTone: "border-orange-500/40 bg-orange-500/15 text-orange-300",
    metrics: {
      current_count: 88,
      count: 88,
      prediction_10min_count: 135,
      risk: "High",
      trend_direction: "SURGING",
      growth_rate_per_min: 16.5,
      density_mode: true,
      overlap_ratio: 0.42,
      dominant_regime: "DENSE",
      dense_count: 65,
      sparse_count: 23,
      line_crossing: { entry: 45, exit: 6 },
    },
  },
  {
    id: "critical",
    title: "Scenario 3: Critical Stampede Surge & Evacuation Trigger",
    description: "Severe overcrowding detected: triggers audible alarm strobe and dynamic evacuation routing.",
    risk: "Critical",
    badgeTone: "border-red-500/40 bg-red-500/15 text-red-300 animate-pulse",
    metrics: {
      current_count: 155,
      count: 155,
      prediction_10min_count: 240,
      risk: "Critical",
      trend_direction: "SURGING",
      growth_rate_per_min: 32.0,
      density_mode: true,
      overlap_ratio: 0.68,
      dominant_regime: "DENSE",
      dense_count: 130,
      sparse_count: 25,
      line_crossing: { entry: 90, exit: 4 },
    },
  },
  {
    id: "dispersal",
    title: "Scenario 4: Controlled Evacuation & Crowd Dispersal",
    description: "Emergency egress released: outflow rate spikes and crowd volume safely normalizes.",
    risk: "Low",
    badgeTone: "border-teal-500/40 bg-teal-500/15 text-teal-300",
    metrics: {
      current_count: 35,
      count: 35,
      prediction_10min_count: 15,
      risk: "Low",
      trend_direction: "DISPERSING",
      growth_rate_per_min: -18.0,
      density_mode: false,
      overlap_ratio: 0.12,
      dominant_regime: "SPARSE",
      line_crossing: { entry: 2, exit: 75 },
    },
  },
];

export function DemoSimulator({ isOpen, onClose, onInjectScenario, onRefreshDashboard }) {
  const [activeScenarioId, setActiveScenarioId] = useState(null);
  const [loadingStreams, setLoadingStreams] = useState(false);
  const [provisionSuccess, setProvisionSuccess] = useState("");

  if (!isOpen) return null;

  function handleTrigger(scenario) {
    setActiveScenarioId(scenario.id);
    if (onInjectScenario) {
      onInjectScenario(scenario.metrics);
    }
  }

  async function handleProvisionTestStreams() {
    setLoadingStreams(true);
    setProvisionSuccess("");
    try {
      const demoStreams = [
        {
          name: "Gate 1 - North Plaza Main Ingress",
          zoneName: "Zone A: North Gate Plaza",
          location: "North Gate Entrance",
          streamUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
          sourceType: "public",
        },
        {
          name: "Concourse Central - Grand Atrium",
          zoneName: "Zone B: Central Concourse",
          location: "Concourse Corridor B",
          streamUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4",
          sourceType: "public",
        },
        {
          name: "Main Arena Lower Bowl Seating",
          zoneName: "Zone C: Arena Lower Bowl",
          location: "Gate 4 Arena Pavilion",
          streamUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4",
          sourceType: "public",
        },
      ];

      for (const st of demoStreams) {
        await createCamera(st);
      }

      if (onRefreshDashboard) {
        await onRefreshDashboard();
      }

      setProvisionSuccess("Successfully provisioned 3 live test streams into your workspace!");
      setTimeout(() => setProvisionSuccess(""), 5000);
    } catch (err) {
      console.error("Failed to provision demo streams", err);
    } finally {
      setLoadingStreams(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4 backdrop-blur-md">
      <div className="relative max-h-[90vh] w-full max-w-4xl overflow-y-auto rounded-3xl border border-slate-800 bg-slate-900/95 p-6 sm:p-8 shadow-2xl backdrop-blur-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-800 pb-5">
          <div className="flex items-center gap-3.5">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/30">
              <Sliders className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-xl font-extrabold text-white">Viva Presentation & Crowd Scenario Simulator</h2>
              <p className="text-xs text-slate-300">
                Instantly trigger real-time AI regime switches, surge curves, and evacuation routing for project defense.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            type="button"
            className="rounded-xl p-2 text-slate-400 hover:bg-slate-800 hover:text-white transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* 1-Click Provision Test Streams Banner */}
        <div className="mt-6 flex flex-col items-start justify-between gap-4 rounded-2xl border border-teal-500/40 bg-teal-950/40 p-5 sm:flex-row sm:items-center">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-teal-300">Quick Start Demo</span>
            <p className="text-sm font-bold text-white">Provision 3 Multi-Zone Surveillance Streams</p>
            <p className="text-xs text-slate-300">
              Registers Gate 1 North, Concourse Central, and Arena Lower Bowl with live 60 FPS WebRTC playback.
            </p>
          </div>
          <button
            onClick={handleProvisionTestStreams}
            disabled={loadingStreams}
            type="button"
            className="inline-flex items-center gap-2 rounded-xl bg-teal-500 px-5 py-2.5 text-xs font-bold text-slate-950 transition hover:bg-teal-400 disabled:opacity-60 shadow-lg shadow-teal-500/20 shrink-0"
          >
            {loadingStreams ? <RefreshCw className="h-4 w-4 animate-spin" /> : <PlusCircle className="h-4 w-4" />}
            {loadingStreams ? "Provisioning..." : "Inject 3 Test Streams"}
          </button>
        </div>

        {provisionSuccess && (
          <div className="mt-4 rounded-xl border border-emerald-500/40 bg-emerald-950/80 px-4 py-3 text-xs font-bold text-emerald-200">
            {provisionSuccess}
          </div>
        )}

        {/* Scenario Grid */}
        <div className="mt-6 space-y-4">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
            Select Live Scenario to Inject
          </span>

          <div className="grid gap-4 sm:grid-cols-2">
            {DEMO_SCENARIOS.map((sc) => {
              const isActive = activeScenarioId === sc.id;

              return (
                <div
                  key={sc.id}
                  className={`flex flex-col justify-between rounded-2xl border p-5 transition-all duration-300 ${
                    isActive
                      ? "border-teal-500 bg-teal-950/40 shadow-xl shadow-teal-500/10"
                      : "border-slate-800 bg-slate-950/80 hover:border-slate-700"
                  }`}
                >
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <span className={`rounded-lg border px-2.5 py-0.5 text-[10px] font-bold uppercase ${sc.badgeTone}`}>
                        {sc.risk} Risk Level
                      </span>
                      {isActive && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-bold text-teal-400">
                          <Check className="h-3.5 w-3.5" />
                          Active Scenario
                        </span>
                      )}
                    </div>

                    <h4 className="text-sm font-extrabold text-white">{sc.title}</h4>
                    <p className="text-xs text-slate-300 leading-relaxed">{sc.description}</p>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3">
                    <div className="text-xs">
                      <span className="text-slate-400">Count: </span>
                      <span className="font-extrabold text-white">{sc.metrics.current_count}</span>
                      <span className="text-slate-400"> | 10m: </span>
                      <span className="font-bold text-indigo-400">{sc.metrics.prediction_10min_count}</span>
                    </div>

                    <button
                      onClick={() => handleTrigger(sc)}
                      type="button"
                      className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-xs font-bold transition shadow-sm ${
                        isActive
                          ? "bg-teal-500 text-slate-950 hover:bg-teal-400"
                          : "border border-slate-700 bg-slate-800 text-white hover:bg-slate-700"
                      }`}
                    >
                      <Play className="h-3.5 w-3.5" />
                      {isActive ? "Re-trigger" : "Activate"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 flex justify-end border-t border-slate-800 pt-4">
          <button
            onClick={onClose}
            type="button"
            className="rounded-xl border border-slate-700 bg-slate-800 px-5 py-2.5 text-xs font-bold text-white transition hover:bg-slate-700"
          >
            Close Simulator
          </button>
        </div>
      </div>
    </div>
  );
}
