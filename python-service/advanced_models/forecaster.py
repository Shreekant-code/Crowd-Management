from __future__ import annotations

import time
from collections import deque
from typing import Any, Dict, List, Sequence, Tuple
import numpy as np


class CrowdForecaster:
    """
    Ultra-Fast 1D Temporal Crowd Forecaster (<0.05 ms execution).
    Uses precomputed regularized polynomial regression with EMA smoothing.
    
    1. Precomputes pseudo-inverse design matrix M = (X^T X + alpha * I)^(-1) X^T.
    2. Filters detection flicker via Exponential Moving Average (EMA, beta=0.7).
    3. Extrapolates 10-minute trend with damped quadratic curvature.
    4. Calculates growth velocity and classifies surge risk levels.
    """

    def __init__(
        self,
        sequence_length: int = 30,
        horizon_minutes: float = 10.0,
        fps: float = 2.0,
        l2_alpha: float = 1.5,
        ema_beta: float = 0.7,
        max_venue_capacity: int = 250,
    ) -> None:
        self.sequence_length = sequence_length
        self.horizon_minutes = horizon_minutes
        self.fps = fps
        self.l2_alpha = l2_alpha
        self.ema_beta = ema_beta
        self.max_capacity = max_venue_capacity

        self.history = deque(maxlen=self.sequence_length)
        self.last_smoothed_count: float = 0.0

        # 1. Precompute normalized Vandermonde design matrix X for normalized time t in [0.0, 1.0]
        t = np.linspace(0.0, 1.0, self.sequence_length, dtype=np.float32)
        self.X = np.column_stack([np.ones_like(t), t, t**2])  # (30, 3)

        # 2. Precompute Closed-Form Pseudo-Inverse: (X^T X + alpha * I)^(-1) X^T
        XtX = self.X.T @ self.X + self.l2_alpha * np.eye(3, dtype=np.float32)
        self.pseudo_inv = np.linalg.inv(XtX) @ self.X.T  # (3, 30)

        # 3. Horizon vector setup
        history_seconds = self.sequence_length / self.fps
        self.t_horizon = 1.0 + (self.horizon_minutes * 60.0) / history_seconds
        self.x_horizon = np.array([1.0, self.t_horizon, self.t_horizon**2], dtype=np.float32)

    def reset(self) -> None:
        self.history.clear()
        self.last_smoothed_count = 0.0

    def update_and_forecast(self, raw_count: float) -> Dict[str, Any]:
        t0 = time.perf_counter()

        # 1. Apply EMA smoothing to eliminate single-frame detection jitter
        if not self.history:
            smoothed = float(raw_count)
        else:
            smoothed = (self.ema_beta * float(raw_count)) + ((1.0 - self.ema_beta) * self.last_smoothed_count)

        self.last_smoothed_count = smoothed
        self.history.append(smoothed)

        # Warmup fallback for initial frames
        if len(self.history) < 6:
            latency_ms = (time.perf_counter() - t0) * 1000.0
            return {
                "predicted_count": int(round(raw_count)),
                "predicted_risk": "LOW",
                "trend_direction": "STABLE",
                "growth_rate_per_min": 0.0,
                "confidence": 0.5,
                "latency_ms": round(latency_ms, 3),
            }

        # Prepare vector y
        if len(self.history) < self.sequence_length:
            pad_len = self.sequence_length - len(self.history)
            y = np.pad(np.array(self.history, dtype=np.float32), (pad_len, 0), mode="edge")
        else:
            y = np.array(self.history, dtype=np.float32)

        # 2. Closed-Form Weight Vector: w = (3, 30) @ (30,) -> (3,)
        w = self.pseudo_inv @ y

        # 3. Growth calculation per minute based on normalized linear slope
        history_minutes = (self.sequence_length / self.fps) / 60.0
        growth_per_min = float(w[1]) / max(history_minutes, 0.05)

        # 4. Damped Extrapolation (prevents runaway quadratic divergence)
        raw_pred = float(np.dot(self.x_horizon, w))
        linear_pred = smoothed + (growth_per_min * self.horizon_minutes)
        damped_pred = smoothed + (growth_per_min * self.horizon_minutes * 0.45)

        if raw_pred > linear_pred:
            final_pred = min(raw_pred, damped_pred)
        else:
            final_pred = max(raw_pred, damped_pred)

        # Enforce realistic bounds [0, max_capacity]
        predicted_count = int(np.clip(round(final_pred), 0, self.max_capacity))

        # 5. Trend & Surge Risk Classification
        if growth_per_min > 2.0:
            trend = "SURGING"
        elif growth_per_min > 0.4:
            trend = "ACCUMULATING"
        elif growth_per_min < -0.4:
            trend = "DISPERSING"
        else:
            trend = "STABLE"

        # Risk assessment
        density_ratio = predicted_count / max(self.max_capacity, 1)
        if density_ratio >= 0.85 or growth_per_min > 3.0:
            risk = "CRITICAL"
        elif density_ratio >= 0.60 or growth_per_min > 1.5:
            risk = "HIGH"
        elif density_ratio >= 0.35:
            risk = "MEDIUM"
        else:
            risk = "LOW"

        latency_ms = (time.perf_counter() - t0) * 1000.0

        return {
            "predicted_count": predicted_count,
            "predicted_risk": risk,
            "trend_direction": trend,
            "growth_rate_per_min": round(growth_per_min, 2),
            "confidence": 0.90 if len(self.history) == self.sequence_length else 0.70,
            "latency_ms": round(latency_ms, 3),
        }
