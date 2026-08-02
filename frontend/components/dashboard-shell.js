"use client";

import { useEffect, useState } from "react";
import {
  LogOut,
  Radar,
  RefreshCw,
  Plus,
  X,
  Video,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { getSocket } from "@/lib/socket";
import { getDashboardData } from "@/lib/api";
import { CameraForm } from "./camera-form";
import { CameraGrid } from "./camera-grid";
import { GlobalAnalyticsPanel } from "./global-analytics-panel";
import { GlobalPredictionPanel } from "./global-prediction-panel";

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
      confidence: 0,
      horizonMinutes: 10,
      trend: "stable",
      label: "Global Prediction (10 min): LOW RISK",
    },
    predictionConfidence: 0,
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

function getLiveCount(metrics = {}) {
  return metrics?.current_count ?? metrics?.count ?? metrics?.people_count ?? 0;
}

function getTopActiveZones(cameras = []) {
  return [...cameras]
    .filter((camera) => camera.status === "running")
    .sort((left, right) => {
      const leftCount = getLiveCount(left.metrics);
      const rightCount = getLiveCount(right.metrics);
      return rightCount - leftCount;
    })
    .slice(0, 3);
}

export function DashboardShell({ initialData, operatorName }) {
  const [dashboard, setDashboard] = useState(initialData);
  const [lastSocketAt, setLastSocketAt] = useState(initialData?.timestamp || null);
  const [globalState, setGlobalState] = useState(() => buildGlobalFallback(initialData || {}));
  const [isCameraModalOpen, setIsCameraModalOpen] = useState(false);
  const [isGlobalDockOpen, setIsGlobalDockOpen] = useState(false);
  const topActiveZones = getTopActiveZones(dashboard.cameras || []);

  function applyDashboard(payload) {
    if (!payload || !Array.isArray(payload.cameras)) {
      return;
    }

    setDashboard(payload);
    setGlobalState(buildGlobalFallback(payload));
    setLastSocketAt(payload.timestamp || new Date().toISOString());
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

      cameras[index] = {
        ...existingCamera,
        metrics: {
          ...(existingCamera.metrics || {}),
          ...(metrics || {}),
          updatedAt: nextUpdatedAt,
        },
        lastFrameAt: nextUpdatedAt,
      };

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

  useEffect(() => {
    let activeSocket;
    let refreshInterval;

    async function connectSocket() {
      const socket = await getSocket();
      activeSocket = socket;
      await refreshDashboard();
      refreshInterval = setInterval(() => {
        void refreshDashboard();
      }, 1500);

      socket.on("dashboard:update", (payload) => {
        applyDashboard(payload);
      });

      socket.on("camera:update", (camera) => {
        upsertCamera(camera);
      });

      socket.on("alert:new", (alert) => {
        setDashboard((current) => ({
          ...current,
          alerts: [alert, ...(current?.alerts || [])].slice(0, 40),
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
    }

    connectSocket();

    return () => {
      if (refreshInterval) {
        clearInterval(refreshInterval);
      }
      if (activeSocket) {
        activeSocket.off("dashboard:update");
        activeSocket.off("camera:update");
        activeSocket.off("alert:new");
        activeSocket.off("global:update");
        activeSocket.off("global:prediction");
        activeSocket.off("dashboard:summary");
      }
    };
  }, []);

  return (
    <main className="min-h-screen w-full px-0 py-0">
      <div className="flex w-full flex-col gap-6 px-4 py-4 sm:px-5 sm:py-5 lg:px-6 lg:py-6">
        <header className="panel relative overflow-hidden p-6">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(11,143,135,0.16),transparent_35%),radial-gradient(circle_at_right,rgba(255,107,87,0.12),transparent_30%)]" />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/70 bg-white/70 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                <Radar className="h-4 w-4 text-teal" />
                Crowd Monitoring Cloud
              </div>
              <div>
                <h1 className="text-3xl font-semibold text-slate-950 sm:text-4xl">Operations Dashboard</h1>
                <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                  Manage live RTSP zones, review crowd-risk signals, and process uploaded footage from one cloud workspace.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="rounded-2xl border border-slate-200 bg-white/80 px-4 py-3 text-sm text-slate-600">
                <p className="font-medium text-slate-900">{operatorName}</p>
                <p>Last live sync: {lastSocketAt ? new Date(lastSocketAt).toLocaleTimeString() : "Waiting"}</p>
              </div>
              <button
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800"
                onClick={() => signOut({ callbackUrl: "/login" })}
                type="button"
              >
                <LogOut className="h-4 w-4" />
                Logout
              </button>
            </div>
          </div>
        </header>

        <section className="panel p-5">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="rounded-2xl bg-teal-50 p-3 text-teal">
                <Video className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-slate-950">Camera Grid</h2>
                <p className="text-sm text-slate-500">Three equal live tiles with local detection, prediction, and risk.</p>
              </div>
            </div>
            <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              <RefreshCw className="h-3.5 w-3.5" />
              Real-time
            </div>
          </div>
          <CameraGrid
            cameras={dashboard.cameras}
            onCameraChanged={refreshDashboard}
            onCameraLiveUpdate={updateCameraLiveMetrics}
          />
        </section>

        <div className="fixed bottom-6 right-6 z-40 flex w-[min(92vw,420px)] flex-col items-end gap-3">
          {isGlobalDockOpen ? (
            <div className="max-h-[calc(100vh-8.5rem)] w-full overflow-y-auto rounded-3xl border border-slate-200 bg-white p-4 shadow-2xl">
              <GlobalAnalyticsPanel global={globalState} topActiveZones={topActiveZones} />
              <div className="mt-4">
                <GlobalPredictionPanel global={globalState} />
              </div>
            </div>
          ) : null}

          <button
            className="flex w-fit items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-3 text-left shadow-xl transition hover:border-slate-300 hover:shadow-2xl"
            onClick={() => setIsGlobalDockOpen((current) => !current)}
            type="button"
          >
            <span className="rounded-full bg-slate-950 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-white">
              Global
            </span>
            <span className="text-sm font-medium text-slate-950">
              {globalState?.overallRisk || "Low"} Risk
            </span>
            <span className="text-xs text-slate-500">
              {isGlobalDockOpen ? "Hide" : "Open"}
            </span>
          </button>
        </div>

        {isCameraModalOpen ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4 py-6 backdrop-blur-sm">
            <div className="w-full max-w-2xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
                <div>
                  <h3 className="text-lg font-semibold text-slate-950">Add Camera Zone</h3>
                  <p className="text-sm text-slate-500">Register a source and start live analytics immediately.</p>
                </div>
                <button
                  className="rounded-2xl border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-50"
                  onClick={() => setIsCameraModalOpen(false)}
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="max-h-[80vh] overflow-y-auto p-5">
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
        ) : null}

        <button
          className="fixed bottom-6 left-6 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-slate-900 bg-slate-950 text-white shadow-2xl transition hover:scale-105 hover:bg-slate-800"
          onClick={() => setIsCameraModalOpen(true)}
          type="button"
          aria-label="Add camera"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>
    </main>
  );
}
