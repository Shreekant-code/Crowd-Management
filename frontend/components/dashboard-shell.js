"use client";

import { useEffect, useState } from "react";
import {
  BellRing,
  Crown,
  Flame,
  LayoutGrid,
  LogOut,
  Radar,
  RefreshCw,
  ShieldAlert,
  UploadCloud,
  Video,
} from "lucide-react";
import { signOut } from "next-auth/react";
import { getSocket } from "@/lib/socket";
import { getDashboardData } from "@/lib/api";
import { CameraForm } from "./camera-form";
import { CameraGrid } from "./camera-grid";
import { AlertsPanel } from "./alerts-panel";
import { UploadPanel } from "./upload-panel";
import { deriveRankings, SummaryCards } from "./summary-cards";
import { riskClass } from "@/lib/risk";

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

function getLiveCount(metrics = {}) {
  return metrics?.current_count ?? metrics?.count ?? metrics?.people_count ?? 0;
}

export function DashboardShell({ initialData, operatorName }) {
  const [dashboard, setDashboard] = useState(initialData);
  const [lastSocketAt, setLastSocketAt] = useState(initialData?.timestamp || null);
  const rankings = deriveRankings(dashboard.cameras || []);

  function applyDashboard(payload) {
    if (!payload || !Array.isArray(payload.cameras)) {
      return;
    }

    setDashboard(payload);
    setLastSocketAt(payload.timestamp || new Date().toISOString());
  }

  async function refreshDashboard() {
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
        timestamp: camera.metrics?.updatedAt || new Date().toISOString(),
      };
    });
    setLastSocketAt(camera.metrics?.updatedAt || new Date().toISOString());
  }

  useEffect(() => {
    let activeSocket;

    async function connectSocket() {
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
        setDashboard((current) => ({
          ...current,
          alerts: [alert, ...(current?.alerts || [])].slice(0, 40),
        }));
      });
    }

    connectSocket();

    return () => {
      if (activeSocket) {
        activeSocket.off("dashboard:update");
        activeSocket.off("camera:update");
        activeSocket.off("alert:new");
      }
    };
  }, []);

  return (
    <main className="min-h-screen px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-6">
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

        <SummaryCards summary={dashboard.summary} />

        <section className="grid gap-4 lg:grid-cols-2">
          <article className="panel p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500">Most Crowded Camera</p>
                <p className="mt-2 text-xl font-semibold text-slate-950">
                  {rankings.mostCrowdedCamera?.zoneName || "Waiting for live data"}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {rankings.mostCrowdedCamera
                    ? `${rankings.mostCrowdedCamera.name} - ${getLiveCount(rankings.mostCrowdedCamera.metrics)} people`
                    : "Start a live stream to rank zones by tracked count."}
                </p>
              </div>
              <div className="rounded-2xl bg-amber-100 p-3 text-amber-700">
                <Crown className="h-5 w-5" />
              </div>
            </div>
          </article>
          <article className="panel p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500">Top Risk Zone</p>
                <p className="mt-2 text-xl font-semibold text-slate-950">
                  {rankings.topRiskZone?.zoneName || "Waiting for live data"}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {rankings.topRiskZone
                    ? `Risk score ${(rankings.topRiskZone.metrics?.riskScore ?? 0).toFixed(2)} - density ${(rankings.topRiskZone.metrics?.crowd_features?.density_score ?? 0).toFixed(2)}`
                    : "Density and movement scoring will surface the riskiest zone here."}
                </p>
              </div>
              <div className="flex flex-col items-end gap-2">
                <div className="rounded-2xl bg-red-100 p-3 text-red-700">
                  <Flame className="h-5 w-5" />
                </div>
                {rankings.topRiskZone ? (
                  <span className={`${riskClass(rankings.topRiskZone.metrics?.risk)} rounded-full`}>
                    {rankings.topRiskZone.metrics?.risk}
                  </span>
                ) : null}
              </div>
            </div>
          </article>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.35fr_0.65fr]">
          <div className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-[0.9fr_1.1fr]">
              <div className="panel p-5">
                <div className="mb-5 flex items-center gap-3">
                  <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
                    <LayoutGrid className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">Register Zone Camera</h2>
                    <p className="text-sm text-slate-500">Add HTTP or RTSP streams and assign them to crowd zones.</p>
                  </div>
                </div>
                <CameraForm onCameraCreated={upsertCamera} onCameraChanged={refreshDashboard} />
              </div>
              <div className="panel p-5">
                <div className="mb-5 flex items-center gap-3">
                  <div className="rounded-2xl bg-orange-50 p-3 text-orange-600">
                    <UploadCloud className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">Video Processing</h2>
                    <p className="text-sm text-slate-500">Upload incident footage for ffmpeg normalization and mock AI review.</p>
                  </div>
                </div>
                <UploadPanel />
              </div>
            </div>

            <div className="panel p-5">
              <div className="mb-5 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-teal-50 p-3 text-teal">
                    <Video className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold text-slate-950">Camera Grid</h2>
                    <p className="text-sm text-slate-500">Live zone status, risk level, and worker controls.</p>
                  </div>
                </div>
                <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 px-3 py-2 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Real-time
                </div>
              </div>
              <CameraGrid cameras={dashboard.cameras} onCameraChanged={refreshDashboard} />
            </div>
          </div>

          <div className="space-y-6 xl:sticky xl:top-4 xl:self-start">
            <div className="panel p-5">
              <div className="mb-4 flex items-center gap-3">
                <div className="rounded-2xl bg-red-50 p-3 text-red-600">
                  <ShieldAlert className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Risk Watch</h2>
                  <p className="text-sm text-slate-500">Quick look at escalated zones across your workspace.</p>
                </div>
              </div>
              <div className="space-y-3">
                {(dashboard.cameras || [])
                  .filter((camera) => ["High", "Critical"].includes(camera.metrics?.risk))
                  .slice(0, 4)
                  .map((camera) => (
                    <div key={camera.id} className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">{camera.zoneName}</p>
                          <p className="text-xs text-slate-500">{camera.name}</p>
                        </div>
                        <div className="inline-flex items-center gap-2 rounded-full bg-red-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-red-700">
                          <BellRing className="h-3.5 w-3.5" />
                          {camera.metrics?.risk}
                        </div>
                      </div>
                    </div>
                  ))}
                {!dashboard.cameras?.some((camera) => ["High", "Critical"].includes(camera.metrics?.risk)) ? (
                  <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-5 text-sm text-slate-500">
                    No escalated zones right now.
                  </div>
                ) : null}
              </div>
            </div>
            <AlertsPanel alerts={dashboard.alerts} />
          </div>
        </section>
      </div>
    </main>
  );
}
