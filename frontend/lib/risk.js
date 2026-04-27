import clsx from "clsx";

export const riskTone = {
  Low: "text-emerald-700 bg-emerald-100 border-emerald-200",
  Medium: "text-amber-700 bg-amber-100 border-amber-200",
  High: "text-orange-700 bg-orange-100 border-orange-200",
  Critical: "text-red-700 bg-red-100 border-red-200",
};

export const riskGlow = {
  Low: "from-emerald-400/30 to-emerald-100/0",
  Medium: "from-amber-400/30 to-amber-100/0",
  High: "from-orange-400/30 to-orange-100/0",
  Critical: "from-red-500/30 to-red-100/0",
};

export function riskClass(risk) {
  return clsx("border px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em]", riskTone[risk] || riskTone.Low);
}

