from __future__ import annotations

import os
import time
from typing import Any, Dict, List, Optional, Tuple
import cv2
import numpy as np

from inference.dml_engine import DirectMLInferenceEngine


class BatchedHeadDetector:
    """
    High-Throughput Batched AI Engine for AMD Radeon 610M (DirectML).
    
    1. Primary Stage: Executes YOLOv8n-Head FP16 on a batched tensor (B=1..4, 3, 640, 640).
    2. Vectorized Pre-Filtering: Drops 99% of empty candidate anchors via NumPy boolean masking.
    3. Per-Camera Overlap Analysis: Calculates pairwise head IoU overlap ratio per stream.
    4. Dynamic Sub-Batch Routing: Sub-batches ONLY cameras exceeding 35% overlap to MobileCount FP16.
    5. Inverse Letterboxing: Maps 640x640 letterbox coordinates accurately to original aspect ratio.
    """

    def __init__(
        self,
        yolo_model_path: str,
        mobilecount_model_path: Optional[str] = None,
        device_id: int = 0,
        conf_threshold: float = 0.25,
        iou_threshold: float = 0.45,
        overlap_switch_threshold: float = 0.35,
    ) -> None:
        self.conf_threshold = conf_threshold
        self.iou_threshold = iou_threshold
        self.overlap_switch_threshold = overlap_switch_threshold

        print(f"[batched-detector] Initializing YOLOv8n Head Engine: {yolo_model_path}")
        self.yolo_engine = DirectMLInferenceEngine(yolo_model_path, device_id=device_id)

        self.mobilecount_engine = None
        if mobilecount_model_path and os.path.exists(mobilecount_model_path):
            print(f"[batched-detector] Initializing MobileCount Density Engine: {mobilecount_model_path}")
            self.mobilecount_engine = DirectMLInferenceEngine(mobilecount_model_path, device_id=device_id)

    @staticmethod
    def calculate_crowd_overlap(boxes_xyxy: np.ndarray) -> float:
        """
        Calculates pairwise IoU overlap among detected head boxes.
        Returns the proportion of overlapping heads.
        """
        num_boxes = len(boxes_xyxy)
        if num_boxes < 2:
            return 0.0

        x1 = np.maximum(boxes_xyxy[:, None, 0], boxes_xyxy[None, :, 0])
        y1 = np.maximum(boxes_xyxy[:, None, 1], boxes_xyxy[None, :, 1])
        x2 = np.minimum(boxes_xyxy[:, None, 2], boxes_xyxy[None, :, 2])
        y2 = np.minimum(boxes_xyxy[:, None, 3], boxes_xyxy[None, :, 3])

        inter = np.maximum(0, x2 - x1) * np.maximum(0, y2 - y1)
        area = (boxes_xyxy[:, 2] - boxes_xyxy[:, 0]) * (boxes_xyxy[:, 3] - boxes_xyxy[:, 1])
        union = area[:, None] + area[None, :] - inter

        iou = np.where(union > 0, inter / union, 0)
        np.fill_diagonal(iou, 0)

        overlapping_heads = np.any(iou > 0.35, axis=1)
        return float(np.sum(overlapping_heads) / max(num_boxes, 1))

    @staticmethod
    def inverse_letterbox(
        bbox_xywh: List[int],
        orig_shape: Tuple[int, int] = (1080, 1920),
        target_shape: Tuple[int, int] = (640, 640),
    ) -> List[int]:
        orig_h, orig_w = orig_shape
        target_w, target_h = target_shape

        scale = min(target_w / orig_w, target_h / orig_h)
        pad_x = (target_w - orig_w * scale) / 2
        pad_y = (target_h - orig_h * scale) / 2

        bx, by, bw, bh = bbox_xywh
        real_x = max(0, int(round((bx - pad_x) / scale)))
        real_y = max(0, int(round((by - pad_y) / scale)))
        real_w = max(1, int(round(bw / scale)))
        real_h = max(1, int(round(bh / scale)))

        return [real_x, real_y, real_w, real_h]

    def process_camera_batch(
        self,
        batch_frames: List[np.ndarray],
        camera_ids: List[str],
        orig_shapes: Optional[List[Tuple[int, int]]] = None,
    ) -> Dict[str, Dict[str, Any]]:
        if not batch_frames or not camera_ids:
            return {}

        batch_size = len(batch_frames)
        if orig_shapes is None:
            orig_shapes = [(1080, 1920)] * batch_size

        # 1. Preprocess: Normalize and stack into (B, 3, 640, 640) FP16 tensor
        tensors = []
        for frame in batch_frames:
            # Transpose HWC -> CHW and scale to [0.0, 1.0]
            chw = np.ascontiguousarray(np.transpose(frame, (2, 0, 1)), dtype=np.float16) / 255.0
            tensors.append(chw)
        batch_tensor = np.stack(tensors, axis=0)

        # 2. Stage 1 Primary Inference: DirectML YOLOv8n-Head FP16
        start_t = time.perf_counter()
        raw_outputs = self.yolo_engine.infer_batch(batch_tensor)
        inference_ms = (time.perf_counter() - start_t) * 1000.0

        # Handle YOLOv8 output tensor transposition: (B, 84, 8400) or (B, 5, 8400) -> (B, 8400, C)
        if raw_outputs.shape[1] < raw_outputs.shape[2]:
            preds_batch = np.transpose(raw_outputs, (0, 2, 1))
        else:
            preds_batch = raw_outputs

        results: Dict[str, Dict[str, Any]] = {}
        congested_indices: List[int] = []
        congested_frames: List[np.ndarray] = []

        # 3. Vectorized Pre-Filtering & Per-Camera Overlap Evaluation
        for i, cam_id in enumerate(camera_ids):
            preds = preds_batch[i]  # Shape (8400, C)
            orig_shape = orig_shapes[i]

            # Vectorized Boolean Mask: Extract confidence scores (person/head class index 4)
            scores = preds[:, 4] if preds.shape[1] == 5 else np.max(preds[:, 4:], axis=1)
            conf_mask = scores > self.conf_threshold

            valid_preds = preds[conf_mask]
            valid_scores = scores[conf_mask]

            if len(valid_preds) == 0:
                results[cam_id] = {
                    "count": 0,
                    "detections": [],
                    "density_mode": False,
                    "overlap_ratio": 0.0,
                    "inference_ms": round(inference_ms / batch_size, 2),
                }
                continue

            # Decode (cx, cy, w, h) -> (x, y, w, h) for NMS
            cx = valid_preds[:, 0]
            cy = valid_preds[:, 1]
            w = valid_preds[:, 2]
            h = valid_preds[:, 3]

            x1 = cx - w / 2.0
            y1 = cy - h / 2.0
            x2 = cx + w / 2.0
            y2 = cy + h / 2.0
            boxes_xyxy = np.stack([x1, y1, x2, y2], axis=1)

            # Evaluate per-camera crowd overlap
            overlap_ratio = self.calculate_crowd_overlap(boxes_xyxy)

            if overlap_ratio > self.overlap_switch_threshold and self.mobilecount_engine is not None:
                # Flag this camera for Sub-Batch Density Routing
                congested_indices.append(i)
                congested_frames.append(batch_tensor[i])
            else:
                # Fast OpenCV NMS on candidate slice
                nms_boxes = [[int(x1[j]), int(y1[j]), int(w[j]), int(h[j])] for j in range(len(x1))]
                indices = cv2.dnn.NMSBoxes(
                    nms_boxes,
                    valid_scores.tolist(),
                    self.conf_threshold,
                    self.iou_threshold,
                )

                detections = []
                if len(indices) > 0:
                    for idx in np.array(indices).flatten():
                        scaled_box = self.inverse_letterbox(nms_boxes[idx], orig_shape=orig_shape)
                        detections.append({
                            "id": int(idx),
                            "bbox": scaled_box,
                            "bbox_letterbox": nms_boxes[idx],
                            "confidence": round(float(valid_scores[idx]), 3),
                        })

                results[cam_id] = {
                    "count": len(detections),
                    "detections": detections,
                    "density_mode": False,
                    "overlap_ratio": round(overlap_ratio, 3),
                    "inference_ms": round(inference_ms / batch_size, 2),
                }

        # 4. Dynamic Sub-Batch Routing for Congested Cameras
        if congested_frames and self.mobilecount_engine is not None:
            sub_batch = np.stack(congested_frames, axis=0)  # Shape (N_congested, 3, 640, 640)
            density_outputs = self.mobilecount_engine.infer_batch(sub_batch)

            for sub_idx, cam_idx in enumerate(congested_indices):
                cam_id = camera_ids[cam_idx]
                d_map = density_outputs[sub_idx].squeeze()
                head_count = int(round(float(np.sum(d_map))))

                results[cam_id] = {
                    "count": head_count,
                    "density_count": head_count,
                    "density_map": d_map,
                    "density_mode": True,
                    "overlap_ratio": 1.0,
                    "detections": [],
                    "inference_ms": round(inference_ms / batch_size, 2),
                }

        return results
