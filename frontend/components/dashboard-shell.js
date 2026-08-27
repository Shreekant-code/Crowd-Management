"use client";

import { useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Compass,
  Cpu,
  Eye,
  FileText,
  Film,
  Grid,
  Layers,
  LayoutDashboard,
  LogOut,
  Maximize2,
  Navigation,
  Plus,
  Radio,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Siren,
  Sliders,
  Sparkles,
  Tv,
  Users,
  Volume2,
  VolumeX,
  X,
  Zap,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { getSocket } from "@/lib/socket";
import { getDashboardData } from "@/lib/api";
import { playAlertChime } from "@/lib/audio-alerts";
import { riskClass } from "@/lib/risk";

import { TopAlertBanner } from "./top-alert-banner";
import { SummaryCards } from "./summary-cards";
import { CameraGrid } from "./camera-grid";
import { VenueMap } from "./venue-map";
import { AnalyticsStudio } from "./analytics-studio";
import { IncidentCenter } from "./incident-center";
import { UploadPanel } from "./upload-panel";
import { CameraSpotlightModal } from "./camera-spotlight-modal";
import { DemoSimulator } from "./demo-simulator";
import { ReportExportModal } from "./report-export.js";
import { CameraForm } from "./camera-form";

function buildSummary(cameras = []) {
  return cameras.reduce(
    (acc, camera) => {
      acc.totalZones += 1;
      acc.activeZones += camera.status === "running" ? 1 : 0;
      acc.totalCount += getLiveCount(camera.metrics);
      acc.highRiskZones += ["High", "Critical"].includes(camera.metrics?.risk) ? 1 : 0;
      return acc;
    },
    { totalZones: 0, activeZones: 0, totalCount: 0, highRiskZones: 0 }
  );
}

function buildGlobalFallback(dashboard = {}) {
  return dashboard.global || {
    totalCameras: dashboard.cameras?.length || 0,
    onlineCameras: dashboard.cameras?.filter((camera) => camera.status === "running").length || 0,
    offlineCameras: dashboard.cameras?.filter((camera) => camera.status !== "running").length || 0,
    totalCrowd: dashboard.summary?.totalCount || 0,
    averageCrowd: 0,
    maximumCrowd: 0,
    minimumCrowd: 0,
    mostCrowdedCamera: null,
    leastCrowdedCamera: null,
    highestDensityCamera: null,
    highestRiskCamera: null,
    fastestGrowingCamera: null,
    globalDensity: 0,
    globalCongestion: 0,
    overallRisk: "Low",
    overallRiskScore: 0,
    venueOccupancy: 0,
    globalPrediction: {
      currentCount: dashboard.summary?.totalCount || 0,
      projectedCount: dashboard.summary?.totalCount || 0,
      confidence: 0.88,
      horizonMinutes: 10,
      trend: "stable",
      label: "Global Prediction (10 min): LOW RISK",
    },
    predictionConfidence: 0.88,
    alertSummary: {
      total: dashboard.alerts?.length || 0,
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    },
    trend: "stable",
  };
}

function getLiveCount(item = {}) {
  const metrics = item?.metrics || item || {};
  const count =
    metrics.current_count ??
    metrics.count ??
    metrics.people_count ??
    metrics.raw_count ??
    metrics.yolo_count ??
    metrics.final_count ??
    metrics.smoothed_count ??
    0;

  return Number(count) || 0;
}

export function DashboardShell({ initialData, operatorName }) {
  const [dashboard, setDashboard] = useState(initialData);
  const [lastSocketAt, setLastSocketAt] = useState(initialData?.timestamp || null);
  const [globalState, setGlobalState] = useState(() => buildGlobalFallback(initialData || {}));
  const [isMounted, setIsMounted] = useState(false);

  // Active Navigation View Mode
  const [activeTab, setActiveTab] = useState("GRID"); // GRID | MAP | ANALYTICS | INCIDENTS | UPLOAD

  // Modal States
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isSimulatorOpen, setIsSimulatorOpen] = useState(false);
  const [isReportOpen, setIsReportOpen] = useState(false);
  const [spotlightCamera, setSpotlightCamera] = useState(null);

  // Audio Alerts Toggle
  const [soundEnabled, setSoundEnabled] = useState(true);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  function applyDashboard(payload) {
    if (!payload || !Array.isArray(payload.cameras)) {
      return;
    }

    setDashboard(payload);
    setGlobalState(buildGlobalFallback(payload));
    setLastSocketAt(payload.timestamp || new Date().toISOString());

    // Check for critical alerts to play audio
    const hasCritical = payload.cameras.some((c) => c.status === "running" && c.metrics?.risk === "Critical");
    const hasHigh = payload.cameras.some((c) => c.status === "running" && c.metrics?.risk === "High");

    if (soundEnabled && hasCritical) {
      playAlertChime("Critical");
    } else if (soundEnabled && hasHigh) {
      playAlertChime("High");
    }
  }

  async function refreshDashboard(nextCamera = null) {
    if (nextCamera?.id) {
      upsertCamera(nextCamera);
      try {
        const payload = await getDashboardData();
        applyDashboard(payload);
      } catch (error) {
        console.error("Failed to refresh dashboard after camera update", error);
      }
      return;
    }

    try {
      const payload = await getDashboardData();
      applyDashboard(payload);
    } catch (error) {
      console.error("Failed to refresh dashboard", error);
    }
  }

  function upsertCamera(camera) {
    setDashboard((current) => {
      const cameras = [...(current?.cameras || [])];
      const index = cameras.findIndex((item) => item.id === camera.id);

      if (index >= 0) {
        cameras[index] = camera;
      } else {
        cameras.unshift(camera);
      }

      return {
        ...current,
        cameras,
        summary: buildSummary(cameras),
        global: current?.global || buildGlobalFallback({ ...current, cameras }),
        timestamp: camera.metrics?.updatedAt || new Date().toISOString(),
      };
    });
    setLastSocketAt(camera.metrics?.updatedAt || new Date().toISOString());
  }

  function updateCameraLiveMetrics(cameraId, metrics, updatedAt) {
    setDashboard((current) => {
      const cameras = [...(current?.cameras || [])];
      const index = cameras.findIndex((item) => item.id === cameraId);
      if (index < 0) {
        return current;
      }

      const existingCamera = cameras[index];
      const existingUpdatedAt = existingCamera.metrics?.updatedAt || existingCamera.lastFrameAt || null;
      const nextUpdatedAt = updatedAt || metrics?.updatedAt || existingUpdatedAt || new Date().toISOString();

      if (
        existingUpdatedAt &&
        nextUpdatedAt &&
        new Date(nextUpdatedAt).getTime() < new Date(existingUpdatedAt).getTime()
      ) {
        return current;
      }

      const updatedCamera = {
        ...existingCamera,
        metrics: {
          ...(existingCamera.metrics || {}),
          ...(metrics || {}),
          updatedAt: nextUpdatedAt,
        },
        lastFrameAt: nextUpdatedAt,
      };

      cameras[index] = updatedCamera;

      // Update spotlight modal camera reference if currently open
      if (spotlightCamera && spotlightCamera.id === cameraId) {
        setSpotlightCamera(updatedCamera);
      }

      return {
        ...current,
        cameras,
        summary: buildSummary(cameras),
        global: current?.global || buildGlobalFallback({ ...current, cameras }),
        timestamp: nextUpdatedAt,
      };
    });

    setLastSocketAt(updatedAt || metrics?.updatedAt || new Date().toISOString());
  }

  function updateGlobal(payload) {
    if (!payload) {
      return;
    }

    setGlobalState((current) => ({
      ...current,
      ...payload,
      globalPrediction: {
        ...(current?.globalPrediction || {}),
        ...(payload?.globalPrediction || {}),
      },
      alertSummary: {
        ...(current?.alertSummary || {}),
        ...(payload?.alertSummary || {}),
      },
    }));

    setDashboard((current) => ({
      ...current,
      global: {
        ...(current?.global || {}),
        ...payload,
      },
    }));
  }

  // Simulation scenario application
  function applySimulationMetrics(simMetrics) {
    setDashboard((current) => {
      const updatedCameras = (current?.cameras || []).map((cam, idx) => {
        // Vary metrics slightly per zone for realism
        const multiplier = idx === 0 ? 1 : idx === 1 ? 0.75 : 1.15;
        const count = Math.max(5, Math.round((simMetrics.current_count || 25) * multiplier));
        const pred = Math.max(count, Math.round((simMetrics.prediction_10min_count || count) * multiplier));

        return {
          ...cam,
          status: "running",
          metrics: {
            ...(cam.metrics || {}),
            ...simMetrics,
            current_count: count,
            count: count,
            people_count: count,
            prediction_10min_count: pred,
            updatedAt: new Date().toISOString(),
          },
        };
      });

      return {
        ...current,
        cameras: updatedCameras,
        summary: buildSummary(updatedCameras),
        global: {
          ...current?.global,
          totalCrowd: updatedCameras.reduce((sum, c) => sum + (c.metrics?.current_count || 0), 0),
          overallRisk: simMetrics.risk || "Low",
          trend: simMetrics.trend_direction || "STABLE",
          globalPrediction: {
            ...(current?.global?.globalPrediction || {}),
            currentCount: updatedCameras.reduce((sum, c) => sum + (c.metrics?.current_count || 0), 0),
            projectedCount: updatedCameras.reduce((sum, c) => sum + (c.metrics?.prediction_10min_count || 0), 0),
            trend: simMetrics.trend_direction || "STABLE",
            confidence: 0.94,
          },
        },
      };
    });

    if (soundEnabled && simMetrics.risk === "Critical") {
      playAlertChime("Critical");
    } else if (soundEnabled && simMetrics.risk === "High") {
      playAlertChime("High");
    }
  }

  // Socket setup
  useEffect(() => {
    let activeSocket;

    async function connectSocket() {
      try {
        const socket = await getSocket();
        activeSocket = socket;
        await refreshDashboard();

        socket.on("dashboard:update", (payload) => {
          applyDashboard(payload);
        });

        socket.on("camera:update", (camera) => {
          upsertCamera(camera);
        });

        socket.on("alert:new", (alert) => {
          if (soundEnabled) {
            playAlertChime(alert.risk === "Critical" ? "Critical" : "High");
          }
          setDashboard((current) => ({
            ...current,
            alerts: [alert, ...(current?.alerts || [])].slice(0, 50),
          }));
        });

        socket.on("global:update", (payload) => {
          updateGlobal(payload);
        });

        socket.on("global:prediction", (payload) => {
          updateGlobal({ globalPrediction: payload?.globalPrediction || payload });
        });

        socket.on("dashboard:summary", (payload) => {
          updateGlobal(payload);
        });

        socket.on("connect", () => {
          void refreshDashboard();
        });
      } catch (error) {
        console.error("Dashboard shell failed to connect socket", error);
      }
    }

    connectSocket();

    return () => {
      if (activeSocket) {
        activeSocket.off("dashboard:update");
        activeSocket.off("camera:update");
        activeSocket.off("alert:new");
        activeSocket.off("global:update");
        activeSocket.off("global:prediction");
        activeSocket.off("dashboard:summary");
        activeSocket.off("connect");
      }
    };
  }, [soundEnabled]);

  const cameras = dashboard?.cameras || [];
  const alerts = dashboard?.alerts || [];
  const summary = dashboard?.summary || buildSummary(cameras);

  return (
    <main className="min-h-screen w-full bg-[#080d16] text-slate-100">
      {/* Dynamic Background Scanline & Grid Effect */}
      <div className="pointer-events-none fixed inset-0 z-0 opacity-40 grid-shell" />
      <div className="scanline-effect z-10" />

      <div className="relative z-20 flex w-full flex-col gap-6 px-4 py-5 sm:px-6 lg:px-8">
        {/* ========================================================================= */}
        {/* 1. TOP MISSION CONTROL COMMAND HEADER                                     */}
        {/* ========================================================================= */}
        <header className="panel relative overflow-hidden p-6 border-slate-800 bg-slate-900/80 shadow-2xl backdrop-blur-2xl">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_15%_15%,rgba(6,182,212,0.15),transparent_40%),radial-gradient(circle_at_85%_85%,rgba(239,68,68,0.10),transparent_40%)]" />

          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            {/* Title & Edge Status */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2.5">
                <div className="inline-flex items-center gap-2 rounded-full border border-teal-500/40 bg-teal-500/10 px-3.5 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-teal-300">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500" />
                  </span>
                  DirectML Edge Operations
                </div>

                <div className="inline-flex items-center gap-1.5 rounded-full border border-cyan-500/30 bg-cyan-500/10 px-3 py-1.5 text-xs font-semibold text-cyan-300">
                  <Cpu className="h-3.5 w-3.5" />
                  AMD Radeon 610M GPU
                </div>
              </div>

              <div>
                <h1 className="text-2xl font-extrabold tracking-tight text-white sm:text-3xl lg:text-4xl">
                  Edge Crowd Safety & Surge Forecasting Platform
                </h1>
                <p className="mt-1 max-w-3xl text-xs sm:text-sm text-slate-400 leading-relaxed">
                  Real-time multi-camera head detection, ByteTrack LERP gliding, closed-form 1D Ridge surge extrapolation, and dynamic evacuation pathfinding.
                </p>
              </div>
            </div>

            {/* Quick Action Ribbon */}
            <div className="flex flex-wrap items-center gap-2.5">
              {/* Sound Alert Toggle */}
              <button
                onClick={() => setSoundEnabled((prev) => !prev)}
                type="button"
                className={`inline-flex items-center gap-1.5 rounded-xl border px-3.5 py-2.5 text-xs font-bold transition shadow-sm ${
                  soundEnabled
                    ? "border-teal-500/40 bg-teal-500/10 text-teal-300 hover:bg-teal-500/20"
                    : "border-slate-800 bg-slate-950 text-slate-500 hover:text-slate-300"
                }`}
                title={soundEnabled ? "Audio Alerts Enabled" : "Audio Alerts Muted"}
              >
                {soundEnabled ? <Volume2 className="h-4 w-4 text-teal-400" /> : <VolumeX className="h-4 w-4" />}
                {soundEnabled ? "Audio On" : "Muted"}
              </button>

              {/* Presentation Simulator Launcher */}
              <button
                onClick={() => setIsSimulatorOpen(true)}
                type="button"
                className="inline-flex items-center gap-1.5 rounded-xl border border-indigo-500/40 bg-indigo-500/15 px-3.5 py-2.5 text-xs font-bold text-indigo-300 transition hover:bg-indigo-500/25 shadow-sm"
              >
                <Sliders className="h-4 w-4 text-indigo-400" />
                Viva Simulator
              </button>

              {/* Executive Audit Report Launcher */}
              <button
                onClick={() => setIsReportOpen(true)}
                type="button"
                className="inline-flex items-center gap-1.5 rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-3.5 py-2.5 text-xs font-bold text-cyan-300 transition hover:bg-cyan-500/25 shadow-sm"
              >
                <FileText className="h-4 w-4 text-cyan-400" />
                Audit Report
              </button>

              {/* High-Salience Add Zone Button */}
              <button
                onClick={() => setIsCameraModalOpen(true)}
                type="button"
                className="inline-flex items-center gap-2 rounded-xl bg-white hover:bg-slate-100 text-slate-950 font-black px-5 py-2.5 text-xs shadow-xl shadow-white/20 hover:scale-105 active:scale-95 transition-all duration-200 cursor-pointer border border-white/80"
              >
                <Plus className="h-4 w-4 stroke-[3]" />
                Add Zone
              </button>

              {/* Operator Badge & Logout */}
              <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
                <div className="text-right hidden sm:block">
                  <p className="text-xs font-bold text-white">{operatorName}</p>
                  <p className="text-[10px] text-slate-400">
                    Sync: {isMounted && lastSocketAt ? new Date(lastSocketAt).toLocaleTimeString() : "Live"}
                  </p>
                </div>
                <button
                  className="rounded-xl border border-slate-800 bg-slate-950 p-2.5 text-slate-400 transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-400"
                  onClick={() => signOut({ callbackUrl: "/login" })}
                  type="button"
                  title="Logout"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </header>

        {/* ========================================================================= */}
        {/* 2. TOP EMERGENCY SURGE BANNER (Triggers on High/Critical Risk)             */}
        {/* ========================================================================= */}
        <TopAlertBanner
          cameras={cameras}
          global={globalState}
          onInspectCamera={(cam) => setSpotlightCamera(cam)}
        />

        {/* ========================================================================= */}
        {/* 3. COMMAND METRIC SUMMARY RIBBON                                         */}
        {/* ========================================================================= */}
        <SummaryCards summary={summary} global={globalState} />

        {/* ========================================================================= */}
        {/* 4. PRIMARY WORKSPACE NAVIGATION VIEW TABS                                */}
        {/* ========================================================================= */}
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-800 pb-3">
          <nav className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setActiveTab("GRID")}
              type="button"
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-extrabold transition shadow-sm cursor-pointer ${
                activeTab === "GRID"
                  ? "bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-lg shadow-teal-500/30"
                  : "border border-slate-800 bg-slate-900/80 text-slate-300 hover:text-white hover:bg-slate-800"
              }`}
            >
              <Tv className="h-4 w-4" />
              Live Camera Grid ({cameras.length})
            </button>

            <button
              onClick={() => setActiveTab("MAP")}
              type="button"
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-extrabold transition shadow-sm cursor-pointer ${
                activeTab === "MAP"
                  ? "bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-lg shadow-teal-500/30"
                  : "border border-slate-800 bg-slate-900/80 text-slate-300 hover:text-white hover:bg-slate-800"
              }`}
            >
              <Compass className="h-4 w-4" />
              2D Spatial Venue Map & Evacuation Matrix
            </button>

            <button
              onClick={() => setActiveTab("ANALYTICS")}
              type="button"
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-extrabold transition shadow-sm cursor-pointer ${
                activeTab === "ANALYTICS"
                  ? "bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-lg shadow-teal-500/30"
                  : "border border-slate-800 bg-slate-900/80 text-slate-300 hover:text-white hover:bg-slate-800"
              }`}
            >
              <BrainCircuit className="h-4 w-4" />
              Surge Forecasting & Telemetry Studio
            </button>

            <button
              onClick={() => setActiveTab("INCIDENTS")}
              type="button"
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-extrabold transition shadow-sm cursor-pointer ${
                activeTab === "INCIDENTS"
                  ? "bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-lg shadow-teal-500/30"
                  : "border border-slate-800 bg-slate-900/80 text-slate-300 hover:text-white hover:bg-slate-800"
              }`}
            >
              <Siren className="h-4 w-4" />
              Incident Center ({alerts.length})
            </button>

            <button
              onClick={() => setActiveTab("UPLOAD")}
              type="button"
              className={`inline-flex items-center gap-2 rounded-2xl px-4 py-2.5 text-xs font-extrabold transition shadow-sm cursor-pointer ${
                activeTab === "UPLOAD"
                  ? "bg-gradient-to-r from-teal-500 to-emerald-600 text-white shadow-lg shadow-teal-500/30"
                  : "border border-slate-800 bg-slate-900/80 text-slate-300 hover:text-white hover:bg-slate-800"
              }`}
            >
              <Film className="h-4 w-4" />
              Offline Footage Analysis
            </button>
          </nav>

          <div className="flex items-center gap-2 text-xs text-slate-400">
            <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
            <span>2 FPS Edge Push Cadence Active</span>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* 5. TAB CONTENT RENDERER                                                   */}
        {/* ========================================================================= */}
        <section className="min-h-[42rem]">
          {activeTab === "GRID" && (
            <CameraGrid
              cameras={cameras}
              onCameraChanged={refreshDashboard}
              onCameraLiveUpdate={updateCameraLiveMetrics}
              onInspectCamera={(cam) => setSpotlightCamera(cam)}
              onAddCamera={() => setIsCameraModalOpen(true)}
            />
          )}

          {activeTab === "MAP" && (
            <VenueMap
              cameras={cameras}
              global={globalState}
              onInspectCamera={(cam) => setSpotlightCamera(cam)}
            />
          )}

          {activeTab === "ANALYTICS" && (
            <AnalyticsStudio
              cameras={cameras}
              global={globalState}
            />
          )}

          {activeTab === "INCIDENTS" && (
            <IncidentCenter
              alerts={alerts}
              cameras={cameras}
              onInspectCamera={(cam) => setSpotlightCamera(cam)}
            />
          )}

          {activeTab === "UPLOAD" && (
            <div className="panel p-6 border-slate-800 bg-slate-900/80 shadow-2xl backdrop-blur-xl">
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-white">Surveillance Footage Deep Analysis Studio</h2>
                  <p className="text-xs text-slate-400">
                    Upload archived incident video files (MP4/MOV) for offline dual-regime crowd analytics and density reconstruction.
                  </p>
                </div>
                <span className="rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1 text-xs font-semibold text-teal-300">
                  Offline Ingestion
                </span>
              </div>
              <UploadPanel />
            </div>
          )}
        </section>

        {/* ========================================================================= */}
        {/* 6. MODALS & POPUPS                                                        */}
        {/* ========================================================================= */}

        {/* Camera Spotlight / Deep Diagnostics Modal */}
        {spotlightCamera && (
          <CameraSpotlightModal
            camera={spotlightCamera}
            onClose={() => setSpotlightCamera(null)}
            onCameraLiveUpdate={updateCameraLiveMetrics}
          />
        )}

        {/* Viva Presentation Simulator Modal */}
        {isSimulatorOpen && (
          <DemoSimulator
            cameras={cameras}
            onApplySimulation={applySimulationMetrics}
            onClose={() => setIsSimulatorOpen(false)}
            onRefreshDashboard={refreshDashboard}
          />
        )}

        {/* Executive Safety Audit Report Modal */}
        {isReportOpen && (
          <ReportExportModal
            cameras={cameras}
            global={globalState}
            alerts={alerts}
            onClose={() => setIsReportOpen(false)}
          />
        )}

        {/* Add Camera Zone Modal */}
        {isCameraModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4 backdrop-blur-md">
            <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-800 bg-slate-900 shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-800 px-6 py-4">
                <div>
                  <h3 className="text-base font-bold text-white">Add Surveillance Zone</h3>
                  <p className="text-xs text-slate-400">Register RTSP, Webcam, or HTTP source for DirectML ingestion.</p>
                </div>
                <button
                  className="rounded-xl border border-slate-800 bg-slate-950 p-2 text-slate-400 hover:bg-slate-800 hover:text-white"
                  onClick={() => setIsCameraModalOpen(false)}
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-[80vh] overflow-y-auto p-6">
                <CameraForm
                  onCameraCreated={(camera) => {
                    upsertCamera(camera);
                    setIsCameraModalOpen(false);
                  }}
                  onCameraChanged={async (camera) => {
                    if (camera?.id) {
                      await refreshDashboard(camera);
                    } else {
                      await refreshDashboard();
                    }
                  }}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
