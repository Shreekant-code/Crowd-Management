from dataclasses import dataclass
from typing import Dict, List

import numpy as np

from utils.config import TRACK_MIN_HITS


def compute_iou(box_a: np.ndarray, box_b: np.ndarray) -> float:
    x1 = max(float(box_a[0]), float(box_b[0]))
    y1 = max(float(box_a[1]), float(box_b[1]))
    x2 = min(float(box_a[2]), float(box_b[2]))
    y2 = min(float(box_a[3]), float(box_b[3]))

    inter_w = max(0.0, x2 - x1)
    inter_h = max(0.0, y2 - y1)
    intersection = inter_w * inter_h
    if intersection <= 0.0:
        return 0.0

    area_a = max(0.0, float(box_a[2] - box_a[0])) * max(0.0, float(box_a[3] - box_a[1]))
    area_b = max(0.0, float(box_b[2] - box_b[0])) * max(0.0, float(box_b[3] - box_b[1]))
    union = area_a + area_b - intersection
    if union <= 0.0:
        return 0.0

    return intersection / union


@dataclass
class TrackState:
    track_id: int
    bbox_xyxy: np.ndarray
    hits: int = 1
    misses: int = 0
    confidence: float = 0.0


class PersonTracker:
    def __init__(self, max_age: int = 12, min_hits: int = TRACK_MIN_HITS, iou_threshold: float = 0.3) -> None:
        self.max_age = max_age
        self.min_hits = min_hits
        self.iou_threshold = iou_threshold
        self.smoothing = 0.65
        self.next_track_id = 1
        self.tracks: List[TrackState] = []

    def update(self, detections: List[Dict[str, float]]) -> List[Dict[str, int]]:
        if not detections:
            for track in self.tracks:
                track.misses += 1
            self.tracks = [track for track in self.tracks if track.misses <= self.max_age]
            return []

        detection_boxes = np.array([item["bbox_xyxy"] for item in detections], dtype=np.float32)
        detection_scores = np.array([item["confidence"] for item in detections], dtype=np.float32)

        matches: List[tuple[int, int]] = []
        unmatched_tracks = set(range(len(self.tracks)))
        unmatched_detections = set(range(len(detections)))

        candidate_pairs: List[tuple[float, int, int]] = []
        for track_index, track in enumerate(self.tracks):
            for detection_index, detection_box in enumerate(detection_boxes):
                iou = compute_iou(track.bbox_xyxy, detection_box)
                if iou >= self.iou_threshold:
                    candidate_pairs.append((iou, track_index, detection_index))

        candidate_pairs.sort(reverse=True, key=lambda item: item[0])
        for _, track_index, detection_index in candidate_pairs:
            if track_index not in unmatched_tracks or detection_index not in unmatched_detections:
                continue
            unmatched_tracks.remove(track_index)
            unmatched_detections.remove(detection_index)
            matches.append((track_index, detection_index))

        for track_index, detection_index in matches:
            track = self.tracks[track_index]
            detected_box = detection_boxes[detection_index]
            track.bbox_xyxy = (
                (1.0 - self.smoothing) * track.bbox_xyxy
                + self.smoothing * detected_box
            ).astype(np.float32)
            track.hits += 1
            track.misses = 0
            track.confidence = float(detection_scores[detection_index])

        for track_index in unmatched_tracks:
            self.tracks[track_index].misses += 1

        for detection_index in unmatched_detections:
            self.tracks.append(
                TrackState(
                    track_id=self.next_track_id,
                    bbox_xyxy=detection_boxes[detection_index].copy(),
                    hits=1,
                    misses=0,
                    confidence=float(detection_scores[detection_index]),
                )
            )
            self.next_track_id += 1

        self.tracks = [track for track in self.tracks if track.misses <= self.max_age]

        items: List[Dict[str, int]] = []
        for track in self.tracks:
            if track.misses > 0 or track.hits < self.min_hits:
                continue

            x1, y1, x2, y2 = [int(round(value)) for value in track.bbox_xyxy.tolist()]
            x1 = max(x1, 0)
            y1 = max(y1, 0)
            x2 = max(x2, x1)
            y2 = max(y2, y1)
            items.append(
                {
                    "id": int(track.track_id),
                    "bbox": [x1, y1, max(x2 - x1, 0), max(y2 - y1, 0)],
                    "bbox_xyxy": [x1, y1, x2, y2],
                    "center": [int((x1 + x2) / 2), int((y1 + y2) / 2)],
                }
            )

        items.sort(key=lambda item: item["id"])
        return items
