from typing import Dict, List

import numpy as np

from utils.config import DEBUG_EVERY_N_FRAMES, STREAM_TARGET_FPS

try:
    import supervision as sv
except Exception:  # pragma: no cover - fallback path when supervision is unavailable
    sv = None


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


class PersonTracker:
    def __init__(self, iou_threshold: float = 0.3) -> None:
        self.iou_threshold = iou_threshold
        self.next_track_id = 1
        self.tracks: List[Dict[str, np.ndarray | int | float]] = []
        self.bytetrack = (
            sv.ByteTrack(
                track_activation_threshold=0.25,
                lost_track_buffer=max(int(round(STREAM_TARGET_FPS * 2)), 30),
                minimum_matching_threshold=0.75,
                frame_rate=max(int(round(STREAM_TARGET_FPS)), 15),
                minimum_consecutive_frames=1,
            )
            if sv is not None
            else None
        )

    def reset(self) -> None:
        self.next_track_id = 1
        self.tracks = []
        if sv is not None:
            self.bytetrack = sv.ByteTrack(
                track_activation_threshold=0.25,
                lost_track_buffer=max(int(round(STREAM_TARGET_FPS * 2)), 30),
                minimum_matching_threshold=0.75,
                frame_rate=max(int(round(STREAM_TARGET_FPS)), 15),
                minimum_consecutive_frames=1,
            )
        else:
            self.bytetrack = None

    def update(self, detections: List[Dict[str, float]]) -> List[Dict[str, int]]:
        if self.bytetrack is not None:
            try:
                return self._update_bytetrack(detections)
            except Exception:
                # Fall back to the lightweight tracker if ByteTrack fails at runtime.
                self.bytetrack = None

        return self._update_fallback(detections)

    def _update_bytetrack(self, detections: List[Dict[str, float]]) -> List[Dict[str, int]]:
        if not detections:
            empty_xyxy = np.empty((0, 4), dtype=np.float32)
            empty_conf = np.empty((0,), dtype=np.float32)
            tracked = self.bytetrack.update_with_detections(
                sv.Detections(
                    xyxy=empty_xyxy,
                    confidence=empty_conf,
                    class_id=np.empty((0,), dtype=np.int32),
                )
            )
            return self._serialize_supervision(tracked)

        xyxy = np.array([item["bbox_xyxy"] for item in detections], dtype=np.float32)
        confidence = np.array([item["confidence"] for item in detections], dtype=np.float32)
        class_id = np.zeros((len(detections),), dtype=np.int32)
        tracked = self.bytetrack.update_with_detections(
            sv.Detections(xyxy=xyxy, confidence=confidence, class_id=class_id)
        )
        return self._serialize_supervision(tracked)

    def _serialize_supervision(self, tracked) -> List[Dict[str, int]]:
        if tracked is None:
            return []

        xyxy = np.asarray(getattr(tracked, "xyxy", np.empty((0, 4))), dtype=np.float32)
        tracker_ids = getattr(tracked, "tracker_id", None)
        if tracker_ids is None:
            return []

        ids = np.asarray(tracker_ids)
        items: List[Dict[str, int]] = []
        for box, tracker_id in zip(xyxy, ids):
            if tracker_id is None:
                continue

            x1, y1, x2, y2 = [int(round(value)) for value in box.tolist()]
            x1 = max(x1, 0)
            y1 = max(y1, 0)
            x2 = max(x2, x1)
            y2 = max(y2, y1)
            items.append(
                {
                    "id": int(tracker_id),
                    "bbox": [x1, y1, max(x2 - x1, 0), max(y2 - y1, 0)],
                    "bbox_xyxy": [x1, y1, x2, y2],
                    "center": [int((x1 + x2) / 2), int((y1 + y2) / 2)],
                }
            )

        items.sort(key=lambda item: item["id"])
        if DEBUG_EVERY_N_FRAMES > 0:
            print(f"[tracker] tracked_ids={[item['id'] for item in items]}")
        return items

    def _update_fallback(self, detections: List[Dict[str, float]]) -> List[Dict[str, int]]:
        if not detections:
            for track in self.tracks:
                track["misses"] = int(track.get("misses", 0)) + 1
            self.tracks = [track for track in self.tracks if int(track.get("misses", 0)) <= 12]
            return []

        detection_boxes = np.array([item["bbox_xyxy"] for item in detections], dtype=np.float32)
        detection_scores = np.array([item["confidence"] for item in detections], dtype=np.float32)

        matches: List[tuple[int, int]] = []
        unmatched_tracks = set(range(len(self.tracks)))
        unmatched_detections = set(range(len(detections)))

        candidate_pairs: List[tuple[float, int, int]] = []
        for track_index, track in enumerate(self.tracks):
            box = np.asarray(track["bbox_xyxy"], dtype=np.float32)
            for detection_index, detection_box in enumerate(detection_boxes):
                iou = compute_iou(box, detection_box)
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
            track["bbox_xyxy"] = detection_boxes[detection_index].copy()
            track["misses"] = 0
            track["confidence"] = float(detection_scores[detection_index])

        for track_index in unmatched_tracks:
            self.tracks[track_index]["misses"] = int(self.tracks[track_index].get("misses", 0)) + 1

        for detection_index in unmatched_detections:
            self.tracks.append(
                {
                    "track_id": self.next_track_id,
                    "bbox_xyxy": detection_boxes[detection_index].copy(),
                    "misses": 0,
                    "confidence": float(detection_scores[detection_index]),
                }
            )
            self.next_track_id += 1

        self.tracks = [track for track in self.tracks if int(track.get("misses", 0)) <= 12]

        items: List[Dict[str, int]] = []
        for track in self.tracks:
            if int(track.get("misses", 0)) > 0:
                continue
            x1, y1, x2, y2 = [int(round(value)) for value in np.asarray(track["bbox_xyxy"]).tolist()]
            x1 = max(x1, 0)
            y1 = max(y1, 0)
            x2 = max(x2, x1)
            y2 = max(y2, y1)
            items.append(
                {
                    "id": int(track["track_id"]),
                    "bbox": [x1, y1, max(x2 - x1, 0), max(y2 - y1, 0)],
                    "bbox_xyxy": [x1, y1, x2, y2],
                    "center": [int((x1 + x2) / 2), int((y1 + y2) / 2)],
                }
            )

        items.sort(key=lambda item: item["id"])
        if DEBUG_EVERY_N_FRAMES > 0:
            print(f"[tracker] tracked_ids={[item['id'] for item in items]}")
        return items
