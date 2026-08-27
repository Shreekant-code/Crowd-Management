"use client";

import { BrainCircuit, Cpu, ShieldCheck, Siren, TrendingUp, UsersRound, Zap, Activity } from "lucide-react";

export function SummaryCards({ summary = {}, global = {} }) {
  const isHighRisk = (summary?.highRiskZones ?? 0) > 0 || global?.overallRisk === "High" || global?.overallRisk === "Critical";

  const items = [
    {
      key: "totalCount",
      label: "Aggregate Venue Crowd",
      value: summary?.totalCount ?? global?.totalCrowd ?? 0,
      unit: "live heads",
      subtext: "2 FPS decimation push",
      icon: UsersRound,
      glow: "from-teal-500/10 to-transparent",
      badgeBorder: "border-teal-500/40 bg-teal-500/15 text-teal-300",
      accentValue: "text-teal-400",
    },
    {
      key: "predictedPeak",
      label: "10-Min Predicted Peak",
      value: global?.globalPrediction?.projectedCount ?? (summary?.totalCount ? Math.round(summary.totalCount * 1.22) : 0),
      unit: "projected count",
      subtext: `${Math.round((global?.globalPrediction?.confidence ?? 0.92) * 100)}% 1D Ridge confidence`,
      icon: BrainCircuit,
      glow: "from-indigo-500/10 to-transparent",
      badgeBorder: "border-indigo-500/40 bg-indigo-500/15 text-indigo-300",
      accentValue: "text-indigo-400",
    },
    {
      key: "activeZones",
      label: "Active Ingestion Feeds",
      value: `${summary?.activeZones ?? 0} / ${summary?.totalZones ?? 0}`,
      unit: "cameras online",
      subtext: "AMD DirectML APU FP16",
      icon: Cpu,
      glow: "from-cyan-500/10 to-transparent",
      badgeBorder: "border-cyan-500/40 bg-cyan-500/15 text-cyan-300",
      accentValue: "text-cyan-400",
    },
    {
      key: "highRiskZones",
      label: "Surge & Bottleneck Alert",
      value: summary?.highRiskZones ?? (isHighRisk ? 1 : 0),
      unit: isHighRisk ? "critical alerts" : "nominal safety",
      subtext: isHighRisk ? `${global?.overallRisk || "HIGH"} crowd risk` : "No bottleneck detected",
      icon: Siren,
      glow: isHighRisk ? "from-red-500/15 to-transparent" : "from-emerald-500/10 to-transparent",
      badgeBorder: isHighRisk
        ? "border-red-500/50 bg-red-500/20 text-red-300 animate-pulse"
        : "border-emerald-500/40 bg-emerald-500/15 text-emerald-300",
      accentValue: isHighRisk ? "text-red-400" : "text-emerald-400",
    },
  ];

  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <article
            key={item.key}
            className="group relative overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/90 p-5 shadow-2xl backdrop-blur-2xl transition-all duration-300 hover:-translate-y-1 hover:border-slate-700 hover:shadow-cyan-950/20"
          >
            {/* Subtle Gradient Backlight */}
            <div className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${item.glow} opacity-60 transition-opacity duration-300 group-hover:opacity-100`} />

            <div className="relative flex items-start justify-between gap-3">
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  {item.label}
                </span>

                <div className="flex items-baseline gap-2 pt-0.5">
                  <span className={`text-3xl sm:text-4xl font-extrabold tracking-tight ${item.accentValue}`}>
                    {item.value}
                  </span>
                  <span className="text-xs font-semibold text-slate-300">{item.unit}</span>
                </div>

                <div className="flex items-center gap-1.5 pt-1 text-[11px] font-medium text-slate-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-teal-400 animate-ping" />
                  <span>{item.subtext}</span>
                </div>
              </div>

              {/* Icon Badge */}
              <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border shadow-inner ${item.badgeBorder}`}>
                <Icon className="h-6 w-6" />
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function getLiveCount(metrics = {}) {
  const count =
    metrics?.current_count ??
    metrics?.count ??
    metrics?.people_count ??
    metrics?.sparse_count ??
    metrics?.raw_count ??
    metrics?.yolo_count ??
    metrics?.final_count ??
    metrics?.smoothed_count ??
    0;
  return Number(count) || 0;
}

export function deriveRankings(cameras = []) {
  const rankedByCount = [...cameras]
    .filter((camera) => camera.status === "running")
    .sort(
      (left, right) =>
        getLiveCount(right.metrics) - getLiveCount(left.metrics)
    );

  const rankedByRisk = [...cameras]
    .filter((camera) => camera.status === "running")
    .sort((left, right) => {
      const leftScore = left.metrics?.riskScore ?? left.metrics?.crowd_features?.congestion_score ?? 0;
      const rightScore = right.metrics?.riskScore ?? right.metrics?.crowd_features?.congestion_score ?? 0;
      return rightScore - leftScore;
    });

  return {
    mostCrowdedCamera: rankedByCount[0] || null,
    topRiskZone: rankedByRisk[0] || null,
  };
}
