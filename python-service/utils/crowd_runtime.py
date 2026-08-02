from __future__ import annotations

import time
from collections import deque
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any, Deque, Dict, List, Optional

import cv2
import numpy as np

from advanced_models.convlstm import ConvLSTMPredictor
from advanced_models.csrnet import CSRNetDensityEstimator
from detector import PersonDetector
from tracker import PersonTracker
from utils.analytics import AnalyticsEngine
from utils.config import (
    COUNT_SMOOTHING_WINDOW,
    CSRNET_FRAME_INTERVAL,
    CSRNET_TIMEOUT_SECONDS,
    DENSE_MODEL_SWITCH_THRESHOLD,
    DENSITY_MAP_OUTPUT_HEIGHT,
    DENSITY_MAP_OUTPUT_WIDTH,
    HEATMAP_BLEND_ALPHA,
    HEATMAP_INTENSITY_THRESHOLD,
    HEATMAP_RENDER_BLUR,
    HEATMAP_RENDER_RADIUS,
    HEATMAP_UPDATE_INTERVAL,
    HEATMAP_SMOOTHING,
    HYBRID_USE_BOTH_MODELS,
    PREDICTION_HIGH_RISK_COUNT,
    PREDICTION_HORIZON_MINUTES,
    PREDICTION_MEDIUM_RISK_COUNT,
    PREDICTION_RISK_GROWTH_THRESHOLD,
    TEMPORAL_SEQUENCE_LENGTH,
    YOLO_CONFIDENCE,
    YOLO_MODEL,
)
from utils.preprocessing import preprocess_frame

_GLOBAL_DETECTOR = PersonDetector(model_name=YOLO_MODEL, confidence=YOLO_CONFIDENCE)
_GLOBAL_CSRNET = CSRNetDensityEstimator()


def get_shared_detector() -> PersonDetector:
    return _GLOBAL_DETECTOR


def get_shared_csrnet() -> CSRNetDensityEstimator:
    return _GLOBAL_CSRNET


class CrowdRuntime:
    def __init__(self) -> None:
        self.detector = get_shared_detector()
        self.csrnet = get_shared_csrnet()
        self.temporal_predictor = ConvLSTMPredictor()
        self.tracker = PersonTracker()
        self.analytics = AnalyticsEngine(enable_advanced=False)
        self.current_mode = "YOLO"
        self.last_valid_count = 0
        self.failure_count = 0
        self.fps = 0.0
        self.last_tick: Optional[float] = None
        self.last_density_map: Optional[np.ndarray] = None
        self.count_window: Deque[float] = deque(maxlen=max(COUNT_SMOOTHING_WINDOW, 1))
        self.prediction_window: Deque[float] = deque(maxlen=max(TEMPORAL_SEQUENCE_LENGTH, 5))
        self.csrnet_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="csrnet-runtime")
        self.csrnet_future: Optional[Future] = None
        self.latest_csrnet_result: Dict[str, Any] = {
            "valid": False,
            "count": 0,
            "density_map": None,
            "processing_ms": 0.0,
            "error": "warming_up",
            "input_size": None,
        }
        self.latest_csrnet_result_at: float = 0.0
        self.last_prediction = 0.0
        self.processed_frames = 0
        self.last_sparse_heatmap_frame: Optional[np.ndarray] = None
        self.last_total_count = 0
        self.density_count_window: Deque[float] = deque(maxlen=max(TEMPORAL_SEQUENCE_LENGTH, 4))
        self.density_map_window: Deque[np.ndarray] = deque(maxlen=max(TEMPORAL_SEQUENCE_LENGTH, 4))
        self._shutdown = False

    def reset_for_new_video(self) -> None:
        print("[runtime] Processing new video...")
        self._shutdown = False
        self.current_mode = "YOLO"
        self.last_valid_count = 0
        self.failure_count = 0
        self.fps = 0.0
        self.last_tick = None
        self.latest_csrnet_result = {
            "valid": False,
            "count": 0,
            "density_map": None,
            "processing_ms": 0.0,
            "error": "warming_up",
            "input_size": None,
        }
        self.latest_csrnet_result_at = 0.0
        self.last_prediction = 0.0
        self.processed_frames = 0
        self.last_total_count = 0
        self._reset_heatmap_state()
        self.count_window.clear()
        self.prediction_window.clear()
        self.tracker.reset()
        self.analytics.reset()
        if self.csrnet_future is not None and not self.csrnet_future.done():
            self.csrnet_future.cancel()
        self.csrnet_future = None

    def shutdown(self) -> None:
        self._shutdown = True
        if self.csrnet_future is not None and not self.csrnet_future.done():
            self.csrnet_future.cancel()
        self.csrnet_future = None
        self.csrnet_executor.shutdown(wait=False, cancel_futures=True)

    def process_frame(self, frame: Any, frame_id: Optional[int] = None) -> Dict[str, Any]:
        if self._shutdown:
            empty = self.analytics.empty_result()
            empty.update(
                {
                    "frame_id": frame_id,
                    "model_used": "YOLO",
                    "mode": "YOLO",
                    "fps": round(self.fps, 2),
                    "heatmap_active": False,
                    "processing_status": "shutdown",
                    "status": "shutdown",
                }
            )
            return empty

        if frame is None or not hasattr(frame, "shape") or len(frame.shape) < 2:
            empty = self.analytics.empty_result()
            empty.update(
                {
                    "frame_id": frame_id,
                    "model_used": "YOLO",
                    "mode": "YOLO",
                    "fps": round(self.fps, 2),
                    "heatmap_active": False,
                    "processing_status": "empty_frame",
                    "status": "empty_frame",
                }
            )
            return empty

        processed_frame, preprocessing_context = preprocess_frame(frame)
        if processed_frame is None or not hasattr(processed_frame, "shape") or len(processed_frame.shape) < 2:
            empty = self.analytics.empty_result()
            empty.update(
                {
                    "frame_id": frame_id,
                    "model_used": "YOLO",
                    "mode": "YOLO",
                    "fps": round(self.fps, 2),
                    "heatmap_active": False,
                    "processing_status": "invalid_preprocessed_frame",
                    "status": "invalid_preprocessed_frame",
                    "preprocessing_context": preprocessing_context,
                }
            )
            return empty

        # Keep detection/tracking on the decoded frame so preprocessing cannot
        # accidentally distort person features on any source type.
        detection_frame = frame
        display_frame = processed_frame if hasattr(processed_frame, "shape") and len(processed_frame.shape) >= 2 else frame

        print(
            f"[frame] frame_id={frame_id} "
            f"shape={getattr(frame, 'shape', None)} "
            f"dtype={getattr(frame, 'dtype', None)} "
            f"preprocessed_shape={getattr(processed_frame, 'shape', None)}"
        )

        yolo_result = self._run_yolo_pipeline(detection_frame, frame_id)
        self.processed_frames += 1
        self._poll_csrnet_result()
        self._schedule_csrnet(display_frame)

        tick = time.perf_counter()
        if self.last_tick is not None:
            instantaneous_fps = 1.0 / max(tick - self.last_tick, 1e-6)
            self.fps = instantaneous_fps if self.fps <= 0.0 else (0.7 * self.fps) + (0.3 * instantaneous_fps)
        self.last_tick = tick

        csrnet_result = self._current_csrnet_result()
        dense_result = self._stabilize_dense_result(csrnet_result)
        yolo_count = int(yolo_result["count"])
        dense_count = int(max(dense_result.get("count", 0), 0)) if dense_result["valid"] else 0
        valid_dense_signal = bool(dense_result["valid"] and dense_result.get("density_map") is not None)
        valid_yolo_signal = yolo_count > 0

        fused_count = self._fuse_counts(yolo_count, dense_result)
        selected = self._select_model(yolo_count, dense_result)
        selected["count"] = fused_count
        smoothed_count = self._smooth_count(fused_count)
        prediction = self._predict_future_count(smoothed_count)
        predicted_count = max(float(prediction.get("predicted_crowd", smoothed_count)), 0.0)
        final_count = int(round(prediction.get("final_count", smoothed_count)))
        smoothed_count = int(round(prediction.get("smoothed_count", smoothed_count)))
        self.last_prediction = predicted_count
        prediction_summary = self._summarize_prediction(
            current_count=smoothed_count,
            predicted_count=predicted_count,
            analytics=yolo_result["analytics"],
        )
        risk_level = prediction_summary["risk"]

        output_frame = display_frame.copy()
        dense_mode = selected["model_used"] == "CSRNet"

        if valid_dense_signal:
            density_map = self._smooth_density_map(dense_result["density_map"])
            output_frame = self._apply_heatmap(output_frame, density_map)
            compact_density_map = self._compact_density_map(density_map)
            density_context = {
                "model": "CSRNet",
                "enabled": True,
                "used_density": True,
                "overlay_enabled": True,
                "track_count": len(yolo_result["tracks"]),
                "processing_ms": dense_result["processing_ms"],
                "input_size": dense_result.get("input_size"),
                "sequence_length": len(self.density_count_window),
                "suppressed_without_yolo": False,
            }
        else:
            compact_density_map = []
            density_context = {
                "model": "CSRNet",
                "enabled": bool(getattr(self.csrnet, "enabled", False)),
                "used_density": dense_mode,
                "overlay_enabled": False,
                "track_count": len(yolo_result["tracks"]),
                "fallback_mode": "YOLO",
                "validation_error": dense_result["error"],
                "processing_ms": dense_result["processing_ms"],
                "sequence_length": len(self.density_count_window),
                "suppressed_without_yolo": False,
            }
        output_frame = self._apply_sparse_heatmap(
            output_frame,
            yolo_result["analytics"].get("heatmap_points", []),
            enabled=valid_yolo_signal,
        )
        output_frame = self._draw_tracks(output_frame, yolo_result["tracks"], enabled=True)
        output_frame = self._draw_summary(
            output_frame,
            yolo_count=yolo_count,
            crowd_count=smoothed_count,
            density_count=int(dense_result["count"]) if dense_result["valid"] else None,
            mode=selected["model_used"],
        )
        self.current_mode = selected["model_used"]
        if self.current_mode == "CSRNet":
            self.last_valid_count = smoothed_count
            self.failure_count = 0
        else:
            self.failure_count += 1

        result = dict(yolo_result["analytics"])
        total_count = max(int(result.get("total_count", 0)), self.last_total_count)
        self.last_total_count = total_count
        result.update(
            {
                "people_count": fused_count,
                "current_count": fused_count,
                "count": fused_count,
                "raw_count": yolo_count,
                "yolo_count": yolo_count,
                "csrnet_count": dense_count if dense_result["valid"] else None,
                "density_count": dense_count if dense_result["valid"] else yolo_count,
                "total_count": total_count,
                "base_count": smoothed_count,
                "predicted_crowd": round(predicted_count, 2),
                "predicted_count": round(predicted_count, 2),
                "smoothed_count": smoothed_count,
                "final_count": final_count,
                "mode": self.current_mode,
                "model_used": selected["model_used"],
                "heatmap_active": bool(compact_density_map or valid_yolo_signal),
                "last_valid_count": self.last_valid_count,
                "failure_count": self.failure_count,
                "fps": round(self.fps, 2),
                "density": round(float(yolo_result["analytics"].get("crowd_features", {}).get("density_score", 0.0)), 4),
                "density_map": compact_density_map,
                "density_context": density_context,
                "temporal_context": dense_result.get("temporal_context", prediction.get("temporal_context", {}))
                if valid_dense_signal
                else prediction.get("temporal_context", {}),
                "preprocessing_context": preprocessing_context,
                "processing_status": "active",
                "status": "active",
                "risk": risk_level.capitalize(),
                "risk_level": risk_level,
                "crowd_level": risk_level,
                "prediction_10min_count": prediction_summary["projected_count"],
                "prediction_10min_risk": prediction_summary["risk"].upper(),
                "prediction_10min_label": prediction_summary["label"],
                "prediction_horizon_minutes": PREDICTION_HORIZON_MINUTES,
                "count_history": [int(round(value)) for value in self.count_window],
            }
        )
        result["_output_frame"] = output_frame
        return result

    def _schedule_csrnet(self, frame: Any) -> None:
        if self.csrnet_future is not None and not self.csrnet_future.done():
            return
        if not getattr(self.csrnet, "enabled", False):
            return
        self.csrnet_future = self.csrnet_executor.submit(self._run_csrnet, frame.copy())

    def _poll_csrnet_result(self) -> None:
        if self.csrnet_future is None or not self.csrnet_future.done():
            return
        try:
            self.latest_csrnet_result = self.csrnet_future.result()
            self.latest_csrnet_result_at = time.perf_counter()
        except Exception as error:
            self.latest_csrnet_result = {
                "valid": False,
                "count": self.last_valid_count,
                "density_map": None,
                "processing_ms": 0.0,
                "error": str(error),
                "input_size": None,
            }
        finally:
            self.csrnet_future = None

    def _current_csrnet_result(self) -> Dict[str, Any]:
        self._poll_csrnet_result()
        if self.latest_csrnet_result["valid"]:
            return self.latest_csrnet_result
        if self.csrnet_future is not None and not self.csrnet_future.done():
            return {
                "valid": False,
                "count": self.last_valid_count,
                "density_map": None,
                "processing_ms": round(CSRNET_TIMEOUT_SECONDS * 1000.0, 2),
                "error": "csrnet_inflight",
                "input_size": None,
            }
        return self.latest_csrnet_result

    def _stabilize_dense_result(self, csrnet_result: Dict[str, Any]) -> Dict[str, Any]:
        if not csrnet_result["valid"] or csrnet_result["density_map"] is None:
            return csrnet_result

        density_map = np.asarray(csrnet_result["density_map"], dtype=np.float32)
        if density_map.ndim != 2 or density_map.size == 0:
            fallback = dict(csrnet_result)
            fallback.update({"valid": False, "error": "invalid_density_map_shape"})
            return fallback

        self.density_map_window.append(density_map)
        self.density_count_window.append(float(max(csrnet_result["count"], 0)))
        averaged_density = np.mean(np.stack(tuple(self.density_map_window), axis=0), axis=0).astype(np.float32)
        temporal_result = self.temporal_predictor.predict(
            list(self.density_count_window),
            float(max(csrnet_result["count"], 0)),
        )
        stabilized_count = int(max(
            round(float(temporal_result.get("final_count", csrnet_result["count"]))),
            0,
        ))

        stabilized = dict(csrnet_result)
        stabilized["density_map"] = averaged_density
        stabilized["count"] = stabilized_count
        stabilized["temporal_context"] = temporal_result.get("temporal_context", {})
        return stabilized

    def _run_yolo_pipeline(self, frame: Any, frame_id: Optional[int]) -> Dict[str, Any]:
        detections = self.detector.detect(frame)
        tracks = self.tracker.update(detections)
        analytics_result = self.analytics.update(tracks, frame, frame.shape, frame_id=frame_id)
        yolo_count = len({int(track["id"]) for track in tracks})
        return {
            "detections": detections,
            "tracks": tracks,
            "count": yolo_count,
            "analytics": analytics_result,
        }

    def _run_csrnet(self, frame: Any) -> Dict[str, Any]:
        started_at = time.perf_counter()
        try:
            payload = self.csrnet.infer(frame)
            processing_ms = (time.perf_counter() - started_at) * 1000.0
            density_map = payload.get("density_map")
            validation_error = self._validate_density_map(density_map, processing_ms)
            if validation_error is not None:
                return {
                    "valid": False,
                    "count": self.last_valid_count,
                    "density_map": None,
                    "processing_ms": round(processing_ms, 2),
                    "error": validation_error,
                    "input_size": payload.get("input_size"),
                }

            array = np.asarray(density_map, dtype=np.float32)
            return {
                "valid": True,
                "count": int(max(payload.get("count", self.last_valid_count), 0)),
                "density_map": array,
                "processing_ms": round(processing_ms, 2),
                "error": None,
                "input_size": payload.get("input_size"),
            }
        except Exception as error:
            processing_ms = (time.perf_counter() - started_at) * 1000.0
            return {
                "valid": False,
                "count": self.last_valid_count,
                "density_map": None,
                "processing_ms": round(processing_ms, 2),
                "error": str(error),
                "input_size": None,
            }

    def _validate_density_map(self, density_map: Any, processing_ms: float) -> Optional[str]:
        if density_map is None:
            return "missing_density_map"
        if processing_ms > (CSRNET_TIMEOUT_SECONDS * 1000.0):
            return "csrnet_timeout"

        array = np.asarray(density_map, dtype=np.float32)
        if array.size == 0:
            return "empty_density_map"
        if np.isnan(array).any():
            return "nan_density_map"
        if array.ndim < 2:
            return "invalid_density_map_shape"
        if float(array.sum()) <= 0.0:
            return "zero_density_map"
        return None

    def _select_model(self, yolo_count: int, csrnet_result: Dict[str, Any]) -> Dict[str, Any]:
        if not csrnet_result["valid"]:
            return {"model_used": "YOLO", "count": yolo_count}

        csrnet_count = int(max(csrnet_result["count"], 0))
        if yolo_count <= 0:
            return {"model_used": "CSRNet", "count": csrnet_count}

        if csrnet_count >= yolo_count:
            return {"model_used": "CSRNet", "count": csrnet_count}

        return {"model_used": "YOLO", "count": yolo_count}

    def _fuse_counts(self, yolo_count: int, csrnet_result: Dict[str, Any]) -> int:
        if not csrnet_result["valid"]:
            return max(int(yolo_count), 0)

        csrnet_count = max(int(csrnet_result["count"]), 0)
        if yolo_count <= 0:
            return csrnet_count

        return max(int(yolo_count), csrnet_count)

    def _smooth_count(self, count: int) -> int:
        if count <= 0:
            self.count_window.clear()
            self.count_window.append(0.0)
            return 0

        self.count_window.append(float(max(count, 0)))
        average = sum(self.count_window) / max(len(self.count_window), 1)
        smoothed = max(int(round(average)), 0)
        if self.last_valid_count <= 0:
            return smoothed

        jump_limit = max(5, int(round(self.last_valid_count * 0.35)))
        delta = smoothed - self.last_valid_count
        if abs(delta) > jump_limit:
            return self.last_valid_count + jump_limit if delta > 0 else max(self.last_valid_count - jump_limit, 0)
        return smoothed

    def _predict_future_count(self, count: int) -> Dict[str, Any]:
        self.prediction_window.append(float(max(count, 0)))
        return self.temporal_predictor.predict(list(self.prediction_window), float(count))

    def _derive_risk_level(self, current_count: int, predicted_count: float) -> str:
        projected_growth = max(predicted_count - float(current_count), 0.0)
        if projected_growth >= PREDICTION_RISK_GROWTH_THRESHOLD or current_count >= 130:
            return "high"
        if projected_growth >= (PREDICTION_RISK_GROWTH_THRESHOLD / 2.0) or current_count >= 75:
            return "medium"
        return "low"

    def _summarize_prediction(
        self,
        current_count: int,
        predicted_count: float,
        analytics: Dict[str, Any],
    ) -> Dict[str, Any]:
        density_score = float(analytics.get("crowd_features", {}).get("density_score", 0.0))
        projected_growth = max(predicted_count - float(current_count), 0.0)
        growth_multiplier = 1.0 + min(projected_growth / max(current_count or 1, 1), 0.5)
        density_multiplier = 1.0 + (density_score * 0.35)
        projected_10min = int(round(max(predicted_count, float(current_count)) * growth_multiplier * density_multiplier))

        risk = self._derive_risk_level(current_count, predicted_count)
        if projected_10min >= PREDICTION_HIGH_RISK_COUNT:
            risk = "high"
        elif projected_10min >= PREDICTION_MEDIUM_RISK_COUNT and risk == "low":
            risk = "medium"

        label = (
            f"Prediction ({PREDICTION_HORIZON_MINUTES} min): "
            f"{'HIGH RISK' if risk == 'high' else 'MEDIUM RISK' if risk == 'medium' else 'LOW RISK'}"
        )

        return {
            "projected_count": projected_10min,
            "risk": risk,
            "label": label,
        }

    def _smooth_density_map(self, density_map: np.ndarray) -> np.ndarray:
        current = np.asarray(density_map, dtype=np.float32)
        if current.size == 0 or float(current.max()) <= 0.0:
            self.last_density_map = None
            return np.zeros_like(current, dtype=np.float32)
        if self.last_density_map is None or self.last_density_map.shape != current.shape:
            self.last_density_map = current
            return current

        alpha = min(max(HEATMAP_SMOOTHING, 0.0), 1.0)
        smoothed = ((1.0 - alpha) * self.last_density_map) + (alpha * current)
        self.last_density_map = smoothed.astype(np.float32)
        return self.last_density_map

    def _compact_density_map(self, density_map: np.ndarray) -> List[List[float]]:
        normalized = cv2.normalize(
            density_map,
            None,
            alpha=0.0,
            beta=1.0,
            norm_type=cv2.NORM_MINMAX,
        )
        compact = cv2.resize(
            normalized,
            (DENSITY_MAP_OUTPUT_WIDTH, DENSITY_MAP_OUTPUT_HEIGHT),
        )
        return compact.astype(np.float32).round(4).tolist()

    def _apply_heatmap(self, frame: np.ndarray, density_map: np.ndarray) -> np.ndarray:
        if density_map.size == 0 or float(np.max(density_map)) <= 0.0:
            return frame
        normalized = cv2.normalize(density_map, None, 0.0, 1.0, cv2.NORM_MINMAX)
        thresholded = normalized.copy()
        thresholded[thresholded < HEATMAP_INTENSITY_THRESHOLD] = 0.0
        if float(np.max(thresholded)) <= 0.0:
            return frame
        colored = cv2.applyColorMap((thresholded * 255).astype(np.uint8), cv2.COLORMAP_TURBO)
        alpha = min(max(HEATMAP_BLEND_ALPHA, 0.1), 0.25)
        return cv2.addWeighted(frame, 0.85, colored, alpha, 0)

    def _apply_sparse_heatmap(
        self,
        frame: np.ndarray,
        heatmap_points: List[Dict[str, Any]],
        enabled: bool,
    ) -> np.ndarray:
        if not enabled or not heatmap_points:
            self.last_sparse_heatmap_frame = None
            return frame

        canvas = np.zeros(frame.shape[:2], dtype=np.float32)
        radius = max(int(HEATMAP_RENDER_RADIUS), 4)
        for point in heatmap_points[-160:]:
            x = int(round(point.get("x", 0)))
            y = int(round(point.get("y", 0)))
            if x < 0 or y < 0 or x >= frame.shape[1] or y >= frame.shape[0]:
                continue
            cv2.circle(canvas, (x, y), radius, 1.0, thickness=-1)

        blur_size = max(int(HEATMAP_RENDER_BLUR), 3)
        if blur_size % 2 == 0:
            blur_size += 1
        blurred = cv2.GaussianBlur(canvas, (blur_size, blur_size), 0)
        if float(blurred.max()) <= 0.0:
            self.last_sparse_heatmap_frame = None
            return frame

        normalized = cv2.normalize(blurred, None, 0.0, 1.0, cv2.NORM_MINMAX)
        normalized[normalized < HEATMAP_INTENSITY_THRESHOLD] = 0.0
        if float(normalized.max()) <= 0.0:
            self.last_sparse_heatmap_frame = None
            return frame
        colored = cv2.applyColorMap((normalized * 255).astype(np.uint8), cv2.COLORMAP_TURBO)
        blended = cv2.addWeighted(frame, 0.85, colored, 0.15, 0)
        self.last_sparse_heatmap_frame = blended.copy()
        return blended

    def _reset_heatmap_state(self) -> None:
        self.last_density_map = None
        self.last_sparse_heatmap_frame = None
        self.density_count_window.clear()
        self.density_map_window.clear()

    def _draw_tracks(self, frame: np.ndarray, tracks: List[Dict[str, Any]], enabled: bool) -> np.ndarray:
        canvas = frame.copy()
        if not enabled:
            return canvas
        for track in tracks:
            x1, y1, x2, y2 = track["bbox_xyxy"]
            cv2.rectangle(canvas, (x1, y1), (x2, y2), (0, 255, 0), 2)
            cv2.putText(
                canvas,
                f"ID {track['id']}",
                (x1, max(y1 - 8, 16)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (0, 255, 0),
                2,
                cv2.LINE_AA,
            )
        return canvas

    def _draw_summary(
        self,
        frame: np.ndarray,
        yolo_count: int,
        crowd_count: int,
        density_count: Optional[int],
        mode: str,
    ) -> np.ndarray:
        canvas = frame.copy()
        lines = [
            f"Mode: {mode}",
            f"YOLO Count: {max(int(yolo_count), 0)}",
            f"Final Count: {max(int(crowd_count), 0)}",
            f"CSRNet Count: {max(int(density_count), 0)}" if density_count is not None else "CSRNet Count: N/A",
            f"FPS: {self.fps:.1f}",
        ]
        x = 12
        y = 24
        for line in lines:
            cv2.putText(
                canvas,
                line,
                (x, y),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (30, 30, 30),
                2,
                cv2.LINE_AA,
            )
            cv2.putText(
                canvas,
                line,
                (x, y),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                1,
                cv2.LINE_AA,
            )
            y += 22
        return canvas
