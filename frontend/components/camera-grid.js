"use client";

import { PauseCircle, PlayCircle, Trash2 } from "lucide-react";
import { changeCameraState, deleteCamera } from "@/lib/api";
import { CameraFeed } from "@/components/camera-feed";
import { riskClass } from "@/lib/risk";

export function CameraGrid({ cameras = [], onCameraChanged }) {
  function getLiveCount(camera) {
    return camera.metrics?.current_count ?? camera.metrics?.count ?? camera.metrics?.people_count ?? 0;
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

      await changeCameraState(id, action);
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
    <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3">
      {cameras.map((camera) => (
        <article key={camera.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className={`h-2 bg-gradient-to-r ${camera.metrics?.risk === "Critical" ? "from-red-500 to-orange-400" : camera.metrics?.risk === "High" ? "from-orange-500 to-amber-400" : camera.metrics?.risk === "Medium" ? "from-amber-400 to-yellow-300" : "from-emerald-400 to-teal-400"}`} />
          <div className="space-y-5 p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-lg font-semibold text-slate-950">{camera.zoneName}</p>
                <p className="text-sm text-slate-500">{camera.name}</p>
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
              <CameraFeed camera={camera} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Live Crowd Count</p>
                <p className="mt-2 text-2xl font-semibold text-slate-950">{getLiveCount(camera)}</p>
              </div>
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Location</p>
                <p className="mt-2 text-sm font-medium text-slate-900">{camera.location}</p>
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
