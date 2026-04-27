from typing import Any, Dict, Sequence

import numpy as np

from advanced_models.model_loader import get_torch, load_pickle, load_torch_module
from utils.config import (
    TEMPORAL_BLEND_WEIGHT,
    TEMPORAL_MIN_SEQUENCE_LENGTH,
    TEMPORAL_SEQUENCE_LENGTH,
)


class ConvLSTMPredictor:
    def __init__(self) -> None:
        self.torch = get_torch()
        self.model, self.model_error = load_torch_module(__file__, "lstm_final.pth")
        self.scaler, self.scaler_error = load_pickle(__file__, "lstm_scaler.pkl")
        self.enabled = self.torch is not None and self.model is not None

    @staticmethod
    def _as_scalar(value: Any) -> float:
        if hasattr(value, "detach"):
            value = value.detach().cpu().numpy()
        array = np.asarray(value, dtype=np.float32).reshape(-1)
        return float(array[-1]) if array.size else 0.0

    def _transform(self, values: np.ndarray) -> np.ndarray:
        if self.scaler is None:
            return values
        if hasattr(self.scaler, "transform"):
            return self.scaler.transform(values)
        return values

    def _inverse_transform(self, values: np.ndarray) -> np.ndarray:
        if self.scaler is None:
            return values
        if hasattr(self.scaler, "inverse_transform"):
            return self.scaler.inverse_transform(values)
        return values

    def predict(self, count_sequence: Sequence[float], base_count: float) -> Dict:
        window = list(count_sequence)[-TEMPORAL_SEQUENCE_LENGTH:]
        fallback_count = max(float(base_count), 0.0)
        response = {
            "predicted_crowd": round(fallback_count, 2),
            "smoothed_count": int(round(fallback_count)),
            "final_count": int(round(fallback_count)),
            "temporal_context": {
                "model": "ConvLSTM",
                "enabled": self.enabled,
                "sample_count": len(window),
                "sequence_length": TEMPORAL_SEQUENCE_LENGTH,
                "model_error": self.model_error,
                "scaler_error": self.scaler_error,
            },
        }

        if len(window) < TEMPORAL_MIN_SEQUENCE_LENGTH or not self.enabled:
            return response

        try:
            values = np.array(window, dtype=np.float32).reshape(-1, 1)
            scaled = self._transform(values).astype(np.float32)
            tensor = self.torch.from_numpy(scaled.reshape(1, len(window), 1))

            with self.torch.no_grad():
                prediction = self.model(tensor)

            predicted_scaled = np.array([[self._as_scalar(prediction)]], dtype=np.float32)
            predicted_unscaled = float(self._inverse_transform(predicted_scaled).reshape(-1)[0])
            predicted_count = max(predicted_unscaled, 0.0)
            final_count = max(
                ((1.0 - TEMPORAL_BLEND_WEIGHT) * fallback_count)
                + (TEMPORAL_BLEND_WEIGHT * predicted_count),
                0.0,
            )

            response.update(
                {
                    "predicted_crowd": round(predicted_count, 2),
                    "smoothed_count": int(round(final_count)),
                    "final_count": int(round(final_count)),
                }
            )
            return response
        except Exception as error:
            response["temporal_context"]["runtime_error"] = str(error)
            return response
