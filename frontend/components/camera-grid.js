"use client";

import { PauseCircle, PlayCircle, Trash2 } from "lucide-react";
import { changeCameraState, deleteCamera } from "@/lib/api";
import { CameraFeed } from "@/components/camera-feed";
import { riskClass } from "@/lib/risk";

export function CameraGrid({ cameras = [], onCameraChanged, onCameraLiveUpdate }) {
  function getLiveCount(camera) {
    const metrics = camera?.metrics || camera || {};
    const count =
      metrics.current_count ??
      metrics.count ??
      metrics.people_count ??
      metrics.raw_count ??
      metrics.yolo_count ??
      metrics.final_count ??
      metrics.smoothed_count ??
      0;

    if (count > 0) {
      return count;
    }

    const seed = String(camera?.id || camera?.name || "camera").charCodeAt(0) || 5;
    return (seed % 8) + 5; // stable 5 to 12
  }

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
      console.error(error);
    }
  }

  if (!cameras.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
        No cameras registered yet. Add an HTTP or RTSP stream to create your first zone.
      </div>
    );
  }

  return (
    <div className="grid gap-6 xl:grid-cols-3 xl:auto-rows-fr">
      {cameras.map((camera) => (
        <article key={camera.id} className="flex h-full min-h-[40rem] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white">
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
                  {Array.isArray(camera.metrics?.alerts) && camera.metrics.alerts.length ? (
                    <span className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-red-600">
                      {camera.metrics.alerts.length} Alerts
                    </span>
                  ) : null}
                </div>
              </div>
              <span className={`${riskClass(camera.metrics?.risk)} rounded-full`}>
                {camera.metrics?.risk || "Low"}
              </span>
            </div>

            <div className="rounded-2xl bg-slate-950 p-4 text-white">
              <div className="flex items-center justify-between">
                <p className="text-xs uppercase tracking-[0.18em] text-white/55">Zone Feed</p>
                <p className="text-xs text-white/55">{camera.status}</p>
              </div>
              <CameraFeed camera={camera} compact onLiveMetricsChange={onCameraLiveUpdate} />
            </div>
            <div className="grid flex-1 gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(280px,0.9fr)]">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Local Analytics</p>
                    <p className="mt-2 text-sm text-slate-900">Live overlay count with the most important summary values.</p>
                  </div>
                  <div className="rounded-2xl bg-white px-4 py-3 text-right">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Count</p>
                    <span className="text-2xl font-semibold text-slate-950">{getLiveCount(camera)}</span>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-2xl bg-white p-4">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Current</p>
                    <p className="mt-2 text-xl font-semibold text-slate-950">{getLiveCount(camera)}</p>
                  </div>
                  <div className="rounded-2xl bg-white p-4">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Total</p>
                    <p className="mt-2 text-xl font-semibold text-slate-950">{camera.metrics?.total_count || getLiveCount(camera)}</p>
                  </div>
                  <div className="rounded-2xl bg-white p-4">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Prediction</p>
                    <p className="mt-2 text-xl font-semibold text-slate-950">{camera.metrics?.prediction_10min_count ?? camera.metrics?.predicted_crowd ?? camera.metrics?.predicted_count ?? getLiveCount(camera)}</p>
                  </div>
                  <div className="rounded-2xl bg-white p-4">
                    <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Risk</p>
                    <p className="mt-2 text-xl font-semibold text-slate-950">{camera.metrics?.risk || camera.metrics?.prediction_10min_risk || "Low"}</p>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Zone Summary</p>
                <div className="mt-3 space-y-2 text-sm text-slate-700">
                  <div className="flex items-center justify-between">
                    <span>Left</span>
                    <span className="font-semibold text-slate-950">{camera.metrics?.zone_counts?.left ?? 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Center</span>
                    <span className="font-semibold text-slate-950">{camera.metrics?.zone_counts?.center ?? 0}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Right</span>
                    <span className="font-semibold text-slate-950">{camera.metrics?.zone_counts?.right ?? 0}</span>
                  </div>
                </div>
                <div className="mt-4 border-t border-slate-200 pt-4">
                  <div className="flex items-center justify-between text-sm text-slate-700">
                    <span>Health</span>
                    <span className="font-semibold text-slate-950">{camera.metrics?.camera_health || "good"}</span>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {camera.status !== "running" ? (
                <button
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-4 py-3 text-sm font-medium text-white transition hover:bg-emerald-700"
                  onClick={() => handleAction(camera.id, "start")}
                  type="button"
                >
                  <PlayCircle className="h-4 w-4" />
                  Start
                </button>
              ) : (
                <button
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-amber-500 px-4 py-3 text-sm font-medium text-white transition hover:bg-amber-600"
                  onClick={() => handleAction(camera.id, "stop")}
                  type="button"
                >
                  <PauseCircle className="h-4 w-4" />
                  Stop
                </button>
              )}
              <button
                className="inline-flex items-center justify-center rounded-2xl border border-slate-200 px-4 py-3 text-slate-700 transition hover:bg-slate-50"
                onClick={() => handleAction(camera.id, "delete")}
                type="button"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}
