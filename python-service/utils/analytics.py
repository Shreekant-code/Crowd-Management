from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from math import sqrt
from typing import Any, Dict, List, Optional, Sequence, Tuple
import numpy as np

from advanced_models.convlstm import ConvLSTMPredictor
from advanced_models.csrnet import CSRNetDensityEstimator
from utils.config import (
    ACTIVE_TRACK_PERSISTENCE_FRAMES,
    CONGESTION_ALERT_THRESHOLD,
    DEBUG_EVERY_N_FRAMES,
    DENSITY_ALERT_THRESHOLD,
    DENSE_CLUSTER_DIST_THRESHOLD,
    DENSE_COUNT_THRESHOLD,
    ENABLE_ADVANCED_MODELS,
    HEATMAP_HISTORY,
    MOVEMENT_ALERT_THRESHOLD,
    MOVEMENT_HISTORY,
    OVERCROWD_THRESHOLD,
    SPARSE_CLUSTER_DIST_THRESHOLD,
    SUDDEN_SPIKE_THRESHOLD,
    TEMPORAL_SEQUENCE_LENGTH,
)
from utils.density_analyzer import SpatialDensityAnalyzer


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def derive_risk(count: int) -> str:
    if count >= 180:
        return "Critical"
    if count >= 130:
        return "High"
    if count >= 75:
        return "Medium"
    return "Low"


class AnalyticsEngine:
    def __init__(self, enable_advanced: bool | None = None) -> None:
        advanced_enabled = ENABLE_ADVANCED_MODELS if enable_advanced is None else enable_advanced
        self.heatmap_history: deque[Tuple[int, int]] = deque(maxlen=HEATMAP_HISTORY)
        self.count_history: deque[float] = deque(maxlen=max(TEMPORAL_SEQUENCE_LENGTH, 5))
        self.last_positions: Dict[int, Tuple[int, int]] = {}
        self.last_sides: Dict[int, str] = {}
        self.counted_track_ids: set[int] = set()
        self.track_ttl: Dict[int, int] = {}
        self.last_count = 0
        self.movement_history: deque[float] = deque(maxlen=MOVEMENT_HISTORY)
        self.speed_history: deque[float] = deque(maxlen=MOVEMENT_HISTORY)
        self.line_crossing: Dict[str, int] = {"entry": 0, "exit": 0}
        self.temporal_model = ConvLSTMPredictor() if advanced_enabled else None
        self.density_model = CSRNetDensityEstimator() if advanced_enabled else None
        self.density_analyzer = SpatialDensityAnalyzer(
            grid_rows=6,
            grid_cols=6,
            sparse_dist_threshold=SPARSE_CLUSTER_DIST_THRESHOLD,
            dense_dist_threshold=DENSE_CLUSTER_DIST_THRESHOLD,
            k_neighbors=3,
        )

    def reset(self) -> None:
        self.heatmap_history.clear()
        self.count_history.clear()
        self.last_positions.clear()
        self.last_sides.clear()
        self.counted_track_ids.clear()
        self.track_ttl.clear()
        self.last_count = 0
        self.movement_history.clear()
        self.speed_history.clear()
        self.line_crossing = {"entry": 0, "exit": 0}

    def update(
        self,
        tracks: List[Dict[str, Any]],
        frame: Any,
        frame_shape: Sequence[int],
        frame_id: int | None = None,
    ) -> Dict[str, Any]:
        height, width = int(frame_shape[0]), int(frame_shape[1])
        frame_area = max(height * width, 1)
        diagonal = max(sqrt((width ** 2) + (height ** 2)), 1.0)
        zone_counts = {"left": 0, "center": 0, "right": 0}
        detections: List[Dict[str, Any]] = []
        fresh_centers: List[Tuple[int, int]] = []
        movement_samples: List[float] = []
        total_bbox_area = 0
        seen_track_ids: set[int] = set()
        line_crossing = {"entry": 0, "exit": 0}
        midline_x = width / 2.0

        for item in tracks:
            try:
                x, y, w, h = item["bbox"]
                cx, cy = item["center"]
                track_id = int(item["id"])
            except (KeyError, TypeError, ValueError):
                continue

            if track_id in seen_track_ids:
                continue
            seen_track_ids.add(track_id)

            if w <= 0 or h <= 0:
                continue

            detections.append({"id": track_id, "bbox": [x, y, w, h]})
            fresh_centers.append((cx, cy))
            total_bbox_area += max(w, 0) * max(h, 0)

            if cx < width / 3:
                zone_counts["left"] += 1
            elif cx < (2 * width) / 3:
                zone_counts["center"] += 1
            else:
                zone_counts["right"] += 1

            previous = self.last_positions.get(track_id)
            if previous is not None:
                delta_x = cx - previous[0]
                delta_y = cy - previous[1]
                movement = sqrt((delta_x ** 2) + (delta_y ** 2)) / diagonal
                movement_samples.append(movement)
                self.speed_history.append(movement)

                previous_side = self.last_sides.get(track_id)
                current_side = "left" if cx < midline_x else "right"
                if previous_side and previous_side != current_side:
                    if previous_side == "left" and current_side == "right":
                        line_crossing["entry"] += 1
                    elif previous_side == "right" and current_side == "left":
                        line_crossing["exit"] += 1
                self.last_sides[track_id] = current_side
            else:
                self.last_sides[track_id] = "left" if cx < midline_x else "right"

            self.last_positions[track_id] = (cx, cy)

        self.heatmap_history.extend(fresh_centers)

        current_detected_ids = sorted(seen_track_ids)
        for track_id in current_detected_ids:
            self.track_ttl[track_id] = max(ACTIVE_TRACK_PERSISTENCE_FRAMES, 1)
            self.counted_track_ids.add(track_id)

        stale_track_ids = []
        for track_id in list(self.track_ttl.keys()):
            if track_id in current_detected_ids:
                continue
            next_ttl = int(self.track_ttl[track_id]) - 1
            if next_ttl <= 0:
                stale_track_ids.append(track_id)
            else:
                self.track_ttl[track_id] = next_ttl

        for track_id in stale_track_ids:
            self.track_ttl.pop(track_id, None)

        active_track_ids = sorted(track_id for track_id, ttl in self.track_ttl.items() if ttl > 0)
        current_count = len(active_track_ids)
        total_count = len(self.counted_track_ids)

        density_result: Dict[str, Any] = {
            "density_count": current_count,
            "density_map": [],
            "density_context": {
                "model": "CSRNet",
                "enabled": False,
                "used_density": False,
                "track_count": len(tracks),
            },
        }
        if self.density_model is not None:
            density_result = self.density_model.predict(frame, tracks, current_count)

        density_count = int(max(density_result.get("density_count", current_count), 0))
        base_count = current_count if current_count < DENSE_COUNT_THRESHOLD else density_count
        self.count_history.append(float(base_count))

        temporal_result: Dict[str, Any] = {
            "predicted_crowd": round(float(base_count), 2),
            "smoothed_count": int(round(base_count)),
            "final_count": int(round(base_count)),
            "temporal_context": {
                "model": "ConvLSTM",
                "enabled": False,
                "sample_count": len(self.count_history),
            },
        }
        if self.temporal_model is not None:
            temporal_result = self.temporal_model.predict(list(self.count_history), float(base_count))

        bbox_density = min(total_bbox_area / frame_area, 1.0)
        hotspot_ratio = (
            max(zone_counts.values()) / max(current_count, 1)
            if current_count
            else 0.0
        )
        density_score = min(max(bbox_density * 2.4, hotspot_ratio * 0.75), 1.0)
        movement_score = sum(movement_samples) / len(movement_samples) if movement_samples else 0.0
        self.movement_history.append(movement_score)
        smoothed_movement = (
            sum(self.movement_history) / len(self.movement_history)
            if self.movement_history
            else 0.0
        )
        smoothed_speed = (
            sum(self.speed_history) / len(self.speed_history)
            if self.speed_history
            else 0.0
        )
        congestion_score = min(
            1.0,
            (current_count / max(OVERCROWD_THRESHOLD, 1)) * 0.45
            + density_score * 0.35
            + smoothed_movement * 1.2 * 0.20,
        )
        flow_estimation = round(max((line_crossing["entry"] + line_crossing["exit"]) + (smoothed_movement * current_count), 0.0), 4)
        danger_score = round(
            min(
                1.0,
                (current_count / max(OVERCROWD_THRESHOLD, 1)) * 0.55
                + density_score * 0.25
                + smoothed_movement * 0.20,
            ),
            4,
        )
        crowd_features = {
            "density_score": round(density_score, 4),
            "movement_score": round(smoothed_movement, 4),
            "congestion_score": round(congestion_score, 4),
            "hotspot_ratio": round(hotspot_ratio, 4),
        }
        alerts = self._build_alerts(current_count, crowd_features)
        risk = self._derive_composite_risk(current_count, crowd_features)

        regime_info = self.density_analyzer.analyze_detections(
            tracks,
            frame_shape=(height, width),
        )

        result: Dict[str, Any] = {
            "frame_id": frame_id,
            "people_count": current_count,
            "current_count": current_count,
            "sparse_count": regime_info["sparse_count"],
            "dense_count": regime_info["dense_count"],
            "dominant_regime": regime_info["dominant_regime"],
            "density_mode": regime_info["dominant_regime"] == "DENSE",
            "sparse_ratio": regime_info["sparse_ratio"],
            "dense_ratio": regime_info["dense_ratio"],
            "dense_clusters": regime_info["dense_clusters"],
            "regime_breakdown": regime_info,
            "total_count": total_count,
            "density_count": density_count,
            "base_count": int(round(base_count)),
            "predicted_crowd": temporal_result.get("predicted_crowd", round(float(base_count), 2)),
            "smoothed_count": temporal_result.get("smoothed_count", int(round(base_count))),
            "final_count": temporal_result.get("final_count", int(round(base_count))),
            "active_track_ids": active_track_ids,
            "detections": detections,
            "heatmap_points": [{"x": x, "y": y} for x, y in list(self.heatmap_history)],
            "alerts": alerts,
            "zone_counts": zone_counts,
            "line_crossing": line_crossing,
            "flow_estimation": flow_estimation,
            "speed_estimation": round(smoothed_speed * 30.0, 4),
            "count": current_count,
            "risk": risk,
            "crowd_features": crowd_features,
            "risk_score": round(self._derive_risk_score(current_count, crowd_features), 4),
            "danger_score": danger_score,
            "density_map": density_result.get("density_map", []),
            "density_context": density_result.get("density_context", {}),
            "temporal_context": temporal_result.get("temporal_context", {}),
            "updated_at": utc_now(),
        }

        if DEBUG_EVERY_N_FRAMES > 0 and frame_id and frame_id % DEBUG_EVERY_N_FRAMES == 0:
            print(
                f"[analytics] frame={frame_id} shape=({height},{width}) "
                f"detections={len(detections)} tracked={len(current_detected_ids)} "
                f"sparse={regime_info['sparse_count']} dense={regime_info['dense_count']} "
                f"current_count={current_count} total_count={total_count}"
            )

        self.last_count = current_count
        return result

    def empty_result(self) -> Dict[str, Any]:
        return {
            "frame_id": None,
            "people_count": 0,
            "current_count": 0,
            "sparse_count": 0,
            "dense_count": 0,
            "dominant_regime": "SPARSE",
            "sparse_ratio": 1.0,
            "dense_ratio": 0.0,
            "dense_clusters": [],
            "regime_breakdown": {},
            "total_count": 0,
            "density_count": 0,
            "base_count": 0,
            "predicted_crowd": 0.0,
            "smoothed_count": 0,
            "final_count": 0,
            "active_track_ids": [],
            "detections": [],
            "heatmap_points": [],
            "alerts": [],
            "zone_counts": {"left": 0, "center": 0, "right": 0},
            "line_crossing": {"entry": 0, "exit": 0},
            "flow_estimation": 0.0,
            "speed_estimation": 0.0,
            "count": 0,
            "risk": "Low",
            "density_map": [],
            "density_context": {
                "model": "CSRNet",
                "enabled": False,
                "used_density": False,
                "track_count": 0,
            },
            "temporal_context": {
                "model": "ConvLSTM",
                "enabled": False,
                "sample_count": 0,
            },
            "crowd_features": {
                "density_score": 0.0,
                "movement_score": 0.0,
                "congestion_score": 0.0,
                "hotspot_ratio": 0.0,
            },
            "risk_score": 0.0,
            "danger_score": 0.0,
            "updated_at": utc_now(),
        }

    def build_stream_result(
        self,
        tracks: List[Dict[str, Any]],
        detections: List[Dict[str, Any]],
        count: int,
        density_mode: bool = False,
        overlap_ratio: float = 0.0,
        sparse_count: Optional[int] = None,
        dense_count: Optional[int] = None,
        dominant_regime: Optional[str] = None,
        dense_clusters: Optional[List[Dict[str, Any]]] = None,
        regime_breakdown: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        zone_counts = {"left": 0, "center": 0, "right": 0}
        heatmap_points = []
        movement_samples = []

        # Determine coordinate space: 1920p native or 640p letterbox
        base_width = 1920.0
        midline_x = base_width / 2.0
        left_bound = base_width / 3.0
        right_bound = (2.0 * base_width) / 3.0

        for track in tracks:
            track_id = int(track.get("id", 0))
            cx, cy = track.get("center", [960, 540])
            heatmap_points.append({"x": cx, "y": cy})

            # Sector partitioning
            if cx < left_bound:
                zone_counts["left"] += 1
            elif cx < right_bound:
                zone_counts["center"] += 1
            else:
                zone_counts["right"] += 1

            # Line crossing & movement tracking
            prev_pos = self.last_positions.get(track_id)
            if prev_pos is not None:
                dx = cx - prev_pos[0]
                dy = cy - prev_pos[1]
                dist = sqrt(dx * dx + dy * dy)
                movement_samples.append(dist / 2200.0)

                prev_side = self.last_sides.get(track_id)
                curr_side = "left" if cx < midline_x else "right"
                if prev_side and prev_side != curr_side:
                    if prev_side == "left" and curr_side == "right":
                        self.line_crossing["entry"] += 1
                    elif prev_side == "right" and curr_side == "left":
                        self.line_crossing["exit"] += 1
                self.last_sides[track_id] = curr_side
            else:
                self.last_sides[track_id] = "left" if cx < midline_x else "right"

            self.last_positions[track_id] = (cx, cy)

        self.heatmap_history.extend([(p["x"], p["y"]) for p in heatmap_points])
        effective_count = int(count)
        risk = derive_risk(effective_count)

        avg_movement = float(np.mean(movement_samples)) if movement_samples else 0.12
        density_score = round(min(effective_count / 30.0, 1.0), 4)
        max_sector_count = max(zone_counts.values()) if zone_counts else 0
        hotspot_ratio = round(max_sector_count / max(effective_count, 1), 4)

        if regime_breakdown is None:
            regime_info = self.density_analyzer.analyze_detections(
                tracks if tracks else detections,
                frame_shape=(1080, 1920),
            )
        else:
            regime_info = regime_breakdown

        sparse_cnt = sparse_count if sparse_count is not None else regime_info.get("sparse_count", effective_count)
        dense_cnt = dense_count if dense_count is not None else regime_info.get("dense_count", 0)
        dom_regime = dominant_regime or regime_info.get("dominant_regime", "SPARSE")
        clusters = dense_clusters if dense_clusters is not None else regime_info.get("dense_clusters", [])

        crowd_features = {
            "density_score": density_score,
            "movement_score": round(min(avg_movement * 5.0, 1.0), 4),
            "congestion_score": round(overlap_ratio if overlap_ratio > 0 else min(effective_count / 40.0, 1.0), 4),
            "hotspot_ratio": hotspot_ratio,
        }

        return {
            "people_count": effective_count,
            "current_count": effective_count,
            "count": effective_count,
            "sparse_count": sparse_cnt,
            "dense_count": dense_cnt,
            "dominant_regime": dom_regime,
            "density_mode": dom_regime == "DENSE" or density_mode,
            "sparse_ratio": regime_info.get("sparse_ratio", 1.0),
            "dense_ratio": regime_info.get("dense_ratio", 0.0),
            "dense_clusters": clusters,
            "regime_breakdown": regime_info,
            "density_count": effective_count if (density_mode or dom_regime == "DENSE") else 0,
            "overlap_ratio": overlap_ratio,
            "active_track_ids": [t.get("id") for t in tracks if "id" in t],
            "detections": tracks if tracks else detections,
            "heatmap_points": [{"x": x, "y": y} for x, y in list(self.heatmap_history)],
            "zone_counts": zone_counts,
            "line_crossing": dict(self.line_crossing),
            "risk": risk,
            "crowd_features": crowd_features,
            "risk_score": round(min(effective_count / 30.0, 1.0), 4),
            "updatedAt": utc_now(),
        }

    def stale_result(self, previous_result: Dict[str, Any] | None = None) -> Dict[str, Any]:
        base = previous_result or {}
        return {
            **base,
            "people_count": 0,
            "current_count": 0,
            "sparse_count": 0,
            "dense_count": 0,
            "dominant_regime": "SPARSE",
            "sparse_ratio": 1.0,
            "dense_ratio": 0.0,
            "dense_clusters": [],
            "regime_breakdown": {},
            "active_track_ids": [],
            "detections": [],
            "heatmap_points": [],
            "alerts": [],
            "zone_counts": {"left": 0, "center": 0, "right": 0},
            "count": 0,
            "flow_estimation": 0.0,
            "speed_estimation": 0.0,
            "density_count": 0,
            "base_count": 0,
            "predicted_crowd": 0.0,
            "smoothed_count": 0,
            "final_count": 0,
            "density_map": [],
            "density_context": {
                "model": "CSRNet",
                "enabled": False,
                "used_density": False,
                "track_count": 0,
            },
            "temporal_context": {
                "model": "ConvLSTM",
                "enabled": False,
                "sample_count": 0,
            },
            "line_crossing": {"entry": 0, "exit": 0},
            "risk": "Low",
            "crowd_features": {
                "density_score": 0.0,
                "movement_score": 0.0,
                "congestion_score": 0.0,
                "hotspot_ratio": 0.0,
            },
            "risk_score": 0.0,
            "danger_score": 0.0,
            "processing_status": "stale",
            "updated_at": utc_now(),
        }

    def _build_alerts(self, people_count: int, crowd_features: Dict[str, float]) -> List[Dict[str, Any]]:
        alerts: List[Dict[str, Any]] = []
        if people_count >= OVERCROWD_THRESHOLD:
            alerts.append(
                {
                    "type": "overcrowding",
                    "message": f"People count reached {people_count}",
                    "risk": derive_risk(people_count),
                    "count": people_count,
                }
            )

        if people_count - self.last_count >= SUDDEN_SPIKE_THRESHOLD:
            alerts.append(
                {
                    "type": "sudden_spike",
                    "message": f"People count jumped from {self.last_count} to {people_count}",
                    "risk": derive_risk(people_count),
                    "count": people_count,
                }
            )

        if crowd_features["density_score"] >= DENSITY_ALERT_THRESHOLD:
            alerts.append(
                {
                    "type": "density_hotspot",
                    "message": f"Density hotspot detected at score {crowd_features['density_score']:.2f}",
                    "risk": self._derive_composite_risk(people_count, crowd_features),
                    "count": people_count,
                }
            )

        if crowd_features["movement_score"] >= MOVEMENT_ALERT_THRESHOLD:
            alerts.append(
                {
                    "type": "movement_surge",
                    "message": f"Movement surge detected at score {crowd_features['movement_score']:.2f}",
                    "risk": self._derive_composite_risk(people_count, crowd_features),
                    "count": people_count,
                }
            )

        if crowd_features["congestion_score"] >= CONGESTION_ALERT_THRESHOLD:
            alerts.append(
                {
                    "type": "congestion_risk",
                    "message": f"Congestion risk reached {crowd_features['congestion_score']:.2f}",
                    "risk": self._derive_composite_risk(people_count, crowd_features),
                    "count": people_count,
                }
            )

        return alerts

    def _derive_risk_score(self, people_count: int, crowd_features: Dict[str, float]) -> float:
        count_score = min(people_count / max(OVERCROWD_THRESHOLD * 1.5, 1), 1.0)
        return min(
            1.0,
            count_score * 0.45
            + crowd_features["density_score"] * 0.30
            + crowd_features["movement_score"] * 0.10
            + crowd_features["congestion_score"] * 0.15,
        )

    def _derive_composite_risk(self, people_count: int, crowd_features: Dict[str, float]) -> str:
        score = self._derive_risk_score(people_count, crowd_features)
        if score >= 0.82:
            return "Critical"
        if score >= 0.62:
            return "High"
        if score >= 0.34:
            return "Medium"
        return derive_risk(people_count) if people_count else "Low"
