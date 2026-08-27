"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BrainCircuit,
  Compass,
  CornerDownRight,
  Cpu,
  Layers,
  MapPin,
  Maximize2,
  Navigation,
  Network,
  Plus,
  Radio,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
  Zap,
} from "lucide-react";
import {
  buildDynamicTopologyFromCameras,
  DynamicEvacuationEngine,
  INITIAL_ENTRY_NODE,
  INITIAL_EXIT_NODE,
} from "@/lib/evacuation-graph";
import { riskClass } from "@/lib/risk";

const STORAGE_KEY = "crowdsafe_custom_graph_edges";

export function VenueMap({ cameras = [], global = {}, onInspectCamera }) {
  const [savedEdges, setSavedEdges] = useState(null);
  const [selectedOrigin, setSelectedOrigin] = useState("NODE_ENTRY");
  const [newEdgeFrom, setNewEdgeFrom] = useState("NODE_ENTRY");
  const [newEdgeTo, setNewEdgeTo] = useState("NODE_EXIT");
  const [newEdgeDistance, setNewEdgeDistance] = useState("40");
  const [edgeFeedback, setEdgeFeedback] = useState("");

  // Load custom edges from localStorage on mount
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        setSavedEdges(JSON.parse(stored));
      }
    } catch (_err) {
      console.warn("Could not load stored graph edges", _err);
    }
  }, []);

  // Save edges to localStorage
  function persistEdges(edges) {
    setSavedEdges(edges);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(edges));
    } catch (_err) {
      console.warn("Could not save graph edges", _err);
    }
  }

  // Construct dynamic graph topology based on active cameras & user edges
  const topology = useMemo(() => {
    return buildDynamicTopologyFromCameras(cameras, savedEdges);
  }, [cameras, savedEdges]);

  // Extract live AI stream telemetry per camera node
  const cameraMetricsMap = useMemo(() => {
    const map = {};
    cameras.forEach((cam) => {
      const count = Number(
        cam.metrics?.current_count ??
        cam.metrics?.count ??
        cam.metrics?.people_count ??
        cam.metrics?.sparse_count ??
        cam.metrics?.raw_count ??
        0
      );
      map[cam.id] = {
        current_count: count,
        risk: cam.metrics?.risk || "Low",
        dominant_regime: cam.metrics?.dominant_regime || "SPARSE",
      };
    });
    return map;
  }, [cameras]);

  // Initialize Dynamic Evacuation Engine with live telemetry
  const engine = useMemo(() => {
    const eng = new DynamicEvacuationEngine(topology, 5.0);
    eng.updateTelemetry(cameraMetricsMap);
    return eng;
  }, [topology, cameraMetricsMap]);

  // Compute live Dijkstra Shortest Path
  const routeResult = useMemo(() => {
    return engine.findShortestPath(selectedOrigin, "NODE_EXIT");
  }, [engine, selectedOrigin]);

  const activePathEdges = new Set();
  const pathNodeSet = new Set(routeResult?.path || []);
  if (routeResult?.path) {
    for (let i = 0; i < routeResult.path.length - 1; i++) {
      activePathEdges.add(`${routeResult.path[i]}->${routeResult.path[i + 1]}`);
    }
  }

  // Add a new custom edge between any two nodes
  function handleAddEdge(e) {
    e.preventDefault();
    if (!newEdgeFrom || !newEdgeTo || newEdgeFrom === newEdgeTo) {
      setEdgeFeedback("Please select two distinct nodes.");
      setTimeout(() => setEdgeFeedback(""), 3000);
      return;
    }

    const dist = Math.max(5, parseInt(newEdgeDistance, 10) || 40);
    const existing = topology.edges.filter(
      (edge) => !(edge.from === newEdgeFrom && edge.to === newEdgeTo)
    );

    const updatedEdges = [
      ...existing,
      {
        from: newEdgeFrom,
        to: newEdgeTo,
        distance: dist,
        capacity: 80,
      },
    ];

    persistEdges(updatedEdges);
    setEdgeFeedback(`Connected ${engine.nodesMap.get(newEdgeFrom)?.label || newEdgeFrom} → ${engine.nodesMap.get(newEdgeTo)?.label || newEdgeTo} (${dist}m)`);
    setTimeout(() => setEdgeFeedback(""), 4000);
  }

  // Remove a custom edge
  function handleRemoveEdge(from, to) {
    const updatedEdges = topology.edges.filter(
      (edge) => !(edge.from === from && edge.to === to)
    );
    persistEdges(updatedEdges);
  }

  // Reset to default auto-generated pipeline
  function handleResetEdges() {
    localStorage.removeItem(STORAGE_KEY);
    setSavedEdges(null);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-800 bg-slate-900/90 p-5 shadow-2xl backdrop-blur-2xl">
        <div className="flex items-center gap-3.5">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-teal-500/15 text-teal-400 border border-teal-500/30">
            <Network className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-white">
              Dynamic Evacuation Map Builder & Live Congestion HUD
            </h2>
            <p className="text-xs text-slate-300">
              Graph dynamically connects your camera zones. Live AI head counts compute dynamic weights: <code className="text-teal-400 font-bold">W = D * (1 + 5*ρ)</code>.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleResetEdges}
            type="button"
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 px-3.5 py-2 text-xs font-bold text-slate-300 transition hover:border-slate-600 hover:text-white"
            title="Reset to default camera pipeline"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset Layout
          </button>
        </div>
      </div>

      {/* Main Grid: SVG Visualizer & Edge Management Studio */}
      <div className="grid gap-6 xl:grid-cols-[1.25fr_1fr]">
        {/* Interactive 2D Graph Visualizer Canvas */}
        <div className="relative flex flex-col justify-between overflow-hidden rounded-3xl border border-slate-800 bg-slate-950 p-5 shadow-2xl">
          {/* Spatial Grid Background */}
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(6,182,212,0.08),transparent_60%)]" />

          {/* Top Canvas Badges */}
          <div className="relative z-10 flex flex-wrap items-center justify-between gap-2 border-b border-slate-800/80 pb-3">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full bg-teal-400 animate-ping" />
              <span className="text-xs font-extrabold text-white">
                Live Dynamic Topology ({topology.nodes.length} Nodes • {topology.edges.length} Corridors)
              </span>
            </div>

            {routeResult && (
              <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-xs font-bold text-emerald-300 shadow-sm">
                <Navigation className="h-3.5 w-3.5" />
                Dijkstra Egress: {routeResult.static_distance_meters}m baseline ➔ {routeResult.dynamic_cost}m dynamic
              </div>
            )}
          </div>

          {/* SVG Canvas */}
          <div className="relative my-4 flex items-center justify-center">
            <svg
              viewBox="0 0 1020 540"
              className="h-auto w-full select-none"
              style={{ minHeight: "420px" }}
            >
              <defs>
                <marker
                  id="arrow-norm"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#64748b" />
                </marker>
                <marker
                  id="arrow-active"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#10b981" />
                </marker>
                <marker
                  id="arrow-danger"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 1 L 10 5 L 0 9 z" fill="#ef4444" />
                </marker>
              </defs>

              {/* Boundary Frame */}
              <rect
                x="40"
                y="30"
                width="940"
                height="480"
                rx="28"
                fill="none"
                stroke="#1e293b"
                strokeWidth="2"
                strokeDasharray="6 6"
              />

              {/* Render Graph Edges (Corridors) */}
              {topology.edges.map((edge) => {
                const edgeKey = `${edge.from}->${edge.to}`;
                const u = engine.nodesMap.get(edge.from);
                const v = engine.nodesMap.get(edge.to);
                if (!u || !v) return null;

                const edgeData = engine.edgesMap.get(edgeKey) || edge;
                const isActive = activePathEdges.has(edgeKey);
                const isCritical = edgeData.density >= 0.75;
                const isModerate = edgeData.density >= 0.40;

                const midX = (u.x + v.x) / 2;
                const midY = (u.y + v.y) / 2;

                let strokeColor = "#475569";
                let markerId = "arrow-norm";
                let strokeWidth = 2.5;

                if (isActive) {
                  strokeColor = "#10b981";
                  markerId = "arrow-active";
                  strokeWidth = 5.5;
                } else if (isCritical) {
                  strokeColor = "#ef4444";
                  markerId = "arrow-danger";
                  strokeWidth = 4;
                } else if (isModerate) {
                  strokeColor = "#f59e0b";
                  strokeWidth = 3;
                }

                return (
                  <g key={edgeKey} className="transition-all duration-300">
                    <line
                      x1={u.x}
                      y1={u.y}
                      x2={v.x}
                      y2={v.y}
                      stroke={strokeColor}
                      strokeWidth={strokeWidth}
                      strokeDasharray={isActive ? "8 6" : "none"}
                      markerEnd={`url(#${markerId})`}
                      className={isActive ? "animate-pulse" : ""}
                    />

                    {/* Edge Weight Chip */}
                    <g transform={`translate(${midX - 32}, ${midY - 13})`}>
                      <rect
                        x="0"
                        y="0"
                        width="64"
                        height="24"
                        rx="6"
                        fill={
                          isCritical
                            ? "rgba(239, 68, 68, 0.95)"
                            : isModerate
                            ? "rgba(245, 158, 11, 0.95)"
                            : isActive
                            ? "rgba(16, 185, 129, 0.95)"
                            : "rgba(15, 23, 42, 0.9)"
                        }
                        stroke={isActive ? "#34d399" : "rgba(255, 255, 255, 0.25)"}
                      />
                      <text
                        x="32"
                        y="15"
                        fill="#ffffff"
                        fontSize="10"
                        fontWeight="bold"
                        textAnchor="middle"
                      >
                        {Math.round(edgeData.weight || edge.distance)}m {edgeData.density > 0 ? `(ρ=${edgeData.density})` : ""}
                      </text>
                    </g>
                  </g>
                );
              })}

              {/* Render Graph Nodes */}
              {topology.nodes.map((node) => {
                const isEntry = node.type === "entry";
                const isExit = node.type === "exit";
                const isCamera = node.type === "camera";
                const isSelected = selectedOrigin === node.id;
                const isInPath = pathNodeSet.has(node.id);

                const liveCount = isCamera
                  ? cameraMetricsMap[node.id]?.current_count ?? 0
                  : null;

                let fill = "#0f172a";
                let stroke = "#38bdf8";

                if (isEntry) {
                  fill = isSelected ? "#0284c7" : "#0369a1";
                  stroke = "#38bdf8";
                } else if (isExit) {
                  fill = "#065f46";
                  stroke = "#34d399";
                } else if (isCamera) {
                  fill = isInPath ? "#134e4a" : "#1e293b";
                  stroke = isInPath ? "#2dd4bf" : "#64748b";
                }

                return (
                  <g
                    key={node.id}
                    transform={`translate(${node.x}, ${node.y})`}
                    className="cursor-pointer transition-all duration-300"
                    onClick={() => {
                      if (!isExit) {
                        setSelectedOrigin(node.id);
                      }
                    }}
                  >
                    {/* Pulsing Aura if on Active Egress Route */}
                    {isInPath && (
                      <circle
                        cx="0"
                        cy="0"
                        r={isExit || isEntry ? 34 : 26}
                        fill={isExit ? "rgba(16, 185, 129, 0.3)" : "rgba(6, 182, 212, 0.25)"}
                        className="animate-ping"
                      />
                    )}

                    {/* Node Shape */}
                    {isExit || isEntry ? (
                      <rect
                        x="-48"
                        y="-20"
                        width="96"
                        height="40"
                        rx="12"
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={isSelected ? 3.5 : 2}
                      />
                    ) : (
                      <circle
                        cx="0"
                        cy="0"
                        r="20"
                        fill={fill}
                        stroke={stroke}
                        strokeWidth={isSelected ? 3.5 : 2}
                      />
                    )}

                    {/* Node Header Text */}
                    <text
                      x="0"
                      y={isExit || isEntry ? 5 : 5}
                      fill="#ffffff"
                      fontSize="11"
                      fontWeight="bold"
                      textAnchor="middle"
                    >
                      {isEntry ? "ENTRY" : isExit ? "EXIT" : `CAM`}
                    </text>

                    {/* Node Label Below */}
                    <text
                      x="0"
                      y={isExit || isEntry ? 36 : 34}
                      fill="#ffffff"
                      fontSize="11"
                      fontWeight="bold"
                      textAnchor="middle"
                      className="select-none"
                    >
                      {node.label}
                    </text>

                    {/* Live Head Count Pill for Camera Nodes */}
                    {isCamera && liveCount !== null && (
                      <text
                        x="0"
                        y="-26"
                        fill="#2dd4bf"
                        fontSize="10"
                        fontWeight="bold"
                        textAnchor="middle"
                      >
                        {liveCount} heads
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>

          {/* Optimal Shortest Egress Path Card */}
          {routeResult && (
            <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/40 p-4 space-y-2 shadow-inner">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                  Computed Safest Evacuation Path
                </span>
                <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                  {routeResult.path?.length - 1} Corridors
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-1.5 text-xs font-bold text-white">
                {routeResult.path?.map((nodeId, idx) => (
                  <span key={nodeId} className="inline-flex items-center gap-1">
                    <span className="rounded-lg border border-slate-700 bg-slate-950 px-2.5 py-1 text-slate-200">
                      {engine.nodesMap.get(nodeId)?.label || nodeId}
                    </span>
                    {idx < routeResult.path.length - 1 && (
                      <ArrowRight className="h-4 w-4 text-emerald-400" />
                    )}
                  </span>
                ))}
              </div>

              <div className="mt-2 grid grid-cols-3 gap-2 border-t border-slate-800/80 pt-2 text-center text-xs">
                <div>
                  <span className="text-[10px] text-slate-400">Baseline Distance</span>
                  <p className="font-extrabold text-white text-sm">{routeResult.static_distance_meters}m</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400">Dynamic Cost (W)</span>
                  <p className="font-extrabold text-emerald-400 text-sm">{routeResult.dynamic_cost}m</p>
                </div>
                <div>
                  <span className="text-[10px] text-slate-400">Congestion Overhead</span>
                  <p className="font-extrabold text-amber-400 text-sm">+{routeResult.congestion_overhead_pct}%</p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Simple Corridor / Edge Management Studio */}
        <div className="flex flex-col justify-between space-y-5 rounded-3xl border border-slate-800 bg-slate-900/90 p-6 shadow-2xl backdrop-blur-2xl">
          <div className="space-y-4">
            {/* Panel Title */}
            <div className="border-b border-slate-800 pb-3">
              <span className="text-[11px] font-bold uppercase tracking-wider text-teal-400">
                Corridor Linker
              </span>
              <h3 className="text-base font-extrabold text-white">Connect Nodes & Assign Distance</h3>
              <p className="text-xs text-slate-300 mt-1">
                Link entry, cameras, and exit to customize walkable passageways in your venue.
              </p>
            </div>

            {/* Notification Toast */}
            {edgeFeedback && (
              <div className="rounded-xl border border-teal-500/40 bg-teal-950/80 px-4 py-2 text-xs font-bold text-teal-200 animate-pulse">
                {edgeFeedback}
              </div>
            )}

            {/* Quick Add Corridor Form */}
            <form onSubmit={handleAddEdge} className="rounded-2xl border border-slate-800 bg-slate-950/80 p-4 space-y-3 shadow-inner">
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">From Node</span>
                  <select
                    value={newEdgeFrom}
                    onChange={(e) => setNewEdgeFrom(e.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-bold text-white outline-none focus:border-teal-400"
                  >
                    {topology.nodes.map((n) => (
                      <option key={`from-${n.id}`} value={n.id}>
                        {n.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">To Node</span>
                  <select
                    value={newEdgeTo}
                    onChange={(e) => setNewEdgeTo(e.target.value)}
                    className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-bold text-white outline-none focus:border-teal-400"
                  >
                    {topology.nodes.map((n) => (
                      <option key={`to-${n.id}`} value={n.id}>
                        {n.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="flex items-center gap-3">
                <label className="block flex-1 space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">Distance (meters)</span>
                  <input
                    type="number"
                    min="5"
                    max="500"
                    value={newEdgeDistance}
                    onChange={(e) => setNewEdgeDistance(e.target.value)}
                    placeholder="e.g. 40"
                    className="w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2 text-xs font-bold text-white outline-none focus:border-teal-400"
                  />
                </label>

                <button
                  type="submit"
                  className="inline-flex items-center gap-1.5 self-end rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 text-white font-extrabold px-5 py-2.5 text-xs shadow-md shadow-teal-500/25 transition cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  Add Corridor
                </button>
              </div>
            </form>

            {/* Active Corridors Table */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                  Active Corridor Matrix ({topology.edges.length})
                </span>
                <span className="text-[10px] text-teal-400 font-semibold">Live AI Telemetry</span>
              </div>

              <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                {topology.edges.map((edge) => {
                  const edgeKey = `${edge.from}->${edge.to}`;
                  const edgeData = engine.edgesMap.get(edgeKey) || edge;
                  const fromNode = engine.nodesMap.get(edge.from);
                  const toNode = engine.nodesMap.get(edge.to);

                  return (
                    <div
                      key={edgeKey}
                      className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/80 px-3.5 py-2 text-xs shadow-sm transition hover:border-slate-700"
                    >
                      <div className="space-y-0.5">
                        <div className="flex items-center gap-1.5 font-bold text-white">
                          <span>{fromNode?.label || edge.from}</span>
                          <ArrowRight className="h-3 w-3 text-teal-400" />
                          <span>{toNode?.label || edge.to}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-slate-400">
                          <span>Distance: <strong className="text-slate-200">{edge.distance}m</strong></span>
                          <span>•</span>
                          <span>Dynamic Cost: <strong className="text-teal-400">{edgeData.weight}m</strong></span>
                          {edgeData.density > 0 && (
                            <span className="text-amber-400 font-semibold">(ρ={edgeData.density})</span>
                          )}
                        </div>
                      </div>

                      <button
                        onClick={() => handleRemoveEdge(edge.from, edge.to)}
                        type="button"
                        className="rounded-lg p-1.5 text-slate-500 transition hover:bg-red-500/10 hover:text-red-400"
                        title="Remove Corridor"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
