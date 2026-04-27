from collections import deque
from datetime import datetime, timezone
from math import sqrt
from typing import Any, Dict, List, Sequence, Tuple

from advanced_models.convlstm import ConvLSTMPredictor
from advanced_models.csrnet import CSRNetDensityEstimator
from utils.config import (
    CONGESTION_ALERT_THRESHOLD,
    DENSITY_ALERT_THRESHOLD,
    DENSE_COUNT_THRESHOLD,
    ENABLE_ADVANCED_MODELS,
    HEATMAP_HISTORY,
    MOVEMENT_ALERT_THRESHOLD,
    MOVEMENT_HISTORY,
    OVERCROWD_THRESHOLD,
    SUDDEN_SPIKE_THRESHOLD,
    TEMPORAL_SEQUENCE_LENGTH,
)


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
    def __init__(self) -> None:
        self.heatmap_history: deque[Tuple[int, int]] = deque(maxlen=HEATMAP_HISTORY)
        self.count_history: deque[float] = deque(maxlen=max(TEMPORAL_SEQUENCE_LENGTH, 5))
        self.last_positions: Dict[int, Tuple[int, int]] = {}
        self.unique_track_ids: set[int] = set()
        self.last_count = 0
        self.line_crossing = {"entry": 0, "exit": 0}
        self.movement_history: deque[float] = deque(maxlen=MOVEMENT_HISTORY)
        self.temporal_model = ConvLSTMPredictor() if ENABLE_ADVANCED_MODELS else None
        self.density_model = CSRNetDensityEstimator() if ENABLE_ADVANCED_MODELS else None

    def update(
        self,
        tracks: List[Dict[str, Any]],
        frame: Any,
        frame_shape: Sequence[int],
        frame_id: int | None = None,
    ) -> Dict[str, Any]:
        height, width = int(frame_shape[0]), int(frame_shape[1])
        line_y = max(height // 2, 1)
        frame_area = max(height * width, 1)
        diagonal = max(sqrt((width ** 2) + (height ** 2)), 1.0)
        zone_counts = {"left": 0, "center": 0, "right": 0}
        detections: List[Dict[str, Any]] = []
        fresh_centers: List[Tuple[int, int]] = []
        movement_samples: List[float] = []
        total_bbox_area = 0

        for item in tracks:
            x, y, w, h = item["bbox"]
            cx, cy = item["center"]
            track_id = int(item["id"])
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
                movement_samples.append(sqrt((delta_x ** 2) + (delta_y ** 2)) / diagonal)
                previous_y = previous[1]
                if previous_y < line_y <= cy:
                    self.line_crossing["entry"] += 1
                elif previous_y > line_y >= cy:
                    self.line_crossing["exit"] += 1

            self.last_positions[track_id] = (cx, cy)

        self.heatmap_history.extend(fresh_centers)

        active_track_ids = sorted({int(item["id"]) for item in tracks})
        current_count = len(active_track_ids)
        for track_id in active_track_ids:
            self.unique_track_ids.add(track_id)
        total_count = len(self.unique_track_ids)

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
        congestion_score = min(
            1.0,
            (current_count / max(OVERCROWD_THRESHOLD, 1)) * 0.45
            + density_score * 0.35
            + smoothed_movement * 1.2 * 0.20,
        )
        crowd_features = {
            "density_score": round(density_score, 4),
            "movement_score": round(smoothed_movement, 4),
            "congestion_score": round(congestion_score, 4),
            "hotspot_ratio": round(hotspot_ratio, 4),
        }
        alerts = self._build_alerts(current_count, crowd_features)
        risk = self._derive_composite_risk(current_count, crowd_features)

        result: Dict[str, Any] = {
            "frame_id": frame_id,
            "people_count": current_count,
            "current_count": current_count,
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
            "line_crossing": dict(self.line_crossing),
            "count": current_count,
            "risk": risk,
            "crowd_features": crowd_features,
            "risk_score": round(self._derive_risk_score(current_count, crowd_features), 4),
            "density_map": density_result.get("density_map", []),
            "density_context": density_result.get("density_context", {}),
            "temporal_context": temporal_result.get("temporal_context", {}),
            "updated_at": utc_now(),
        }

        self.last_count = current_count
        return result

    def empty_result(self) -> Dict[str, Any]:
        return {
            "frame_id": None,
            "people_count": 0,
            "current_count": 0,
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
            "line_crossing": dict(self.line_crossing),
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
            "updated_at": utc_now(),
        }

    def stale_result(self, previous_result: Dict[str, Any] | None = None) -> Dict[str, Any]:
        base = previous_result or {}
        return {
            **base,
            "people_count": 0,
            "current_count": 0,
            "active_track_ids": [],
            "detections": [],
            "heatmap_points": [],
            "alerts": [],
            "zone_counts": {"left": 0, "center": 0, "right": 0},
            "count": 0,
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
            "risk": "Low",
            "crowd_features": {
                "density_score": 0.0,
                "movement_score": 0.0,
                "congestion_score": 0.0,
                "hotspot_ratio": 0.0,
            },
            "risk_score": 0.0,
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
