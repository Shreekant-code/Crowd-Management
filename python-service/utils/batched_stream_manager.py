from __future__ import annotations

import os
import threading
import time
from typing import Any, Dict, List, Optional
import numpy as np
import requests

from advanced_models.forecaster import CrowdForecaster
from detector import PersonDetector
from tracker import PersonTracker
from utils.analytics import AnalyticsEngine
from utils.config import (
    DEBUG_EVERY_N_FRAMES,
    STREAM_RECONNECT_DELAY_SECONDS,
    STREAM_TARGET_FPS,
)
from utils.gst_ingestor import GstFrameIngestor


class BatchedStreamManager:
    """
    Centralized Multi-Stream Cadence & MobileNetV3-P2PNet DirectML Manager.
    
    1. Holds all active camera stream ingestors (GstFrameIngestor).
    2. Runs a single unified 2 FPS cadence loop (500 ms per cycle).
    3. Batches all active frames into a single tensor (Batch=N, 3, 640, 640).
    4. Executes single-pass P2PNet inference on AMD Radeon 610M (DirectML).
    5. Computes 1D temporal forecasts (<0.05 ms) per stream with isolated history.
    6. Pushes a single consolidated JSON telemetry payload to Express backend.
    """

    def __init__(self, backend_url: Optional[str] = None) -> None:
        self.backend_url = backend_url or os.getenv("BACKEND_URL", "http://localhost:4000")
        self.streams: Dict[str, Dict[str, Any]] = {}
        self.trackers: Dict[str, PersonTracker] = {}
        self.analytics: Dict[str, AnalyticsEngine] = {}
        self.forecasters: Dict[str, CrowdForecaster] = {}
        self.latest_telemetry: Dict[str, Dict[str, Any]] = {}
        
        self.detector = PersonDetector()
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        
        self.cadence_interval = 1.0 / max(float(STREAM_TARGET_FPS), 1.0)
        self.worker_thread = threading.Thread(target=self._cadence_loop, daemon=True, name="batched-cadence-worker")
        self.worker_thread.start()
        print(f"[batched-manager] Cadence loop started at {STREAM_TARGET_FPS} FPS (P2PNet Engine) -> Backend: {self.backend_url}")

    def start_camera(self, camera_id: str, stream_url: str, user_id: Optional[str] = None, zone_name: Optional[str] = None) -> Dict[str, Any]:
        with self.lock:
            if camera_id in self.streams:
                print(f"[batched-manager] Camera already active: {camera_id}")
                return {"status": "already_active", "camera_id": camera_id}

            print(f"[batched-manager] Initializing camera {camera_id} ({stream_url})")
            ingestor = GstFrameIngestor(
                rtsp_url=stream_url,
                width=640,
                height=640,
                fps=float(STREAM_TARGET_FPS),
            )
            ingestor.start()

            self.streams[camera_id] = {
                "camera_id": camera_id,
                "stream_url": stream_url,
                "user_id": user_id or "default-user",
                "zone_name": zone_name or "Main Zone",
                "ingestor": ingestor,
                "started_at": time.time(),
                "frame_count": 0,
            }
            self.trackers[camera_id] = PersonTracker()
            self.analytics[camera_id] = AnalyticsEngine()
            self.forecasters[camera_id] = CrowdForecaster(
                sequence_length=30,
                horizon_minutes=10.0,
                fps=float(STREAM_TARGET_FPS),
                l2_alpha=1.5,
                ema_beta=0.7,
                max_venue_capacity=250,
            )
            
            return {"status": "started", "camera_id": camera_id, "mode": ingestor.mode}

    def stop_camera(self, camera_id: str) -> Dict[str, Any]:
        with self.lock:
            stream_info = self.streams.pop(camera_id, None)
            self.trackers.pop(camera_id, None)
            self.analytics.pop(camera_id, None)
            self.forecasters.pop(camera_id, None)
            self.latest_telemetry.pop(camera_id, None)

            if stream_info:
                try:
                    stream_info["ingestor"].stop()
                except Exception as err:
                    print(f"[batched-manager] Error stopping ingestor for {camera_id}: {err}")
                print(f"[batched-manager] Camera stopped and removed: {camera_id}")
                return {"status": "stopped", "camera_id": camera_id}
            
            return {"status": "not_found", "camera_id": camera_id}

    def get_camera_stats(self, camera_id: str) -> Optional[Dict[str, Any]]:
        with self.lock:
            return self.latest_telemetry.get(camera_id)

    def get_active_camera_ids(self) -> List[str]:
        with self.lock:
            return list(self.streams.keys())

    def _cadence_loop(self) -> None:
        http_session = requests.Session()
        telemetry_endpoint = f"{self.backend_url}/internal/telemetry/batch"

        while not self.stop_event.is_set():
            start_t = time.perf_counter()
            
            frames: List[np.ndarray] = []
            camera_ids: List[str] = []
            
            with self.lock:
                for cam_id, info in list(self.streams.items()):
                    frame = info["ingestor"].get_latest_frame()
                    if frame is not None:
                        frames.append(frame)
                        camera_ids.append(cam_id)
                        info["frame_count"] += 1

            if frames:
                try:
                    # 1. Single-Pass Batched DirectML Dispatch (B=1..4)
                    batch_results = self.detector.detect_batch(
                        frames=frames,
                        camera_ids=camera_ids,
                    )

                    # 2. Vectorized Tracker, Analytics & 1D Forecasting Updates
                    batch_telemetry: Dict[str, Dict[str, Any]] = {}
                    
                    with self.lock:
                        for cam_id in camera_ids:
                            res = batch_results.get(cam_id, {})
                            detections = res.get("detections", [])
                            tracker = self.trackers.get(cam_id)
                            analytics = self.analytics.get(cam_id)
                            forecaster = self.forecasters.get(cam_id)
                            info = self.streams.get(cam_id, {})

                            if tracker and analytics:
                                tracks = tracker.update(detections)
                                count = res.get("count", len(tracks))

                                metrics = analytics.build_stream_result(
                                    tracks=tracks,
                                    detections=detections,
                                    count=count,
                                    density_mode=res.get("density_mode", False),
                                    overlap_ratio=res.get("overlap_ratio", 0.0),
                                    sparse_count=res.get("sparse_count"),
                                    dense_count=res.get("dense_count"),
                                    dominant_regime=res.get("dominant_regime"),
                                    dense_clusters=res.get("dense_clusters"),
                                    regime_breakdown=res.get("regime_breakdown"),
                                )

                                # 1D Temporal Forecast (<0.05 ms)
                                if forecaster:
                                    forecast = forecaster.update_and_forecast(count)
                                    metrics["prediction_10min_count"] = forecast["predicted_count"]
                                    metrics["prediction_10min_risk"] = forecast["predicted_risk"]
                                    metrics["prediction_10min_label"] = f"Prediction (10 min): {forecast['predicted_risk']} RISK"
                                    metrics["trend_direction"] = forecast["trend_direction"]
                                    metrics["growth_rate_per_min"] = forecast["growth_rate_per_min"]
                                    metrics["forecaster_latency_ms"] = forecast["latency_ms"]

                                metrics["camera_id"] = cam_id
                                metrics["userId"] = info.get("user_id")
                                metrics["zoneName"] = info.get("zone_name")
                                metrics["inference_ms"] = res.get("inference_ms", 25)
                                metrics["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

                                batch_telemetry[cam_id] = metrics
                                self.latest_telemetry[cam_id] = metrics

                    # 3. Fire-and-Forget Push to Express Backend
                    payload = {
                        "timestamp": time.time(),
                        "camera_data": batch_telemetry,
                    }

                    try:
                        resp = http_session.post(
                            telemetry_endpoint,
                            json=payload,
                            timeout=0.45,
                            headers={"Content-Type": "application/json"},
                        )
                    except requests.RequestException:
                        pass  # Backend down or busy; keep AI cadence running

                except Exception as err:
                    print(f"[batched-manager] Cadence processing exception: {err}")

            # Enforce exact 2 FPS hardware decimation cadence (500 ms interval)
            elapsed = time.perf_counter() - start_t
            sleep_time = max(0.01, self.cadence_interval - elapsed)
            time.sleep(sleep_time)

    def shutdown(self) -> None:
        self.stop_event.set()
        with self.lock:
            for cam_id, info in self.streams.items():
                try:
                    info["ingestor"].stop()
                except Exception:
                    pass
            self.streams.clear()
            self.trackers.clear()
            self.analytics.clear()
            self.forecasters.clear()
            self.latest_telemetry.clear()
        print("[batched-manager] Shutdown complete.")
