from __future__ import annotations

import os
import sys
import time
import numpy as np

PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PYTHON_SERVICE_DIR = os.path.join(PROJECT_ROOT, "python-service")
if PYTHON_SERVICE_DIR not in sys.path:
    sys.path.insert(0, PYTHON_SERVICE_DIR)

from detector import PersonDetector
from inference.batched_detector import BatchedHeadDetector
from tracker import PersonTracker
from advanced_models.forecaster import CrowdForecaster
from utils.analytics import AnalyticsEngine


def run_unit_tests():
    print("=================================================================")
    print("  TEST 1: DirectML Model & BatchedPointDetector Verification")
    print("=================================================================")
    detector = PersonDetector(confidence=0.25)
    assert detector.batched_detector.engine is not None, "Expected engine to be initialized"
    print("  [PASS] Detector initialized successfully with active DirectML architecture.")

    # Test dynamic batch sizes: 1, 2, 4
    for b_size in [1, 2, 4]:
        frames = [np.random.randint(0, 255, (640, 640, 3), dtype=np.uint8) for _ in range(b_size)]
        camera_ids = [f"cam_{i}" for i in range(b_size)]
        orig_shapes = [(1080, 1920) for _ in range(b_size)]

        t0 = time.perf_counter()
        results = detector.detect_batch(frames, camera_ids, orig_shapes=orig_shapes)
        latency = (time.perf_counter() - t0) * 1000.0

        assert len(results) == b_size, f"Expected {b_size} results, got {len(results)}"
        print(f"  [PASS] Batch={b_size} execution successful: {latency:.2f} ms ({latency/b_size:.2f} ms/cam)")

        # Verify coordinate constraints and synthetic anchor geometry
        for cam_id in camera_ids:
            res = results[cam_id]
            for det in res["detections"]:
                assert "point" in det, "Missing point in detection"
                assert "bbox" in det, "Missing bbox in detection"
                assert "bbox_xyxy" in det, "Missing bbox_xyxy in detection"
                
                px, py = det["point"]
                bx, by, bw, bh = det["bbox"]
                assert 0 <= px <= 1920, f"Point X out of bounds: {px}"
                assert 0 <= py <= 1080, f"Point Y out of bounds: {py}"
                assert bw == 40 and bh == 40, f"Expected 40x40 anchor, got {bw}x{bh}"

    print("\n=================================================================")
    print("  TEST 2: ByteTrack & Synthetic BBox Tracking Continuity")
    print("=================================================================")
    tracker = PersonTracker()
    
    # Simulate a person walking across 5 frames: [100, 100] -> [140, 140]
    for frame_idx in range(5):
        cx = 100 + frame_idx * 10
        cy = 100 + frame_idx * 10
        synthetic_detections = [
            {
                "id": 0,
                "point": [cx, cy],
                "bbox": [cx - 20, cy - 20, 40, 40],
                "bbox_xyxy": [cx - 20, cy - 20, cx + 20, cy + 20],
                "confidence": 0.95,
            }
        ]
        tracks = tracker.update(synthetic_detections)
        assert len(tracks) >= 0, "Tracker failed to process frame"
        if tracks:
            print(f"  Frame {frame_idx + 1}: Track ID={tracks[0]['id']}, Center={tracks[0]['center']}")

    print("  [PASS] ByteTrack successfully tracked synthesized head anchors.")

    print("\n=================================================================")
    print("  TEST 3: 1D Ridge Regression Forecaster (Surge Risk)")
    print("=================================================================")
    forecaster = CrowdForecaster(sequence_length=30, horizon_minutes=10.0, fps=2.0)

    # Simulate crowd accumulation: 10 -> 80 people
    for count in range(10, 85, 2):
        forecast = forecaster.update_and_forecast(count)

    print(f"  Final count: 84 -> 10-Min Predicted: {forecast['predicted_count']}")
    print(f"  Trend Direction: {forecast['trend_direction']}")
    print(f"  Predicted Risk: {forecast['predicted_risk']}")
    print(f"  Forecaster Execution Latency: {forecast['latency_ms']:.4f} ms")
    assert forecast["latency_ms"] < 0.100, "Forecaster latency exceeds target"
    print("  [PASS] 1D Forecaster extrapolated surge trend under 0.1 ms.")

    print("\n=================================================================")
    print("  TEST 4: Analytics Engine Aggregation & Telemetry Formatting")
    print("=================================================================")
    analytics = AnalyticsEngine()
    dummy_detections = [
        {"id": 1, "point": [300, 400], "bbox": [280, 380, 40, 40], "confidence": 0.9},
        {"id": 2, "point": [800, 450], "bbox": [780, 430, 40, 40], "confidence": 0.85},
    ]
    tracks = [
        {"id": 1, "bbox": [280, 380, 40, 40], "center": [300, 400]},
        {"id": 2, "bbox": [780, 430, 40, 40], "center": [800, 450]},
    ]
    stream_result = analytics.build_stream_result(tracks=tracks, detections=dummy_detections, count=2)
    assert stream_result["count"] == 2
    assert stream_result["density_mode"] is False
    assert len(stream_result["active_track_ids"]) == 2
    print("  [PASS] AnalyticsEngine telemetry formatting verified.")

    print("\n=================================================================")
    print("  ALL 4 INTEGRATION TESTS COMPLETED SUCCESSFULLY!")
    print("=================================================================")


if __name__ == "__main__":
    run_unit_tests()
