from __future__ import annotations

import os
from typing import Any, Dict, List, Optional
import cv2
import numpy as np

from inference.dml_engine import DirectMLInferenceEngine
from utils.config import (
    CSRNET_INPUT_HEIGHT,
    CSRNET_INPUT_WIDTH,
    DENSE_COUNT_THRESHOLD,
    DENSITY_MAP_OUTPUT_HEIGHT,
    DENSITY_MAP_OUTPUT_WIDTH,
)

MODELS_DIR = os.path.join(os.path.dirname(__file__), "..", "models")
DEFAULT_MOBILECOUNT_PATH = os.path.join(MODELS_DIR, "mobilecount.onnx")


class CSRNetDensityEstimator:
    """
    DirectML-Accelerated Lightweight Density Estimator (MobileCount).
    Replaces the heavy legacy VGG-16 PyTorch CSRNet implementation.
    """

    def __init__(self, model_path: str = DEFAULT_MOBILECOUNT_PATH) -> None:
        self.model_path = model_path
        self.engine: Optional[DirectMLInferenceEngine] = None
        self.enabled = False
        self.load_error: Optional[str] = None

        try:
            if os.path.exists(self.model_path):
                self.engine = DirectMLInferenceEngine(self.model_path, device_id=0)
                self.enabled = True
            else:
                self.load_error = f"Model not found at: {self.model_path}"
        except Exception as err:
            self.load_error = str(err)
            print(f"[density-estimator] DirectML initialization warning: {err}")

    def _build_default(self, tracks: List[Dict], current_count: int, used_density: bool = False) -> Dict:
        return {
            "density_count": int(max(current_count, 0)),
            "density_map": [],
            "density_context": {
                "model": "MobileCount-DirectML",
                "enabled": self.enabled,
                "used_density": used_density,
                "track_count": len(tracks),
                "load_error": self.load_error,
            },
        }

    def infer(self, frame: Any) -> Dict[str, Any]:
        if frame is None:
            raise ValueError("frame is required")
        if not self.enabled or self.engine is None:
            raise RuntimeError(self.load_error or "density_engine_unavailable")

        # Prepare 640x640 tensor
        resized = cv2.resize(frame, (640, 640))
        chw = np.transpose(resized.astype(np.float32) / 255.0, (2, 0, 1))
        batch_tensor = np.expand_dims(chw, axis=0)

        output = self.engine.infer_batch(batch_tensor)
        density_array = np.squeeze(output)

        count = max(int(round(float(density_array.sum()))), 0)
        h, w = frame.shape[:2]
        resized_density = cv2.resize(density_array, (w, h), interpolation=cv2.INTER_CUBIC)

        return {
            "count": count,
            "density_map": np.maximum(resized_density, 0.0).astype(np.float32),
            "input_size": [640, 640],
        }

    def predict(self, frame: Any, tracks: List[Dict], current_count: int) -> Dict:
        default = self._build_default(tracks, current_count, used_density=False)
        if frame is None or not self.enabled or self.engine is None:
            return default

        try:
            h, w = frame.shape[:2]
            res = self.infer(frame)
            density_count = res["count"]
            density_map = res["density_map"]

            normalized_density = cv2.normalize(
                density_map,
                None,
                alpha=0.0,
                beta=1.0,
                norm_type=cv2.NORM_MINMAX,
            )
            compact_map = cv2.resize(
                normalized_density,
                (DENSITY_MAP_OUTPUT_WIDTH, DENSITY_MAP_OUTPUT_HEIGHT),
            )

            return {
                "density_count": max(density_count, 0),
                "density_map": compact_map.astype(np.float32).round(4).tolist(),
                "density_context": {
                    "model": "MobileCount-DirectML",
                    "enabled": True,
                    "used_density": True,
                    "track_count": len(tracks),
                    "input_size": [640, 640],
                    "frame_size": [w, h],
                    "map_size": [DENSITY_MAP_OUTPUT_WIDTH, DENSITY_MAP_OUTPUT_HEIGHT],
                    "load_error": None,
                },
            }
        except Exception as error:
            fallback = self._build_default(tracks, current_count, used_density=False)
            fallback["density_context"]["runtime_error"] = str(error)
            return fallback
