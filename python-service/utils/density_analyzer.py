from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Tuple
import numpy as np


class SpatialDensityAnalyzer:
    """
    Spatial Density Analyzer & Crowd Regime Classifier.
    
    1. Divides the 2D coordinate space into an adaptive spatial grid (e.g., 6x6 cells).
    2. Calculates K-nearest neighbor distances and local point densities for all detections.
    3. Classifies detections and spatial regions into SPARSE, MODERATE, or DENSE regimes.
    4. Extracts dense crowd clusters and isolates sparse pedestrians.
    5. Calibrates regime-specific count weights to maximize counting accuracy across both regimes.
    """

    def __init__(
        self,
        grid_rows: int = 6,
        grid_cols: int = 6,
        sparse_dist_threshold: float = 70.0,
        dense_dist_threshold: float = 38.0,
        k_neighbors: int = 3,
        dense_cluster_min_points: int = 3,
    ) -> None:
        self.grid_rows = grid_rows
        self.grid_cols = grid_cols
        self.sparse_dist_threshold = sparse_dist_threshold
        self.dense_dist_threshold = dense_dist_threshold
        self.k_neighbors = k_neighbors
        self.dense_cluster_min_points = dense_cluster_min_points

    def analyze_detections(
        self,
        detections: List[Dict[str, Any]],
        frame_shape: Tuple[int, int] = (1080, 1920),
    ) -> Dict[str, Any]:
        """
        Analyzes a list of detections with 'point' [x, y] or 'bbox' [x, y, w, h].
        Returns regime classification, sparse/dense counts, clusters, and regional breakdown.
        """
        orig_h, orig_w = frame_shape
        total_detections = len(detections)

        if total_detections == 0:
            return {
                "dominant_regime": "SPARSE",
                "sparse_count": 0,
                "dense_count": 0,
                "sparse_ratio": 1.0,
                "dense_ratio": 0.0,
                "dense_clusters": [],
                "grid_density_map": np.zeros((self.grid_rows, self.grid_cols), dtype=np.float32).tolist(),
                "sparse_detections": [],
                "dense_detections": [],
                "avg_inter_head_distance": float(self.sparse_dist_threshold),
                "hotspot_regions": [],
            }

        # Extract 2D centroids
        points = []
        for det in detections:
            if "point" in det and len(det["point"]) >= 2:
                points.append([float(det["point"][0]), float(det["point"][1])])
            elif "center" in det and len(det["center"]) >= 2:
                points.append([float(det["center"][0]), float(det["center"][1])])
            elif "bbox" in det and len(det["bbox"]) >= 4:
                bx, by, bw, bh = det["bbox"]
                points.append([float(bx + bw / 2.0), float(by + bh / 2.0)])
            elif "bbox_xyxy" in det and len(det["bbox_xyxy"]) >= 4:
                x1, y1, x2, y2 = det["bbox_xyxy"]
                points.append([float((x1 + x2) / 2.0), float((y1 + y2) / 2.0)])
            else:
                points.append([orig_w / 2.0, orig_h / 2.0])

        pts_array = np.array(points, dtype=np.float32)  # Shape: (N, 2)

        # 1. Compute Pairwise Distance Matrix
        # Diff shape: (N, N, 2)
        diff = pts_array[:, np.newaxis, :] - pts_array[np.newaxis, :, :]
        dist_matrix = np.sqrt(np.sum(diff ** 2, axis=-1))  # (N, N)

        # 2. Compute K-Nearest Neighbor Distance per point
        k_val = min(self.k_neighbors, max(1, total_detections - 1))
        # Sort distances along row
        sorted_dists = np.sort(dist_matrix, axis=-1)
        # Exclude self distance (index 0)
        knn_dists = sorted_dists[:, 1 : k_val + 1] if total_detections > 1 else np.array([[self.sparse_dist_threshold]])
        avg_knn_per_point = np.mean(knn_dists, axis=-1)  # (N,)

        # 3. Classify Each Point into SPARSE vs DENSE
        is_dense_point = avg_knn_per_point < self.dense_dist_threshold
        # If very low total detections (< 4), default to sparse unless extremely clustered (< 25px)
        if total_detections < 4:
            is_dense_point = avg_knn_per_point < 25.0

        sparse_indices = np.where(~is_dense_point)[0]
        dense_indices = np.where(is_dense_point)[0]

        sparse_detections = [detections[i] for i in sparse_indices]
        dense_detections = [detections[i] for i in dense_indices]

        sparse_count = len(sparse_detections)
        dense_count = len(dense_detections)

        # 4. Spatial Grid Density Map
        cell_h = orig_h / float(self.grid_rows)
        cell_w = orig_w / float(self.grid_cols)
        grid_counts = np.zeros((self.grid_rows, self.grid_cols), dtype=np.int32)

        for pt in pts_array:
            px, py = pt
            r = min(int(py / cell_h), self.grid_rows - 1)
            c = min(int(px / cell_w), self.grid_cols - 1)
            grid_counts[r, c] += 1

        max_cell_count = max(float(np.max(grid_counts)), 1.0)
        grid_density_map = (grid_counts / max_cell_count).astype(np.float32)

        # 5. Extract Dense Clusters
        dense_clusters = []
        if len(dense_indices) >= self.dense_cluster_min_points:
            dense_pts = pts_array[dense_indices]
            # Simple spatial bounding clustering
            # Find contiguous high-density grid cells (count >= 2)
            for r in range(self.grid_rows):
                for c in range(self.grid_cols):
                    if grid_counts[r, c] >= 2:
                        box_x = int(c * cell_w)
                        box_y = int(r * cell_h)
                        box_w = int(cell_w)
                        box_h = int(cell_h)
                        cell_pts = [
                            pt for pt in dense_pts
                            if box_x <= pt[0] <= box_x + box_w and box_y <= pt[1] <= box_y + box_h
                        ]
                        if cell_pts:
                            dense_clusters.append({
                                "x": box_x,
                                "y": box_y,
                                "w": box_w,
                                "h": box_h,
                                "count": len(cell_pts),
                                "density_score": round(float(grid_density_map[r, c]), 3),
                            })

        # 6. Global Regime Classification
        dense_ratio = dense_count / float(total_detections) if total_detections > 0 else 0.0
        sparse_ratio = sparse_count / float(total_detections) if total_detections > 0 else 1.0

        if dense_ratio >= 0.55 or dense_count >= 15:
            dominant_regime = "DENSE"
        elif dense_ratio >= 0.25 or (dense_count >= 5 and sparse_count >= 5):
            dominant_regime = "MODERATE"
        else:
            dominant_regime = "SPARSE"

        mean_inter_head = float(np.mean(avg_knn_per_point)) if total_detections > 0 else float(self.sparse_dist_threshold)

        return {
            "dominant_regime": dominant_regime,
            "sparse_count": sparse_count,
            "dense_count": dense_count,
            "sparse_ratio": round(sparse_ratio, 3),
            "dense_ratio": round(dense_ratio, 3),
            "dense_clusters": dense_clusters,
            "grid_density_map": grid_density_map.tolist(),
            "sparse_detections": sparse_detections,
            "dense_detections": dense_detections,
            "avg_inter_head_distance": round(mean_inter_head, 2),
            "hotspot_regions": [
                {"bbox": [c["x"], c["y"], c["w"], c["h"]], "count": c["count"]}
                for c in dense_clusters
            ],
        }
