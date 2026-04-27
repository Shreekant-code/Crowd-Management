from threading import Lock
from typing import Any, Dict, List

import cv2
from ultralytics import YOLO


class PersonDetector:
    def __init__(self, model_name: str = "yolov8n.pt", confidence: float = 0.35) -> None:
        self.model = YOLO(model_name)
        self.confidence = max(confidence, 0.4)
        self.nms_threshold = 0.45
        self.lock = Lock()

    def detect(self, frame: Any) -> List[Dict[str, float]]:
        with self.lock:
            results = self.model.predict(
                source=frame,
                classes=[0],
                conf=self.confidence,
                verbose=False,
            )

        raw_detections: List[Dict[str, float]] = []
        boxes = results[0].boxes if results else []
        for box in boxes:
            confidence = float(box.conf[0])
            if confidence <= self.confidence:
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
        return [raw_detections[index] for index in sorted(flattened_indexes)]
