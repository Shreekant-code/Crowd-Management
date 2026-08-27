from __future__ import annotations

import os
import time
from typing import Any, Dict, List, Optional, Tuple
import cv2
import numpy as np

from inference.dml_engine import DirectMLInferenceEngine
from utils.config import (
    DENSE_ANCHOR_SIZE,
    DENSE_CLUSTER_DIST_THRESHOLD,
    DENSE_CONFIDENCE_THRESHOLD,
    DENSE_IOU_THRESHOLD,
    SPARSE_ANCHOR_SIZE,
    SPARSE_CLUSTER_DIST_THRESHOLD,
    SPARSE_CONFIDENCE_THRESHOLD,
    SPARSE_IOU_THRESHOLD,
)
from utils.density_analyzer import SpatialDensityAnalyzer


class BatchedHeadDetector:
    """
    DirectML Edge-Accelerated Point-to-Point & Head Detector on AMD Radeon 610M.
    Enhanced with Sparse vs Dense Crowd Regime Identification & Calibrated Counting.
    
    1. Single-Pass DirectML Inference: MobileNetV3-P2PNet or YOLOv8n Head Detector.
    2. Adaptive Regime-Aware Filtering:
       - Sparse Regions: Strict confidence (>=0.28) & standard NMS to eliminate false positives.
       - Dense Regions: Calibrated confidence (>=0.18) & distance-adaptive suppression to prevent
         crowd undercounting due to severe head overlaps.
    3. Dynamic Anchor Synthesis: Adapts anchor dimensions (22px in dense clusters, 40px in sparse).
    4. Inverse Letterbox Geometry: Accurately maps 640x640 points to native camera aspect ratios.
    5. Comprehensive Telemetry: Delivers sparse_count, dense_count, dominant_regime, and dense_clusters.
    """

    def __init__(
        self,
        model_path: Optional[str] = None,
        yolo_model_path: Optional[str] = None,
        mobilecount_model_path: Optional[str] = None,
        device_id: int = 0,
        conf_threshold: float = 0.22,
        anchor_size: int = 40,
        iou_threshold: float = 0.45,
        overlap_switch_threshold: float = 0.35,
    ) -> None:
        self.conf_threshold = conf_threshold
        self.anchor_size = anchor_size
        self.half_anchor = anchor_size // 2
        self.iou_threshold = iou_threshold
        self.overlap_switch_threshold = overlap_switch_threshold

        self.density_analyzer = SpatialDensityAnalyzer(
            grid_rows=6,
            grid_cols=6,
            sparse_dist_threshold=SPARSE_CLUSTER_DIST_THRESHOLD,
            dense_dist_threshold=DENSE_CLUSTER_DIST_THRESHOLD,
            k_neighbors=3,
        )

        # Resolve primary model path (Prefer YOLOv8n Head with pretrained weights)
        models_dir = os.path.join(os.path.dirname(__file__), "..", "models")
        default_yolo = os.path.join(models_dir, "yolov8n-head.onnx")
        default_p2p_fp16 = os.path.join(models_dir, "p2pnet-mobilenet-fp16.onnx")
        default_p2p = os.path.join(models_dir, "p2pnet-mobilenet.onnx")

        if model_path and os.path.exists(model_path):
            target_model = model_path
        elif yolo_model_path and os.path.exists(yolo_model_path):
            target_model = yolo_model_path
        elif os.path.exists(default_yolo):
            target_model = default_yolo
        elif os.path.exists(default_p2p_fp16):
            target_model = default_p2p_fp16
        elif os.path.exists(default_p2p):
            target_model = default_p2p
        else:
            target_model = default_yolo

        print(f"[batched-detector] Initializing AI Engine: {target_model} (Confidence: {self.conf_threshold})")
        self.engine = DirectMLInferenceEngine(target_model, device_id=device_id)

        # Detect model architecture type from ONNX session outputs
        output_names = [name.lower() for name in self.engine.output_names]
        self.is_p2pnet = "pred_logits" in output_names or "pred_points" in output_names or len(self.engine.output_names) >= 2
        print(f"[batched-detector] Architecture: {'MobileNetV3-P2PNet (Point-Based)' if self.is_p2pnet else 'YOLO Head Detector'}")

    @staticmethod
    def inverse_letterbox_point(
        point_xy: Tuple[float, float],
        orig_shape: Tuple[int, int] = (1080, 1920),
        target_shape: Tuple[int, int] = (640, 640),
    ) -> Tuple[int, int]:
        """
        Maps a (px, py) coordinate from a letterboxed 640x640 canvas back to native frame space.
        """
        orig_h, orig_w = orig_shape
        target_w, target_h = target_shape

        scale = min(target_w / orig_w, target_h / orig_h)
        pad_x = (target_w - orig_w * scale) / 2.0
        pad_y = (target_h - orig_h * scale) / 2.0

        px, py = point_xy
        real_x = max(0, min(int(round((px - pad_x) / scale)), orig_w - 1))
        real_y = max(0, min(int(round((py - pad_y) / scale)), orig_h - 1))
        return real_x, real_y

    @staticmethod
    def inverse_letterbox(
        bbox_xywh: List[int],
        orig_shape: Tuple[int, int] = (1080, 1920),
        target_shape: Tuple[int, int] = (640, 640),
    ) -> List[int]:
        orig_h, orig_w = orig_shape
        target_w, target_h = target_shape

        scale = min(target_w / orig_w, target_h / orig_h)
        pad_x = (target_w - orig_w * scale) / 2.0
        pad_y = (target_h - orig_h * scale) / 2.0

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

        # 1. Preprocess: Resize to 640x640, convert BGR to RGB, transpose to CHW, normalize to [0.0, 1.0]
        target_dtype = np.float16 if self.engine.is_fp16 else np.float32
        tensors = []
        for frame in batch_frames:
            h, w = frame.shape[:2]
            if (w, h) != (640, 640):
                resized_frame = cv2.resize(frame, (640, 640))
            else:
                resized_frame = frame

            if len(resized_frame.shape) == 3 and resized_frame.shape[2] == 3:
                rgb_frame = cv2.cvtColor(resized_frame, cv2.COLOR_BGR2RGB)
            else:
                rgb_frame = resized_frame

            chw = np.ascontiguousarray(np.transpose(rgb_frame, (2, 0, 1)), dtype=target_dtype) / 255.0
            tensors.append(chw)
        batch_tensor = np.stack(tensors, axis=0)

        # 2. Single-Pass DirectML Inference
        start_t = time.perf_counter()
        raw_outputs = self.engine.infer_batch_multi_output(batch_tensor)
        inference_ms = (time.perf_counter() - start_t) * 1000.0

        if self.is_p2pnet:
            return self._parse_p2pnet_batch(raw_outputs, camera_ids, orig_shapes, inference_ms)
        else:
            return self._parse_yolo_batch(raw_outputs[0], camera_ids, orig_shapes, inference_ms)

    def _parse_p2pnet_batch(
        self,
        outputs: List[np.ndarray],
        camera_ids: List[str],
        orig_shapes: List[Tuple[int, int]],
        inference_ms: float,
    ) -> Dict[str, Dict[str, Any]]:
        """
        Parses MobileNetV3-P2PNet outputs with dual-regime spatial calibration.
        """
        logits_batch = outputs[0]  # Shape: (B, N, 2)
        points_batch = outputs[1]  # Shape: (B, N, 2)
        batch_size = len(camera_ids)
        results: Dict[str, Dict[str, Any]] = {}

        for i, cam_id in enumerate(camera_ids):
            logits = logits_batch[i]
            points = points_batch[i]
            orig_shape = orig_shapes[i]
            orig_h, orig_w = orig_shape

            # Softmax across class dimension [Background=0, Head=1]
            exp_logits = np.exp(logits - np.max(logits, axis=-1, keepdims=True))
            probs = exp_logits / np.sum(exp_logits, axis=-1, keepdims=True)
            head_scores = probs[:, 1]

            # 1. First pass: extract all candidate points above dense threshold
            candidate_mask = head_scores > DENSE_CONFIDENCE_THRESHOLD
            candidate_points = points[candidate_mask]
            candidate_scores = head_scores[candidate_mask]

            raw_detections = []
            for idx in range(len(candidate_points)):
                pt = candidate_points[idx]
                score = float(candidate_scores[idx])

                px = pt[0] * 640.0 if pt[0] <= 1.0 else pt[0]
                py = pt[1] * 640.0 if pt[1] <= 1.0 else pt[1]
                real_x, real_y = self.inverse_letterbox_point((px, py), orig_shape=orig_shape)

                raw_detections.append({
                    "id": idx,
                    "point": [real_x, real_y],
                    "confidence": round(score, 3),
                })

            # 2. Analyze spatial density across the frame
            density_info = self.density_analyzer.analyze_detections(
                raw_detections,
                frame_shape=orig_shape,
            )

            # 3. Fine-tuned suppression and anchor calibration per regime
            final_detections = []
            for det in raw_detections:
                score = det["confidence"]
                px, py = det["point"]

                # Determine if point is in a dense cluster or sparse zone
                is_dense = False
                for cluster in density_info["dense_clusters"]:
                    if (
                        cluster["x"] <= px <= cluster["x"] + cluster["w"]
                        and cluster["y"] <= py <= cluster["y"] + cluster["h"]
                    ):
                        is_dense = True
                        break

                # Apply regime-specific confidence gating
                min_conf = DENSE_CONFIDENCE_THRESHOLD if is_dense else SPARSE_CONFIDENCE_THRESHOLD
                if score < min_conf:
                    continue

                # Calibrated anchor sizing for ByteTrack
                synth_size = DENSE_ANCHOR_SIZE if is_dense else SPARSE_ANCHOR_SIZE
                half_size = synth_size // 2
                synth_x = max(0, min(px - half_size, orig_w - synth_size))
                synth_y = max(0, min(py - half_size, orig_h - synth_size))

                final_detections.append({
                    "id": det["id"],
                    "point": [px, py],
                    "bbox": [synth_x, synth_y, synth_size, synth_size],
                    "bbox_xyxy": [synth_x, synth_y, synth_x + synth_size, synth_y + synth_size],
                    "confidence": score,
                    "is_dense": is_dense,
                })

            # Re-run analysis on verified detections for exact telemetry counts
            final_analysis = self.density_analyzer.analyze_detections(
                final_detections,
                frame_shape=orig_shape,
            )

            results[cam_id] = {
                "count": len(final_detections),
                "sparse_count": final_analysis["sparse_count"],
                "dense_count": final_analysis["dense_count"],
                "dominant_regime": final_analysis["dominant_regime"],
                "density_mode": final_analysis["dominant_regime"] == "DENSE",
                "sparse_ratio": final_analysis["sparse_ratio"],
                "dense_ratio": final_analysis["dense_ratio"],
                "dense_clusters": final_analysis["dense_clusters"],
                "regime_breakdown": final_analysis,
                "detections": final_detections,
                "overlap_ratio": round(final_analysis["dense_ratio"] * 0.75, 3),
                "inference_ms": round(inference_ms / batch_size, 2),
            }

        return results

    def _parse_yolo_batch(
        self,
        raw_outputs: np.ndarray,
        camera_ids: List[str],
        orig_shapes: List[Tuple[int, int]],
        inference_ms: float,
    ) -> Dict[str, Dict[str, Any]]:
        """
        YOLO head detection parser with adaptive sparse/dense NMS calibration.
        """
        if raw_outputs.shape[1] < raw_outputs.shape[2]:
            preds_batch = np.transpose(raw_outputs, (0, 2, 1))
        else:
            preds_batch = raw_outputs

        batch_size = len(camera_ids)
        results: Dict[str, Dict[str, Any]] = {}

        for i, cam_id in enumerate(camera_ids):
            preds = preds_batch[i]
            orig_shape = orig_shapes[i]
            orig_h, orig_w = orig_shape

            scores = preds[:, 4] if preds.shape[1] >= 5 else preds[:, 4]
            # Use lower threshold initially to capture potential dense heads
            conf_mask = scores > DENSE_CONFIDENCE_THRESHOLD

            valid_preds = preds[conf_mask]
            valid_scores = scores[conf_mask]

            if len(valid_preds) == 0:
                empty_analysis = self.density_analyzer.analyze_detections([], frame_shape=orig_shape)
                results[cam_id] = {
                    "count": 0,
                    "sparse_count": 0,
                    "dense_count": 0,
                    "dominant_regime": "SPARSE",
                    "density_mode": False,
                    "sparse_ratio": 1.0,
                    "dense_ratio": 0.0,
                    "dense_clusters": [],
                    "regime_breakdown": empty_analysis,
                    "detections": [],
                    "overlap_ratio": 0.0,
                    "inference_ms": round(inference_ms / batch_size, 2),
                }
                continue

            cx = valid_preds[:, 0]
            cy = valid_preds[:, 1]
            w = valid_preds[:, 2]
            h = valid_preds[:, 3]

            x1 = cx - w / 2.0
            y1 = cy - h / 2.0

            candidate_boxes = [[int(x1[j]), int(y1[j]), int(w[j]), int(h[j])] for j in range(len(x1))]
            candidate_points = [
                {"point": [int(cx[j]), int(cy[j])], "confidence": float(valid_scores[j])}
                for j in range(len(cx))
            ]

            # Fast spatial density estimation to decide adaptive NMS IoU threshold
            initial_density = self.density_analyzer.analyze_detections(
                candidate_points,
                frame_shape=(640, 640),
            )
            adaptive_iou = (
                DENSE_IOU_THRESHOLD
                if initial_density["dominant_regime"] == "DENSE"
                else SPARSE_IOU_THRESHOLD
            )
            active_conf = (
                DENSE_CONFIDENCE_THRESHOLD
                if initial_density["dominant_regime"] == "DENSE"
                else SPARSE_CONFIDENCE_THRESHOLD
            )

            indices = cv2.dnn.NMSBoxes(
                candidate_boxes,
                valid_scores.tolist(),
                active_conf,
                adaptive_iou,
            )

            detections = []
            if len(indices) > 0:
                for idx in np.array(indices).flatten():
                    scaled_box = self.inverse_letterbox(candidate_boxes[idx], orig_shape=orig_shape)
                    x, y, bw, bh = scaled_box
                    point_x = x + bw // 2
                    point_y = y + bh // 2
                    detections.append({
                        "id": int(idx),
                        "point": [point_x, point_y],
                        "bbox": scaled_box,
                        "bbox_xyxy": [x, y, x + bw, y + bh],
                        "confidence": round(float(valid_scores[idx]), 3),
                    })

            # Final comprehensive density & regime classification
            final_analysis = self.density_analyzer.analyze_detections(
                detections,
                frame_shape=orig_shape,
            )

            results[cam_id] = {
                "count": len(detections),
                "sparse_count": final_analysis["sparse_count"],
                "dense_count": final_analysis["dense_count"],
                "dominant_regime": final_analysis["dominant_regime"],
                "density_mode": final_analysis["dominant_regime"] == "DENSE",
                "sparse_ratio": final_analysis["sparse_ratio"],
                "dense_ratio": final_analysis["dense_ratio"],
                "dense_clusters": final_analysis["dense_clusters"],
                "regime_breakdown": final_analysis,
                "detections": detections,
                "overlap_ratio": round(final_analysis["dense_ratio"] * 0.75, 3),
                "inference_ms": round(inference_ms / batch_size, 2),
            }

        return results
