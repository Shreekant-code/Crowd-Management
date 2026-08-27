/**
 * Dynamic User-Constructed Evacuation Graph Engine
 * 
 * Concept:
 * 1. Initial State: 1 Entry Node and 1 Exit Node connected with baseline distance.
 * 2. Camera Nodes: Whenever a user adds a camera, a node is appended in between.
 * 3. Dynamic Edges: User can manually link any node to any other node and assign distance D (meters).
 * 4. Real-Time Telemetry: Live AI stream metrics calculate congestion penalty:
 *    W_dynamic = D * (1 + 5 * (count / capacity))
 * 5. Dynamic Dijkstra: Recalculates the optimal egress path in real time avoiding congested cameras.
 */

export const INITIAL_ENTRY_NODE = {
  id: "NODE_ENTRY",
  label: "Main Entry Gate",
  type: "entry",
  capacity: 300,
};

export const INITIAL_EXIT_NODE = {
  id: "NODE_EXIT",
  label: "Emergency Exit Portal",
  type: "exit",
  capacity: 300,
};

/**
 * Builds dynamic graph nodes & default edges based on the user's active cameras
 */
export function buildDynamicTopologyFromCameras(cameras = [], savedEdges = null) {
  const nodes = [
    { ...INITIAL_ENTRY_NODE, x: 120, y: 280 },
  ];

  // Map each user camera to an intermediate graph node
  const cameraNodes = cameras.map((cam, idx) => {
    const totalCams = Math.max(cameras.length, 1);
    // Dynamically layout nodes between x=300 and x=750
    const colSpacing = 480 / Math.max(totalCams, 1);
    const col = idx % 3;
    const row = Math.floor(idx / 3);
    const x = 320 + col * 200;
    const y = 160 + (idx % 2 === 0 ? -40 : 80) + row * 160;

    return {
      id: cam.id,
      cameraId: cam.id,
      label: cam.zoneName || cam.name || `Zone ${idx + 1}`,
      type: "camera",
      capacity: 50,
      x: Math.min(x, 780),
      y: Math.min(Math.max(y, 100), 460),
    };
  });

  nodes.push(...cameraNodes);
  nodes.push({ ...INITIAL_EXIT_NODE, x: 900, y: 280 });

  let edges = [];

  if (Array.isArray(savedEdges) && savedEdges.length > 0) {
    // Filter saved edges to ensure nodes still exist
    const nodeIds = new Set(nodes.map((n) => n.id));
    edges = savedEdges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
  }

  // If no saved edges or edges are empty, construct clean default pipeline
  if (!edges.length) {
    if (cameraNodes.length === 0) {
      // 0 Cameras: Direct connection Entry -> Exit
      edges.push({
        from: "NODE_ENTRY",
        to: "NODE_EXIT",
        distance: 50,
        capacity: 150,
      });
    } else {
      // Connect Entry -> First Camera
      edges.push({
        from: "NODE_ENTRY",
        to: cameraNodes[0].id,
        distance: 35,
        capacity: 100,
      });

      // Connect Intermediate Cameras sequentially
      for (let i = 0; i < cameraNodes.length - 1; i++) {
        edges.push({
          from: cameraNodes[i].id,
          to: cameraNodes[i + 1].id,
          distance: 40,
          capacity: 80,
        });
      }

      // Connect Last Camera -> Exit
      edges.push({
        from: cameraNodes[cameraNodes.length - 1].id,
        to: "NODE_EXIT",
        distance: 30,
        capacity: 150,
      });

      // If more than 1 camera, add alternate egress from intermediate cameras to Exit
      if (cameraNodes.length > 1) {
        edges.push({
          from: cameraNodes[0].id,
          to: "NODE_EXIT",
          distance: 75,
          capacity: 100,
        });
      }
    }
  }

  return { nodes, edges };
}

export class DynamicEvacuationEngine {
  constructor(topology, alpha = 5.0) {
    this.alpha = alpha;
    this.nodesMap = new Map();
    this.edgesMap = new Map();
    this.adjacency = new Map();
    this.topology = topology || { nodes: [], edges: [] };

    this._init();
  }

  _init() {
    this.nodesMap.clear();
    this.edgesMap.clear();
    this.adjacency.clear();

    this.topology.nodes.forEach((n) => {
      this.nodesMap.set(n.id, { ...n });
      this.adjacency.set(n.id, []);
    });

    this.topology.edges.forEach((e) => {
      const key = `${e.from}->${e.to}`;
      const edgeData = {
        ...e,
        base_distance: Number(e.distance) || 40,
        current_count: 0,
        density: 0.0,
        weight: Number(e.distance) || 40,
        status: "normal",
      };
      this.edgesMap.set(key, edgeData);
      if (this.adjacency.has(e.from)) {
        this.adjacency.get(e.from).push(e.to);
      }
    });
  }

  /**
   * Translates real-time AI crowd telemetry from camera streams into dynamic edge weights:
   * W_dynamic = D * (1 + alpha * rho)
   */
  updateTelemetry(cameraMetricsMap = {}) {
    this.edgesMap.forEach((edge, key) => {
      const { from, to, distance, capacity = 50 } = edge;

      // Extract real-time count for connected nodes
      let count = 0;
      if (cameraMetricsMap[from] != null) {
        count = Number(cameraMetricsMap[from]?.current_count ?? cameraMetricsMap[from]?.count ?? cameraMetricsMap[from] ?? 0);
      } else if (cameraMetricsMap[to] != null) {
        count = Number(cameraMetricsMap[to]?.current_count ?? cameraMetricsMap[to]?.count ?? cameraMetricsMap[to] ?? 0);
      }

      const rho = count / Math.max(capacity, 1);

      // Dynamic Congestion Penalty: W_dynamic = D * (1 + alpha * rho)
      let penalty = 1.0 + this.alpha * rho;
      let status = "normal";

      if (rho >= 1.0) {
        penalty += 3.0 * Math.pow(rho - 1.0, 2);
        status = "critical";
      } else if (rho >= 0.75) {
        status = "congested";
      } else if (rho >= 0.40) {
        status = "moderate";
      }

      edge.current_count = count;
      edge.density = Number(rho.toFixed(2));
      edge.weight = Number((distance * penalty).toFixed(1));
      edge.status = status;
    });
  }

  /**
   * Computes dynamic Dijkstra Shortest Path from source to target
   */
  findShortestPath(source = "NODE_ENTRY", target = "NODE_EXIT") {
    if (!this.nodesMap.has(source) || !this.nodesMap.has(target)) {
      return null;
    }

    const distances = new Map();
    const previous = new Map();
    const unvisited = new Set();

    this.nodesMap.forEach((_, id) => {
      distances.set(id, Infinity);
      unvisited.add(id);
    });

    distances.set(source, 0);

    while (unvisited.size > 0) {
      let current = null;
      let minDist = Infinity;

      unvisited.forEach((nodeId) => {
        const d = distances.get(nodeId);
        if (d < minDist) {
          minDist = d;
          current = nodeId;
        }
      });

      if (current === null || minDist === Infinity) break;
      if (current === target) break;

      unvisited.delete(current);

      const neighbors = this.adjacency.get(current) || [];
      neighbors.forEach((neighbor) => {
        if (!unvisited.has(neighbor)) return;

        const edgeKey = `${current}->${neighbor}`;
        const edge = this.edgesMap.get(edgeKey);
        const weight = edge ? edge.weight : 50;

        const alt = distances.get(current) + weight;
        if (alt < distances.get(neighbor)) {
          distances.set(neighbor, alt);
          previous.set(neighbor, current);
        }
      });
    }

    if (distances.get(target) === Infinity) {
      return null;
    }

    // Reconstruct path
    const path = [];
    let curr = target;
    while (curr) {
      path.unshift(curr);
      curr = previous.get(curr);
    }

    // Calculate static distance
    let staticDist = 0;
    for (let i = 0; i < path.length - 1; i++) {
      const edge = this.edgesMap.get(`${path[i]}->${path[i + 1]}`);
      if (edge) staticDist += edge.distance;
    }

    const dynamicCost = Number(distances.get(target).toFixed(1));
    const overhead = Number((((dynamicCost - staticDist) / Math.max(staticDist, 1)) * 100).toFixed(1));

    return {
      source,
      target,
      path,
      dynamic_cost: dynamicCost,
      static_distance_meters: staticDist,
      congestion_overhead_pct: Math.max(0, overhead),
      steps: this._formatSteps(path),
    };
  }

  _formatSteps(path = []) {
    const steps = [];
    for (let i = 0; i < path.length - 1; i++) {
      const u = path[i];
      const v = path[i + 1];
      const edge = this.edgesMap.get(`${u}->${v}`) || {};
      const uNode = this.nodesMap.get(u) || { label: u };
      const vNode = this.nodesMap.get(v) || { label: v };

      steps.push({
        from_id: u,
        from_label: uNode.label,
        to_id: v,
        to_label: vNode.label,
        distance: edge.distance || 40,
        density: edge.density || 0.0,
        weight: edge.weight || 40,
        status: edge.status || "normal",
      });
    }
    return steps;
  }
}
