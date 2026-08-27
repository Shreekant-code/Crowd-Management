from __future__ import annotations

import os
from threading import Lock
from typing import Any, Dict, List, Optional
import cv2
import numpy as np

from inference.batched_detector import BatchedHeadDetector
from utils.config import DEBUG_EVERY_N_FRAMES, YOLO_CONFIDENCE

MODELS_DIR = os.path.join(os.path.dirname(__file__), "models")
DEFAULT_YOLO_ONNX = os.path.join(MODELS_DIR, "yolov8n-head.onnx")
DEFAULT_P2PNET_FP16_ONNX = os.path.join(MODELS_DIR, "p2pnet-mobilenet-fp16.onnx")
DEFAULT_P2PNET_ONNX = os.path.join(MODELS_DIR, "p2pnet-mobilenet.onnx")


class PersonDetector:
    """
    DirectML-Accelerated Batched Head & Point Detector on AMD Radeon 610M.
    Uses YOLOv8n Head Detector with focal point generation by default.
    """

    def __init__(
        self,
        model_name: Optional[str] = None,
        confidence: float = 0.25,
        device_id: int = 0,
        anchor_size: int = 40,
    ) -> None:
        if model_name and os.path.exists(model_name) and not str(model_name).endswith(".pt"):
            self.model_path = model_name
        elif os.path.exists(DEFAULT_YOLO_ONNX):
            self.model_path = DEFAULT_YOLO_ONNX
        elif os.path.exists(DEFAULT_P2PNET_FP16_ONNX):
            self.model_path = DEFAULT_P2PNET_FP16_ONNX
        else:
            self.model_path = DEFAULT_YOLO_ONNX

        self.confidence = float(confidence if confidence is not None else YOLO_CONFIDENCE)
        self.anchor_size = anchor_size
        self.lock = Lock()

        print(f"[detector] Initializing PersonDetector with: {self.model_path} (Confidence: {self.confidence})")
        self.batched_detector = BatchedHeadDetector(
            model_path=self.model_path,
            device_id=device_id,
            conf_threshold=self.confidence,
            anchor_size=self.anchor_size,
        )

    @staticmethod
    def _sanitize_frame(frame: Any) -> Optional[np.ndarray]:
        if frame is None:
            return None
        if not hasattr(frame, "shape") or len(frame.shape) < 2:
            return None
        if len(frame.shape) == 2:
            return cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
        return frame

    def detect(self, frame: Any) -> List[Dict[str, Any]]:
        sanitized = self._sanitize_frame(frame)
        if sanitized is None:
            return []

        h, w = sanitized.shape[:2]
        # Resize to 640x640 for detector
        if (w, h) != (640, 640):
            resized = cv2.resize(sanitized, (640, 640))
        else:
            resized = sanitized

        with self.lock:
            batch_results = self.batched_detector.process_camera_batch(
                batch_frames=[resized],
                camera_ids=["single_camera"],
                orig_shapes=[(h, w)],
            )

        res = batch_results.get("single_camera", {})
        detections = res.get("detections", [])

        if DEBUG_EVERY_N_FRAMES > 0:
            print(f"[detector] frame_shape={(h, w)} detections={len(detections)} (DirectML {res.get('dominant_regime', 'SPARSE')})")

        return detections

    def detect_with_regime(self, frame: Any) -> Dict[str, Any]:
        sanitized = self._sanitize_frame(frame)
        if sanitized is None:
            return {
                "count": 0,
                "sparse_count": 0,
                "dense_count": 0,
                "dominant_regime": "SPARSE",
                "density_mode": False,
                "sparse_ratio": 1.0,
                "dense_ratio": 0.0,
                "dense_clusters": [],
                "detections": [],
                "overlap_ratio": 0.0,
                "inference_ms": 0.0,
            }

        h, w = sanitized.shape[:2]
        if (w, h) != (640, 640):
            resized = cv2.resize(sanitized, (640, 640))
        else:
            resized = sanitized

        with self.lock:
            batch_results = self.batched_detector.process_camera_batch(
                batch_frames=[resized],
                camera_ids=["single_camera"],
                orig_shapes=[(h, w)],
            )

        return batch_results.get("single_camera", {})

    def detect_batch(
        self,
        frames: List[np.ndarray],
        camera_ids: List[str],
        orig_shapes: Optional[List[tuple]] = None,
    ) -> Dict[str, Dict[str, Any]]:
        with self.lock:
            return self.batched_detector.process_camera_batch(
                batch_frames=frames,
                camera_ids=camera_ids,
                orig_shapes=orig_shapes,
            )
