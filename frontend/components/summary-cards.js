import { Activity, MapPinned, Siren, UsersRound } from "lucide-react";

const items = [
  { key: "totalZones", label: "Total Zones", icon: MapPinned, tone: "bg-slate-100 text-slate-800" },
  { key: "activeZones", label: "Active Zones", icon: Activity, tone: "bg-teal-100 text-teal-700" },
  { key: "totalCount", label: "Current Count", icon: UsersRound, tone: "bg-amber-100 text-amber-700" },
  { key: "highRiskZones", label: "High Risk", icon: Siren, tone: "bg-red-100 text-red-700" },
];

export function SummaryCards({ summary }) {
  return (
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => {
        const Icon = item.icon;
        return (
          <article key={item.key} className="panel p-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-sm text-slate-500">{item.label}</p>
                <p className="mt-2 text-3xl font-semibold text-slate-950">{summary?.[item.key] ?? 0}</p>
              </div>
              <div className={`rounded-2xl p-3 ${item.tone}`}>
                <Icon className="h-5 w-5" />
              </div>
            </div>
          </article>
        );
      })}
    </section>
  );
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

function getLiveCount(metrics = {}) {
  return metrics?.current_count ?? metrics?.count ?? metrics?.people_count ?? 0;
}
