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
DEFAULT_MOBILECOUNT_ONNX = os.path.join(MODELS_DIR, "mobilecount.onnx")


class PersonDetector:
    """
    DirectML-Accelerated Batched Head Detector on AMD Radeon 610M.
    """

    def __init__(
        self,
        model_name: str = DEFAULT_YOLO_ONNX,
        confidence: float = YOLO_CONFIDENCE,
        device_id: int = 0,
    ) -> None:
        if not model_name or not os.path.exists(model_name) or str(model_name).endswith(".pt"):
            self.yolo_path = DEFAULT_YOLO_ONNX
        else:
            self.yolo_path = model_name
        self.mobilecount_path = DEFAULT_MOBILECOUNT_ONNX
        self.confidence = float(confidence)
        self.lock = Lock()

        print(f"[detector] Initializing BatchedHeadDetector with: {self.yolo_path}")
        self.batched_detector = BatchedHeadDetector(
            yolo_model_path=self.yolo_path,
            mobilecount_model_path=self.mobilecount_path if os.path.exists(self.mobilecount_path) else None,
            device_id=device_id,
            conf_threshold=self.confidence,
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
            print(f"[detector] frame_shape={(h, w)} detections={len(detections)} (DirectML)")

        return detections

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
