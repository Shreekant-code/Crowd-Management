import clsx from "clsx";

export const riskTone = {
  Low: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_12px_rgba(16,185,129,0.15)]",
  Medium: "text-amber-400 bg-amber-500/10 border-amber-500/30 shadow-[0_0_12px_rgba(245,158,11,0.15)]",
  High: "text-orange-400 bg-orange-500/10 border-orange-500/30 shadow-[0_0_16px_rgba(249,115,22,0.25)]",
  Critical: "text-red-400 bg-red-500/15 border-red-500/40 shadow-[0_0_20px_rgba(239,68,68,0.35)] animate-pulse",
};

export const riskGlow = {
  Low: "from-emerald-500/20 via-emerald-500/5 to-transparent",
  Medium: "from-amber-500/20 via-amber-500/5 to-transparent",
  High: "from-orange-500/25 via-orange-500/5 to-transparent",
  Critical: "from-red-500/30 via-red-500/10 to-transparent",
};

export const riskBorderColor = {
  Low: "#10b981",
  Medium: "#f59e0b",
  High: "#f97316",
  Critical: "#ef4444",
};

export function riskClass(risk = "Low") {
  const normalized = String(risk || "Low").charAt(0).toUpperCase() + String(risk || "Low").slice(1).toLowerCase();
  return clsx(
    "border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] rounded-full transition-all duration-300",
    riskTone[normalized] || riskTone.Low
  );
}
