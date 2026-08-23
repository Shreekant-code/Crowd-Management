import { Activity, AlertTriangle, Gauge, Layers3, MapPinned, Radar, UsersRound } from "lucide-react";
import { riskClass } from "@/lib/risk";

function Stat({ label, value, icon: Icon, tone }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
        </div>
        <div className={`rounded-2xl p-3 ${tone}`}>
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}

export function GlobalAnalyticsPanel({ global, topActiveZones = [] }) {
  const alertSummary = global?.alertSummary || {};

  return (
    <section className="panel p-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-slate-100 p-3 text-slate-700">
            <Layers3 className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Global Analytics</h2>
            <p className="text-sm text-slate-500">Venue-wide summary built only from camera metrics.</p>
          </div>
        </div>
        <span className={`${riskClass(global?.overallRisk || "Low")} rounded-full`}>
          {global?.overallRisk || "Low"}
        </span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        <Stat label="Total Crowd" value={global?.totalCrowd ?? 0} icon={UsersRound} tone="bg-teal-50 text-teal-700" />
        <Stat label="Average Crowd" value={global?.averageCrowd ?? 0} icon={Activity} tone="bg-slate-100 text-slate-700" />
        <Stat label="Venue Occupancy" value={`${Math.round((global?.venueOccupancy ?? 0) * 100)}%`} icon={Gauge} tone="bg-amber-50 text-amber-700" />
        <Stat label="Global Density" value={(global?.globalDensity ?? 0).toFixed(2)} icon={MapPinned} tone="bg-indigo-50 text-indigo-700" />
        <Stat label="Global Congestion" value={(global?.globalCongestion ?? 0).toFixed(2)} icon={AlertTriangle} tone="bg-orange-50 text-orange-700" />
        <Stat label="Online Cameras" value={`${global?.onlineCameras ?? 0}/${global?.totalCameras ?? 0}`} icon={Radar} tone="bg-emerald-50 text-emerald-700" />
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Most Crowded</p>
          <p className="mt-2 text-sm font-semibold text-slate-950">{global?.mostCrowdedCamera?.zoneName || "N/A"}</p>
          <p className="mt-1 text-xs text-slate-500">
            {global?.mostCrowdedCamera ? `${global.mostCrowdedCamera.name} - ${global.mostCrowdedCamera.metrics?.current_count ?? global.mostCrowdedCamera.metrics?.count ?? global.mostCrowdedCamera.metrics?.people_count ?? global.mostCrowdedCamera.metrics?.raw_count ?? global.mostCrowdedCamera.metrics?.yolo_count ?? 0} people` : "Waiting for live cameras"}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Highest Risk</p>
          <p className="mt-2 text-sm font-semibold text-slate-950">{global?.highestRiskCamera?.zoneName || "N/A"}</p>
          <p className="mt-1 text-xs text-slate-500">
            {global?.highestRiskCamera ? `${global.highestRiskCamera.metrics?.risk || "Low"} risk` : "Waiting for live cameras"}
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Alert Summary</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-4">
          <div className="rounded-2xl bg-slate-50 p-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">Total</p>
            <p className="mt-1 text-lg font-semibold text-slate-950">{alertSummary.total || 0}</p>
          </div>
          <div className="rounded-2xl bg-emerald-50 p-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-emerald-700">Low</p>
            <p className="mt-1 text-lg font-semibold text-emerald-700">{alertSummary.low || 0}</p>
          </div>
          <div className="rounded-2xl bg-amber-50 p-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-amber-700">Medium</p>
            <p className="mt-1 text-lg font-semibold text-amber-700">{alertSummary.medium || 0}</p>
          </div>
          <div className="rounded-2xl bg-red-50 p-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-red-700">High+</p>
            <p className="mt-1 text-lg font-semibold text-red-700">{(alertSummary.high || 0) + (alertSummary.critical || 0)}</p>
          </div>
        </div>
      </div>

      <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Top Active Zones</p>
        <div className="mt-3 space-y-3">
          {topActiveZones.length ? (
            topActiveZones.map((camera, index) => (
              <div key={camera.id} className="rounded-2xl border border-slate-200 bg-white p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-950">
                      #{index + 1} {camera.zoneName}
                    </p>
                    <p className="text-xs text-slate-500">
                      {camera.name} - {camera.metrics?.current_count ?? camera.metrics?.count ?? camera.metrics?.people_count ?? camera.metrics?.raw_count ?? camera.metrics?.yolo_count ?? 0} people
                    </p>
                  </div>
                  <span className={`${riskClass(camera.metrics?.risk)} rounded-full`}>
                    {camera.metrics?.risk || "Low"}
                  </span>
                </div>
                <div className="mt-3 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                  <span>Count {camera.metrics?.current_count ?? camera.metrics?.count ?? camera.metrics?.people_count ?? camera.metrics?.raw_count ?? camera.metrics?.yolo_count ?? 0}</span>
                  <span>Prediction {camera.metrics?.prediction_10min_count ?? camera.metrics?.predicted_crowd ?? 0}</span>
                </div>
              </div>
            ))
          ) : (
            <p className="rounded-2xl border border-dashed border-slate-200 bg-white p-4 text-sm text-slate-500">
              No active cameras right now.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
