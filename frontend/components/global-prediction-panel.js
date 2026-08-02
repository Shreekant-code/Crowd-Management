import { ArrowUpRight, BrainCircuit, ShieldAlert, Sparkles } from "lucide-react";
import { riskClass } from "@/lib/risk";

export function GlobalPredictionPanel({ global }) {
  const prediction = global?.globalPrediction || {};

  return (
    <section className="panel p-5">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-indigo-50 p-3 text-indigo-700">
            <BrainCircuit className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-slate-950">Global Prediction</h2>
            <p className="text-sm text-slate-500">Aggregated prediction built from all active camera metrics.</p>
          </div>
        </div>
        <span className={`${riskClass(global?.overallRisk || "Low")} rounded-full`}>
          {global?.overallRisk || "Low"}
        </span>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-5">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Next 10 Minutes</p>
            <p className="mt-2 text-3xl font-semibold text-slate-950">{prediction.projectedCount ?? 0}</p>
            <p className="mt-1 text-sm text-slate-500">{prediction.label || "Global Prediction (10 min): LOW RISK"}</p>
          </div>
          <div className="rounded-2xl bg-white p-4 text-slate-700 shadow-sm">
            <ArrowUpRight className="h-6 w-6" />
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-white p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Confidence</p>
            <p className="mt-2 text-xl font-semibold text-slate-950">{(prediction.confidence ?? global?.predictionConfidence ?? 0).toFixed(2)}</p>
          </div>
          <div className="rounded-2xl bg-white p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Trend</p>
            <p className="mt-2 text-xl font-semibold text-slate-950">{global?.trend || prediction.trend || "stable"}</p>
          </div>
          <div className="rounded-2xl bg-white p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Offline Cameras</p>
            <p className="mt-2 text-xl font-semibold text-slate-950">{global?.offlineCameras ?? 0}</p>
          </div>
          <div className="rounded-2xl bg-white p-4">
            <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Overall Risk Score</p>
            <p className="mt-2 text-xl font-semibold text-slate-950">{Number(global?.overallRiskScore ?? 0).toFixed(2)}</p>
          </div>
        </div>

        <div className="mt-5 rounded-2xl border border-dashed border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-white p-2 text-amber-600">
              <ShieldAlert className="h-4 w-4" />
            </div>
            <div>
              <p className="font-semibold text-slate-950">Phase 1 ready for later evacuation mapping</p>
              <p className="mt-1">This panel stores only aggregated crowd pressure and prediction outputs so Phase 2 can consume safe-zone and route logic later.</p>
            </div>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">Venue Occupancy {Math.round((global?.venueOccupancy ?? 0) * 100)}%</span>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">Global Density {(global?.globalDensity ?? 0).toFixed(2)}</span>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">Global Congestion {(global?.globalCongestion ?? 0).toFixed(2)}</span>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">{global?.predictionConfidence ? `Prediction Confidence ${(global.predictionConfidence).toFixed(2)}` : "Prediction Confidence 0.00"}</span>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600">{prediction.horizonMinutes || 10} min horizon</span>
            <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-600 inline-flex items-center gap-1">
              <Sparkles className="h-3.5 w-3.5" />
              Aggregated Only
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
