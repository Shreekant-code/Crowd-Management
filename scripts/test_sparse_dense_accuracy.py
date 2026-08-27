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
from utils.analytics import AnalyticsEngine
from utils.density_analyzer import SpatialDensityAnalyzer
from advanced_models.csrnet import CSRNetDensityEstimator


def test_sparse_dense_accuracy():
    print("==========================================================================")
    print("  EVALUATION 1: Spatial Density Analyzer & Regime Classifier")
    print("==========================================================================")
    analyzer = SpatialDensityAnalyzer()

    # Case A: Sparse crowd (4 isolated individuals spread far apart)
    sparse_detections = [
        {"id": 1, "point": [200, 200], "bbox": [180, 180, 40, 40], "confidence": 0.88},
        {"id": 2, "point": [1600, 250], "bbox": [1580, 230, 40, 40], "confidence": 0.92},
        {"id": 3, "point": [350, 850], "bbox": [330, 830, 40, 40], "confidence": 0.85},
        {"id": 4, "point": [1500, 900], "bbox": [1480, 880, 40, 40], "confidence": 0.90},
    ]
    sparse_result = analyzer.analyze_detections(sparse_detections, frame_shape=(1080, 1920))
    print(f"  Sparse Scene Result: dominant_regime={sparse_result['dominant_regime']}, sparse_count={sparse_result['sparse_count']}, dense_count={sparse_result['dense_count']}")
    assert sparse_result["dominant_regime"] == "SPARSE", f"Expected SPARSE, got {sparse_result['dominant_regime']}"
    assert sparse_result["sparse_count"] == 4, f"Expected 4 sparse, got {sparse_result['sparse_count']}"
    assert sparse_result["dense_count"] == 0, f"Expected 0 dense, got {sparse_result['dense_count']}"
    print("  [PASS] Sparse regime correctly identified with 100% precision.")

    # Case B: Dense crowd (45 tightly packed heads in a 300x300 hotspot)
    dense_detections = []
    det_id = 1
    for r in range(6):
        for c in range(8):
            # Dense cluster with 25px spacing
            px = 400 + c * 24 + np.random.randint(-3, 4)
            py = 350 + r * 24 + np.random.randint(-3, 4)
            dense_detections.append({
                "id": det_id,
                "point": [px, py],
                "bbox": [px - 11, py - 11, 22, 22],
                "confidence": 0.78,
            })
            det_id += 1

    dense_result = analyzer.analyze_detections(dense_detections, frame_shape=(1080, 1920))
    print(f"  Dense Scene Result: dominant_regime={dense_result['dominant_regime']}, sparse_count={dense_result['sparse_count']}, dense_count={dense_result['dense_count']}, clusters={len(dense_result['dense_clusters'])}")
    assert dense_result["dominant_regime"] == "DENSE", f"Expected DENSE, got {dense_result['dominant_regime']}"
    assert dense_result["dense_count"] >= 40, f"Expected >= 40 dense, got {dense_result['dense_count']}"
    assert len(dense_result["dense_clusters"]) >= 1, "Expected at least 1 dense cluster"
    print("  [PASS] Dense crowd cluster accurately classified and clustered.")

    # Case C: Mixed Scene (Dense cluster of 30 on Left, 3 Sparse on Right)
    mixed_detections = []
    # Left dense cluster
    for r in range(5):
        for c in range(6):
            px = 250 + c * 22
            py = 300 + r * 22
            mixed_detections.append({"id": len(mixed_detections), "point": [px, py], "bbox": [px-11, py-11, 22, 22], "confidence": 0.75})
    # Right sparse individuals
    mixed_detections.append({"id": len(mixed_detections), "point": [1600, 200], "bbox": [1580, 180, 40, 40], "confidence": 0.90})
    mixed_detections.append({"id": len(mixed_detections), "point": [1750, 600], "bbox": [1730, 580, 40, 40], "confidence": 0.88})
    mixed_detections.append({"id": len(mixed_detections), "point": [1650, 900], "bbox": [1630, 880, 40, 40], "confidence": 0.85})

    mixed_result = analyzer.analyze_detections(mixed_detections, frame_shape=(1080, 1920))
    print(f"  Mixed Scene Result: dominant_regime={mixed_result['dominant_regime']}, sparse_count={mixed_result['sparse_count']}, dense_count={mixed_result['dense_count']}")
    assert mixed_result["sparse_count"] == 3, f"Expected 3 sparse, got {mixed_result['sparse_count']}"
    assert mixed_result["dense_count"] == 30, f"Expected 30 dense, got {mixed_result['dense_count']}"
    print("  [PASS] Mixed scene accurately separated into sparse (3) and dense (30) regions.")

    print("\n==========================================================================")
    print("  EVALUATION 2: DirectML Batched Detector Dual-Regime Execution")
    print("==========================================================================")
    detector = PersonDetector()
    frame = np.zeros((1080, 1920, 3), dtype=np.uint8)

    t0 = time.perf_counter()
    regime_output = detector.detect_with_regime(frame)
    latency = (time.perf_counter() - t0) * 1000.0

    print(f"  Execution Latency: {latency:.2f} ms")
    print(f"  Dominant Regime: {regime_output.get('dominant_regime')}")
    print(f"  Sparse Count: {regime_output.get('sparse_count')}")
    print(f"  Dense Count: {regime_output.get('dense_count')}")
    assert "sparse_count" in regime_output, "Missing sparse_count in detector output"
    assert "dense_count" in regime_output, "Missing dense_count in detector output"
    assert "dominant_regime" in regime_output, "Missing dominant_regime in detector output"
    print("  [PASS] DirectML Detector correctly reports dual-regime telemetry.")

    print("\n==========================================================================")
    print("  EVALUATION 3: CSRNet Noise-Floor Clamping & Peak Extraction")
    print("==========================================================================")
    csrnet = CSRNetDensityEstimator()
    if csrnet.enabled:
        blank_frame = np.zeros((480, 640, 3), dtype=np.uint8)
        blank_result = csrnet.infer(blank_frame)
        print(f"  Blank Frame Density Integral: {blank_result.get('integral_sum')} (Count: {blank_result.get('count')})")
        assert blank_result.get("count", 0) == 0, "Expected 0 count on blank frame with noise-floor clamping"
        print("  [PASS] Background noise floor successfully eliminates phantom counts in sparse scenes.")
    else:
        print("  [SKIP] CSRNet not enabled on this environment.")

    print("\n==========================================================================")
    print("  EVALUATION 4: Full Pipeline Stream Result Telemetry Verification")
    print("==========================================================================")
    analytics = AnalyticsEngine()
    stream_out = analytics.build_stream_result(
        tracks=mixed_detections,
        detections=mixed_detections,
        count=33,
        sparse_count=3,
        dense_count=30,
        dominant_regime="MODERATE",
    )
    print(f"  Total Count: {stream_out['people_count']}")
    print(f"  Sparse Count: {stream_out['sparse_count']}")
    print(f"  Dense Count: {stream_out['dense_count']}")
    print(f"  Dominant Regime: {stream_out['dominant_regime']}")
    print(f"  Risk Level: {stream_out['risk']}")
    assert stream_out["people_count"] == 33
    assert stream_out["sparse_count"] == 3
    assert stream_out["dense_count"] == 30
    assert stream_out["dominant_regime"] == "MODERATE"
    print("  [PASS] AnalyticsEngine builds rich sparse/dense telemetry payload.")

    print("\n==========================================================================")
    print("  ALL SPARSE & DENSE CROWD ACCURACY TESTS PASSED PERFECTLY!")
    print("==========================================================================")


if __name__ == "__main__":
    test_sparse_dense_accuracy()
