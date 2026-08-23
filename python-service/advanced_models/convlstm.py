from __future__ import annotations

from typing import Any, Dict, Sequence
from advanced_models.forecaster import CrowdForecaster


class ConvLSTMPredictor:
    """
    Backward-compatible drop-in wrapper forwarding to CrowdForecaster.
    Eliminates PyTorch ConvLSTM weight checkpoints and tensor overhead.
    """

    def __init__(self) -> None:
        self.forecaster = CrowdForecaster()
        self.enabled = True
        self.model_error = None
        self.scaler_error = None

    def reset(self) -> None:
        self.forecaster.reset()

    def predict(self, count_sequence: Sequence[float], base_count: float) -> Dict[str, Any]:
        count = float(base_count)
        if count_sequence:
            count = float(list(count_sequence)[-1])

        result = self.forecaster.update_and_forecast(count)
        pred_count = result["predicted_count"]

        return {
            "predicted_crowd": float(pred_count),
            "smoothed_count": int(pred_count),
            "final_count": int(pred_count),
            "temporal_context": {
                "model": "1D-CrowdForecaster",
                "enabled": True,
                "trend_direction": result["trend_direction"],
                "growth_rate_per_min": result["growth_rate_per_min"],
                "predicted_risk": result["predicted_risk"],
                "latency_ms": result["latency_ms"],
                "model_error": None,
                "scaler_error": None,
            },
        }
