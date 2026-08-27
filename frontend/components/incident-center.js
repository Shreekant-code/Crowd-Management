"use client";

import { useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  Bell,
  CheckCircle2,
  Clock,
  Download,
  Flame,
  Layers,
  Megaphone,
  Radio,
  Send,
  ShieldAlert,
  ShieldCheck,
  Siren,
  SlidersHorizontal,
  Sparkles,
  Unlock,
  UserCheck,
} from "lucide-react";
import { riskClass } from "@/lib/risk";

export function IncidentCenter({ alerts = [], cameras = [], onInspectCamera }) {
  const [filterSeverity, setFilterSeverity] = useState("ALL");
  const [dispatchedActions, setDispatchedActions] = useState([
    {
      id: "act-1",
      action: "Dynamic Inflow Throttling",
      zone: "Zone A: North Gate Plaza",
      target: "Gate Turnstiles 1-4",
      status: "Active",
      time: "2 mins ago",
      icon: SlidersHorizontal,
      tone: "text-amber-300 bg-amber-500/15 border-amber-500/30",
    },
    {
      id: "act-2",
      action: "Auxiliary Egress Release",
      zone: "Zone B: Central Concourse",
      target: "West Emergency Doors",
      status: "Executing",
      time: "Just now",
      icon: Unlock,
      tone: "text-emerald-300 bg-emerald-500/15 border-emerald-500/30",
    },
  ]);

  const [feedbackMsg, setFeedbackMsg] = useState("");

  function handleDispatch(actionName, defaultZone, target) {
    const newAction = {
      id: `act-${Date.now()}`,
      action: actionName,
      zone: defaultZone || "Central Concourse",
      target: target || "Zone Operations Team",
      status: "Dispatched",
      time: "Just now",
      icon: Send,
      tone: "text-teal-300 bg-teal-500/15 border-teal-500/30",
    };

    setDispatchedActions((prev) => [newAction, ...prev]);
    setFeedbackMsg(`Directive Dispatched: "${actionName}" to ${newAction.zone}`);
    setTimeout(() => setFeedbackMsg(""), 4500);
  }

  // Filter alerts
  const filteredAlerts = alerts.filter((alert) => {
    if (filterSeverity === "ALL") return true;
    return String(alert.risk || "").toUpperCase() === filterSeverity;
  });

  function exportAlertsCsv() {
    if (!alerts.length) return;
    const header = "ID,Zone Name,Risk Level,Message,Crowd Count,Timestamp\n";
    const rows = alerts
      .map((a) => `"${a.id}","${a.zoneName || "Zone"}","${a.risk || "Low"}","${a.message || ""}","${a.count || 0}","${a.createdAt || new Date().toISOString()}"`)
      .join("\n");
    const blob = new Blob([header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `incident_audit_log_${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  const criticalCount = alerts.filter((a) => a.risk === "Critical").length;
  const highCount = alerts.filter((a) => a.risk === "High").length;
  const mediumCount = alerts.filter((a) => a.risk === "Medium").length;

  return (
    <div className="flex flex-col gap-6">
      {/* Top Incident Hub Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-800 bg-slate-900/90 p-5 shadow-2xl backdrop-blur-2xl">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-red-500/15 text-red-400 border border-red-500/30">
            <Siren className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-white">Incident Command & Automated Emergency Dispatch</h2>
            <p className="text-xs text-slate-300">
              Live automated surge triggers, incident triage, and one-click rapid mitigation protocols.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={exportAlertsCsv}
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-800/90 px-4 py-2 text-xs font-bold text-slate-200 transition hover:border-slate-600 hover:text-white shadow-sm"
          >
            <Download className="h-4 w-4 text-teal-400" />
            Export Log CSV
          </button>
        </div>
      </div>

      {/* Dispatched Notification Toast */}
      {feedbackMsg && (
        <div className="flex items-center gap-2.5 rounded-2xl border border-teal-500/40 bg-teal-950/90 px-5 py-3 text-xs font-extrabold text-teal-200 shadow-2xl backdrop-blur-md animate-pulse">
          <CheckCircle2 className="h-5 w-5 text-teal-400 shrink-0" />
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* Quick Mitigation Action Ribbon */}
      <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl backdrop-blur-2xl">
        <div className="flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-teal-400">Emergency Protocols</span>
            <h3 className="text-base font-extrabold text-white">One-Click Crowd Mitigation Directives</h3>
          </div>
          <span className="text-xs font-semibold text-slate-300">Ready for automated IoT actuation</span>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <button
            onClick={() => handleDispatch("Broadcast Dispersal Voice Guidance", "Zone C: Arena Lower Bowl", "PA System Zone 1-4")}
            type="button"
            className="group flex flex-col items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-5 text-left transition hover:border-teal-500/50 hover:bg-teal-500/10 hover:scale-[1.02] shadow-sm"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/15 text-teal-400 border border-teal-500/30 group-hover:scale-110 transition">
              <Megaphone className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-extrabold text-white">Broadcast Dispersal Audio</p>
              <p className="mt-1 text-[11px] text-slate-300 leading-relaxed">Triggers acoustic guidance in congested sectors</p>
            </div>
          </button>

          <button
            onClick={() => handleDispatch("Throttle Inflow Turnstiles", "Zone A: North Gate Plaza", "Turnstiles A1-A8")}
            type="button"
            className="group flex flex-col items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-5 text-left transition hover:border-amber-500/50 hover:bg-amber-500/10 hover:scale-[1.02] shadow-sm"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15 text-amber-400 border border-amber-500/30 group-hover:scale-110 transition">
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-extrabold text-white">Dynamic Gate Throttling</p>
              <p className="mt-1 text-[11px] text-slate-300 leading-relaxed">Slows entry intake to match egress capacity</p>
            </div>
          </button>

          <button
            onClick={() => handleDispatch("Emergency Auxiliary Egress Release", "Zone B: Central Concourse", "West Emergency Gates")}
            type="button"
            className="group flex flex-col items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-5 text-left transition hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:scale-[1.02] shadow-sm"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 group-hover:scale-110 transition">
              <Unlock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-extrabold text-white">Release Emergency Doors</p>
              <p className="mt-1 text-[11px] text-slate-300 leading-relaxed">Unlocks magnetic safety egress corridors</p>
            </div>
          </button>

          <button
            onClick={() => handleDispatch("Deploy Rapid Response Marshals", "Zone B: Central Concourse", "Unit 3 & 4")}
            type="button"
            className="group flex flex-col items-start gap-3 rounded-2xl border border-slate-800 bg-slate-950/80 p-5 text-left transition hover:border-indigo-500/50 hover:bg-indigo-500/10 hover:scale-[1.02] shadow-sm"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 group-hover:scale-110 transition">
              <UserCheck className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-extrabold text-white">Dispatch Marshals</p>
              <p className="mt-1 text-[11px] text-slate-300 leading-relaxed">Directs physical safety officers to hotspot</p>
            </div>
          </button>
        </div>
      </div>

      {/* Split Incident Feed and Dispatched Directives Table */}
      <div className="grid gap-6 xl:grid-cols-[1.3fr_1fr]">
        {/* Incident Alerts Stream */}
        <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl backdrop-blur-2xl">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Audit Log</span>
              <h3 className="text-base font-extrabold text-white">Surge Incident Timeline</h3>
            </div>

            {/* Severity Filter Tabs */}
            <div className="flex items-center gap-1.5 rounded-xl border border-slate-800 bg-slate-950 p-1 text-xs">
              <button
                onClick={() => setFilterSeverity("ALL")}
                type="button"
                className={`rounded-lg px-3 py-1 font-bold transition ${
                  filterSeverity === "ALL" ? "bg-slate-800 text-white" : "text-slate-400 hover:text-white"
                }`}
              >
                All ({alerts.length})
              </button>
              <button
                onClick={() => setFilterSeverity("CRITICAL")}
                type="button"
                className={`rounded-lg px-3 py-1 font-bold transition ${
                  filterSeverity === "CRITICAL" ? "bg-red-500/20 text-red-300 border border-red-500/40" : "text-red-400 hover:text-red-300"
                }`}
              >
                Critical ({criticalCount})
              </button>
              <button
                onClick={() => setFilterSeverity("HIGH")}
                type="button"
                className={`rounded-lg px-3 py-1 font-bold transition ${
                  filterSeverity === "HIGH" ? "bg-orange-500/20 text-orange-300 border border-orange-500/40" : "text-orange-400 hover:text-orange-300"
                }`}
              >
                High ({highCount})
              </button>
            </div>
          </div>

          {/* Alert Stream Items */}
          <div className="mt-4 max-h-[28rem] space-y-3 overflow-y-auto pr-1">
            {filteredAlerts.length > 0 ? (
              filteredAlerts.map((alert, index) => {
                const matchedCam = cameras.find((c) => c.zoneName === alert.zoneName || c.name === alert.zoneName);

                return (
                  <article
                    key={alert.id || index}
                    className="flex items-start justify-between gap-3.5 rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-sm transition hover:border-slate-700"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border ${
                          alert.risk === "Critical"
                            ? "bg-red-500/20 text-red-400 border-red-500/40 animate-pulse"
                            : alert.risk === "High"
                            ? "bg-orange-500/20 text-orange-400 border-orange-500/40"
                            : "bg-amber-500/20 text-amber-400 border-amber-500/40"
                        }`}
                      >
                        <AlertOctagon className="h-5 w-5" />
                      </div>
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-extrabold text-white">{alert.zoneName || "Venue Sector"}</span>
                          <span className={riskClass(alert.risk)}>{alert.risk}</span>
                        </div>
                        <p className="text-xs text-slate-300 leading-relaxed">{alert.message}</p>
                        <p className="text-[10px] text-slate-400">
                          {alert.createdAt ? new Date(alert.createdAt).toLocaleTimeString() : "Just now"} • {alert.count || 0} heads detected
                        </p>
                      </div>
                    </div>

                    {matchedCam && onInspectCamera && (
                      <button
                        onClick={() => onInspectCamera(matchedCam)}
                        type="button"
                        className="rounded-xl border border-slate-800 bg-slate-900 px-3 py-1.5 text-[11px] font-bold text-teal-400 transition hover:border-teal-500/40 hover:text-teal-300 shrink-0"
                      >
                        View Feed
                      </button>
                    )}
                  </article>
                );
              })
            ) : (
              <div className="py-12 text-center text-xs text-slate-400">
                <CheckCircle2 className="mx-auto h-8 w-8 text-emerald-400/70 mb-2" />
                <p className="font-bold text-white">No Incidents Recorded</p>
                <p className="text-slate-400 mt-0.5">All monitored surveillance zones operating within nominal safety thresholds.</p>
              </div>
            )}
          </div>
        </div>

        {/* Dispatched Mitigation Directives Ledger */}
        <div className="rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl backdrop-blur-2xl">
          <div className="border-b border-slate-800 pb-4">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Active Directives</span>
            <h3 className="text-base font-extrabold text-white">Dispatched Mitigation Log</h3>
          </div>

          <div className="mt-4 space-y-3">
            {dispatchedActions.map((act) => {
              const Icon = act.icon;
              return (
                <div
                  key={act.id}
                  className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/80 p-4 shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className={`flex h-9 w-9 items-center justify-center rounded-xl border ${act.tone}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-white">{act.action}</p>
                      <p className="text-[11px] text-slate-300">
                        {act.zone} • {act.target}
                      </p>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="inline-flex rounded-md border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                      {act.status}
                    </span>
                    <p className="mt-1 text-[10px] text-slate-400">{act.time}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
