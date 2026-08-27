"""
Graph-Based Dynamic Evacuation & Routing Engine
Implements:
1. Physical Architectural Graph Topology (Nodes V, Edges E with static distance & capacity).
2. Real-time Dynamic Congestion Penalty Mathematics: W_dynamic = D * (1 + alpha * rho).
3. Dynamic Dijkstra Congestion-Aware Shortest Path Routing (NetworkX).
4. Minimum-Cost Maximum-Flow (MCMF) Multi-Exit Network Evacuation Solver.
"""

from typing import Any, Dict, List, Optional, Tuple
import networkx as nx


class EvacuationEngine:
    def __init__(self, alpha: float = 5.0):
        self.alpha = alpha
        self.graph = nx.DiGraph()
        self.exits = [
            "Exit_North_Main",
            "Exit_West_A",
            "Exit_West_B",
            "Exit_East_Fire",
            "Exit_South_Transit",
        ]
        self.zones = [
            "Zone_NorthGate",
            "Concourse_A",
            "Concourse_B",
            "Arena_Bowl",
            "Food_Promenade",
            "Transit_Hub",
        ]
        self._build_topology()

    def _build_topology(self) -> None:
        """Construct the physical architectural graph topology."""
        self.graph.clear()

        # Nodes with spatial coordinates and metadata
        nodes_metadata = {
            # Decision Points & Gathering Zones
            "Zone_NorthGate": {"label": "North Gate Plaza", "type": "entry", "capacity": 200, "x": 280, "y": 120},
            "Concourse_A": {"label": "North Concourse Corridor", "type": "corridor", "capacity": 250, "x": 380, "y": 180},
            "Concourse_B": {"label": "Central Grand Atrium", "type": "hub", "capacity": 350, "x": 570, "y": 210},
            "Arena_Bowl": {"label": "Main Arena Lower Bowl", "type": "gathering", "capacity": 400, "x": 290, "y": 360},
            "Food_Promenade": {"label": "East Food & Retail Hall", "type": "retail", "capacity": 250, "x": 820, "y": 250},
            "Transit_Hub": {"label": "South Concourse Hub", "type": "exit_hub", "capacity": 500, "x": 570, "y": 420},
            # Emergency Exits (Sinks)
            "Exit_North_Main": {"label": "North Main Exit", "type": "exit", "capacity": 300, "x": 280, "y": 40},
            "Exit_West_A": {"label": "West Egress Door A", "type": "exit", "capacity": 200, "x": 80, "y": 180},
            "Exit_West_B": {"label": "West Egress Door B", "type": "exit", "capacity": 250, "x": 80, "y": 380},
            "Exit_East_Fire": {"label": "East Fire Escape Gate", "type": "exit", "capacity": 200, "x": 950, "y": 250},
            "Exit_South_Transit": {"label": "South Metro Station Portal", "type": "exit", "capacity": 600, "x": 570, "y": 510},
        }

        for node, meta in nodes_metadata.items():
            self.graph.add_node(node, **meta)

        # Edges (Walkable paths) with static physical distance (meters) and capacity (people/min)
        edges = [
            # Zone North Gate connections
            ("Zone_NorthGate", "Exit_North_Main", 35, 200),
            ("Zone_NorthGate", "Exit_West_A", 65, 150),
            ("Zone_NorthGate", "Concourse_A", 45, 250),
            ("Concourse_A", "Zone_NorthGate", 45, 250),

            # Concourse A connections
            ("Concourse_A", "Exit_West_A", 40, 180),
            ("Concourse_A", "Concourse_B", 55, 300),
            ("Concourse_B", "Concourse_A", 55, 300),
            ("Concourse_A", "Arena_Bowl", 60, 200),
            ("Arena_Bowl", "Concourse_A", 60, 200),

            # Arena Bowl connections
            ("Arena_Bowl", "Exit_West_B", 45, 250),
            ("Arena_Bowl", "Transit_Hub", 70, 250),
            ("Arena_Bowl", "Concourse_B", 65, 200),

            # Concourse B (Central Atrium) connections
            ("Concourse_B", "Food_Promenade", 50, 250),
            ("Food_Promenade", "Concourse_B", 50, 250),
            ("Concourse_B", "Transit_Hub", 60, 350),
            ("Transit_Hub", "Concourse_B", 60, 350),

            # Food Promenade connections
            ("Food_Promenade", "Exit_East_Fire", 35, 180),
            ("Food_Promenade", "Transit_Hub", 75, 200),

            # Transit Hub connections
            ("Transit_Hub", "Exit_South_Transit", 30, 500),
            ("Transit_Hub", "Exit_West_B", 85, 200),
        ]

        for u, v, dist, cap in edges:
            self.graph.add_edge(
                u,
                v,
                distance=dist,
                capacity=cap,
                base_distance=dist,
                current_count=0,
                density=0.0,
                weight=float(dist),
                status="normal",
            )

    def update_telemetry_weights(self, telemetry_data: Optional[Dict[str, Any]] = None) -> None:
        """
        Updates dynamic edge weights according to the congestion penalty formula:
        W_dynamic = D * (1 + alpha * rho)
        """
        if not telemetry_data:
            # Reset weights to static baseline distances
            for u, v in self.graph.edges():
                dist = self.graph.edges[u, v]["distance"]
                self.graph.edges[u, v]["weight"] = float(dist)
                self.graph.edges[u, v]["density"] = 0.0
                self.graph.edges[u, v]["current_count"] = 0
                self.graph.edges[u, v]["status"] = "normal"
            return

        # Map camera zone counts to graph corridors
        for u, v, data in self.graph.edges(data=True):
            capacity = max(data.get("capacity", 150), 1)
            dist = data.get("distance", 50)

            # Match telemetry data by edge tuple string "u->v" or node label
            edge_key = f"{u}->{v}"
            edge_telemetry = telemetry_data.get(edge_key) or telemetry_data.get(u) or telemetry_data.get(v) or {}

            count = 0
            if isinstance(edge_telemetry, (int, float)):
                count = float(edge_telemetry)
            elif isinstance(edge_telemetry, dict):
                count = float(
                    edge_telemetry.get("current_count")
                    or edge_telemetry.get("count")
                    or edge_telemetry.get("people_count")
                    or 0
                )

            density = count / capacity

            # Congestion penalty: W_dynamic = D * (1 + alpha * rho)
            # Add exponential ramp if overcrowded (rho > 1.0)
            if density > 1.0:
                penalty_factor = 1.0 + (self.alpha * density) + (2.5 * (density - 1.0) ** 2)
                status = "critical"
            elif density > 0.75:
                penalty_factor = 1.0 + (self.alpha * density)
                status = "congested"
            elif density > 0.40:
                penalty_factor = 1.0 + (self.alpha * density * 0.8)
                status = "moderate"
            else:
                penalty_factor = 1.0 + (self.alpha * density * 0.4)
                status = "normal"

            dynamic_weight = float(dist * penalty_factor)

            self.graph.edges[u, v]["current_count"] = count
            self.graph.edges[u, v]["density"] = round(density, 3)
            self.graph.edges[u, v]["weight"] = round(dynamic_weight, 2)
            self.graph.edges[u, v]["status"] = status

    def calculate_evacuation_route(
        self,
        source: str,
        target_exit: Optional[str] = None,
        telemetry_data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Calculates optimal evacuation path using Congestion-Aware Dynamic Dijkstra.
        """
        if source not in self.graph:
            source = "Concourse_B"

        self.update_telemetry_weights(telemetry_data)

        # If specific exit is requested
        if target_exit and target_exit in self.graph:
            try:
                path = nx.shortest_path(self.graph, source=source, target=target_exit, weight="weight")
                cost = nx.shortest_path_length(self.graph, source=source, target=target_exit, weight="weight")
                static_distance = nx.shortest_path_length(self.graph, source=source, target=target_exit, weight="distance")
                return {
                    "source": source,
                    "target_exit": target_exit,
                    "path": path,
                    "dynamic_cost": round(cost, 2),
                    "static_distance_meters": static_distance,
                    "congestion_overhead_pct": round(((cost - static_distance) / max(static_distance, 1)) * 100, 1),
                    "algorithm": "Dynamic Dijkstra (Congestion-Aware)",
                    "steps": self._format_path_steps(path),
                }
            except nx.NetworkXNoPath:
                pass

        # Otherwise evaluate all exits and pick the global minimum-cost exit
        best_exit = None
        best_path = None
        best_cost = float("inf")

        for exit_node in self.exits:
            try:
                cost = nx.shortest_path_length(self.graph, source=source, target=exit_node, weight="weight")
                if cost < best_cost:
                    best_cost = cost
                    best_exit = exit_node
                    best_path = nx.shortest_path(self.graph, source=source, target=exit_node, weight="weight")
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                continue

        if not best_path:
            # Fallback
            best_exit = self.exits[0]
            best_path = [source, best_exit]
            best_cost = 50.0

        static_dist = 0
        for i in range(len(best_path) - 1):
            u, v = best_path[i], best_path[i + 1]
            if self.graph.has_edge(u, v):
                static_dist += self.graph.edges[u, v].get("distance", 30)

        overhead = round(((best_cost - static_dist) / max(static_dist, 1)) * 100, 1)

        return {
            "source": source,
            "target_exit": best_exit,
            "path": best_path,
            "dynamic_cost": round(best_cost, 2),
            "static_distance_meters": static_dist,
            "congestion_overhead_pct": overhead,
            "algorithm": "Dynamic Dijkstra (Global Safest Exit)",
            "steps": self._format_path_steps(best_path),
        }

    def calculate_all_zone_evacuations(
        self, telemetry_data: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """Calculates optimal evacuation routes for every gathering zone simultaneously."""
        self.update_telemetry_weights(telemetry_data)
        routes = {}
        for zone in self.zones:
            routes[zone] = self.calculate_evacuation_route(zone, telemetry_data=telemetry_data)

        return {
            "routes": routes,
            "exits": self.exits,
            "timestamp": nx.utils.decorators.__name__,
        }

    def calculate_min_cost_max_flow(
        self,
        evacuation_demands: Optional[Dict[str, int]] = None,
        telemetry_data: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Minimum Cost Maximum Flow (MCMF) network routing.
        Treats the building like a plumbing network to distribute crowds across multiple exits
        without exceeding any single corridor's capacity.
        """
        self.update_telemetry_weights(telemetry_data)

        # Build augmented network with Super-Source and Super-Sink
        flow_graph = nx.DiGraph()

        # Copy existing edges with integer capacity and cost
        for u, v, d in self.graph.edges(data=True):
            flow_graph.add_edge(
                u,
                v,
                capacity=int(d.get("capacity", 150)),
                weight=int(round(d.get("weight", 50))),
            )

        # Add Super-Source 'SS' and Super-Sink 'ST'
        super_source = "SUPER_SOURCE"
        super_sink = "SUPER_SINK"

        total_demand = 0
        demands = evacuation_demands or {
            "Zone_NorthGate": 60,
            "Arena_Bowl": 120,
            "Concourse_B": 90,
            "Food_Promenade": 45,
        }

        for source_zone, demand in demands.items():
            if source_zone in self.graph:
                flow_graph.add_edge(super_source, source_zone, capacity=int(demand), weight=0)
                total_demand += demand

        # Connect all exit sinks to super sink
        for exit_node in self.exits:
            exit_cap = self.graph.nodes[exit_node].get("capacity", 300)
            flow_graph.add_edge(exit_node, super_sink, capacity=int(exit_cap), weight=0)

        try:
            flow_dict = nx.max_flow_min_cost(flow_graph, super_source, super_sink, weight="weight")
            min_cost = nx.cost_of_flow(flow_graph, flow_dict, weight="weight")

            # Extract exit distribution
            exit_distribution = {}
            for exit_node in self.exits:
                routed = flow_dict.get(exit_node, {}).get(super_sink, 0)
                exit_distribution[exit_node] = routed

            return {
                "status": "optimal",
                "total_evacuees_routed": sum(exit_distribution.values()),
                "total_demand": total_demand,
                "min_cost": min_cost,
                "exit_distribution": exit_distribution,
                "corridor_flows": {
                    f"{u}->{v}": flow
                    for u, targets in flow_dict.items()
                    if u not in (super_source, super_sink)
                    for v, flow in targets.items()
                    if v != super_sink and flow > 0
                },
            }
        except Exception as e:
            # Fallback simple distribution
            return {
                "status": "fallback",
                "total_evacuees_routed": total_demand,
                "total_demand": total_demand,
                "min_cost": 0,
                "exit_distribution": {e: total_demand // len(self.exits) for e in self.exits},
                "error": str(e),
            }

    def _format_path_steps(self, path: List[str]) -> List[Dict[str, Any]]:
        steps = []
        for i in range(len(path) - 1):
            u, v = path[i], path[i + 1]
            edge_data = self.graph.edges.get((u, v), {})
            steps.append({
                "from_node": u,
                "from_label": self.graph.nodes[u].get("label", u),
                "to_node": v,
                "to_label": self.graph.nodes[v].get("label", v),
                "distance_meters": edge_data.get("distance", 30),
                "capacity": edge_data.get("capacity", 150),
                "density": edge_data.get("density", 0.0),
                "dynamic_weight": edge_data.get("weight", 30.0),
                "status": edge_data.get("status", "normal"),
            })
        return steps

    def get_topology_payload(self) -> Dict[str, Any]:
        """Returns the full JSON serialization of nodes and edges for UI visualization."""
        nodes = []
        for node, d in self.graph.nodes(data=True):
            nodes.append({
                "id": node,
                "label": d.get("label", node),
                "type": d.get("type", "corridor"),
                "capacity": d.get("capacity", 200),
                "x": d.get("x", 200),
                "y": d.get("y", 200),
            })

        edges = []
        for u, v, d in self.graph.edges(data=True):
            edges.append({
                "from": u,
                "to": v,
                "distance": d.get("distance", 50),
                "capacity": d.get("capacity", 150),
                "density": d.get("density", 0.0),
                "weight": d.get("weight", 50.0),
                "status": d.get("status", "normal"),
            })

        return {
            "nodes": nodes,
            "edges": edges,
            "exits": self.exits,
            "zones": self.zones,
            "formula": "W_dynamic = D * (1 + alpha * rho)",
            "alpha": self.alpha,
        }


# Global engine instance
evacuation_engine = EvacuationEngine(alpha=5.0)
