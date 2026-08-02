from threading import Lock
from typing import Any, Dict, List

import cv2
from ultralytics import YOLO

from advanced_models.model_loader import get_torch_device
from utils.config import YOLO_IMAGE_SIZE


class PersonDetector:
    def __init__(self, model_name: str = "yolov8n.pt", confidence: float = 0.35) -> None:
        self.model = YOLO(model_name)
        self.confidence = min(max(float(confidence), 0.05), 0.95)
        self.nms_threshold = 0.45
        self.image_size = max(int(YOLO_IMAGE_SIZE), 320)
        self.device = get_torch_device()
        self.lock = Lock()

    @staticmethod
    def _sanitize_frame(frame: Any) -> Any:
        if frame is None:
            return None
        if not hasattr(frame, "shape") or len(frame.shape) < 2:
            return None
        if len(frame.shape) == 2:
            return cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)
        return frame

    def detect(self, frame: Any) -> List[Dict[str, float]]:
        frame = self._sanitize_frame(frame)
        if frame is None:
            return []

        with self.lock:
            results = self.model.predict(
                source=frame,
                classes=[0],
                conf=self.confidence,
                iou=self.nms_threshold,
                device=self.device,
                half=self.device.startswith("cuda"),
                imgsz=self.image_size,
                agnostic_nms=False,
                max_det=1000,
                verbose=False,
            )

        raw_detections: List[Dict[str, float]] = []
        boxes = results[0].boxes if results else []
        for box in boxes:
            confidence = float(box.conf[0])
            if confidence < self.confidence:
                continue

            x1, y1, x2, y2 = [float(value) for value in box.xyxy[0].tolist()]
            raw_detections.append(
                {
                    "bbox_xyxy": [x1, y1, x2, y2],
                    "confidence": confidence,
                }
            )

        if not raw_detections:
            return []

        nms_boxes = []
        scores = []
        for detection in raw_detections:
            x1, y1, x2, y2 = detection["bbox_xyxy"]
            nms_boxes.append(
                [
                    int(round(x1)),
                    int(round(y1)),
                    max(int(round(x2 - x1)), 1),
                    max(int(round(y2 - y1)), 1),
                ]
            )
            scores.append(float(detection["confidence"]))

        kept_indexes = cv2.dnn.NMSBoxes(
            bboxes=nms_boxes,
            scores=scores,
            score_threshold=self.confidence,
            nms_threshold=self.nms_threshold,
        )
        if kept_indexes is None or len(kept_indexes) == 0:
            return []

        flattened_indexes = {
            int(index[0] if hasattr(index, "__len__") else index)
            for index in kept_indexes
        }
        final_detections = [raw_detections[index] for index in sorted(flattened_indexes)]
        print(
            f"[detector] frame_shape={getattr(frame, 'shape', None)} "
            f"detections={len(final_detections)}"
        )
        return final_detections
