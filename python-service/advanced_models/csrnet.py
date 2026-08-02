from typing import Any, Dict, List

import cv2
import numpy as np

from advanced_models.model_loader import get_torch, get_torch_device, load_torch_module
from utils.config import (
    CSRNET_INPUT_HEIGHT,
    CSRNET_INPUT_WIDTH,
    DENSE_COUNT_THRESHOLD,
    DENSITY_MAP_OUTPUT_HEIGHT,
    DENSITY_MAP_OUTPUT_WIDTH,
)


class CSRNetDensityEstimator:
    def __init__(self) -> None:
        self.torch = get_torch()
        self.device = get_torch_device()
        self.model, self.load_error = load_torch_module(__file__, "csrnet_final.pth")
        self.enabled = self.torch is not None and self.model is not None

    def _build_default(self, tracks: List[Dict], current_count: int, used_density: bool = False) -> Dict:
        return {
            "density_count": int(max(current_count, 0)),
            "density_map": [],
            "density_context": {
                "model": "CSRNet",
                "enabled": self.enabled,
                "used_density": used_density,
                "track_count": len(tracks),
                "load_error": self.load_error,
            },
        }

    def _prepare_tensor(self, frame: Any):
        resized = cv2.resize(frame, (CSRNET_INPUT_WIDTH, CSRNET_INPUT_HEIGHT))
        normalized = resized.astype(np.float32) / 255.0
        chw = np.transpose(normalized, (2, 0, 1))
        tensor = self.torch.from_numpy(chw).unsqueeze(0).to(self.device)
        return tensor, frame.shape[:2]

    @staticmethod
    def _resize_density_map(density_array: np.ndarray, frame_width: int, frame_height: int) -> np.ndarray:
        resized_density = cv2.resize(
            density_array,
            (frame_width, frame_height),
            interpolation=cv2.INTER_CUBIC,
        )
        return np.maximum(resized_density, 0.0).astype(np.float32)

    @staticmethod
    def _extract_density_array(output: Any) -> np.ndarray:
        if isinstance(output, (list, tuple)) and output:
            output = output[0]
        if hasattr(output, "detach"):
            output = output.detach().cpu().numpy()
        array = np.asarray(output, dtype=np.float32)
        array = np.squeeze(array)
        if array.ndim == 0:
            array = np.array([[float(array)]], dtype=np.float32)
        elif array.ndim == 1:
            array = array.reshape(1, -1)
        return np.maximum(array, 0.0)

    def infer(self, frame: Any) -> Dict[str, Any]:
        if frame is None:
            raise ValueError("frame is required")
        if not self.enabled:
            raise RuntimeError(self.load_error or "csrnet_unavailable")

        tensor, frame_shape = self._prepare_tensor(frame)
        with self.torch.no_grad():
            output = self.model(tensor)

        density_array = self._extract_density_array(output)
        frame_height, frame_width = frame_shape
        resized_density = self._resize_density_map(density_array, frame_width, frame_height)
        return {
            "count": max(int(round(float(density_array.sum()))), 0),
            "density_map": resized_density,
            "input_size": [CSRNET_INPUT_WIDTH, CSRNET_INPUT_HEIGHT],
        }

    def predict(self, frame: Any, tracks: List[Dict], current_count: int) -> Dict:
        default = self._build_default(tracks, current_count, used_density=False)
        if frame is None:
            return default

        if not self.enabled:
            return default

        try:
            tensor, frame_shape = self._prepare_tensor(frame)
            with self.torch.no_grad():
                output = self.model(tensor)

            density_array = self._extract_density_array(output)
            density_count = int(round(float(density_array.sum())))

            frame_height, frame_width = frame_shape
            resized_density = self._resize_density_map(density_array, frame_width, frame_height)
            normalized_density = cv2.normalize(
                resized_density,
                None,
                alpha=0.0,
                beta=1.0,
                norm_type=cv2.NORM_MINMAX,
            )
            compact_map = cv2.resize(
                normalized_density,
                (DENSITY_MAP_OUTPUT_WIDTH, DENSITY_MAP_OUTPUT_HEIGHT),
            )

            return {
                "density_count": max(density_count, 0),
                "density_map": compact_map.astype(np.float32).round(4).tolist(),
                "density_context": {
                    "model": "CSRNet",
                    "enabled": True,
                    "used_density": True,
                    "track_count": len(tracks),
                    "input_size": [CSRNET_INPUT_WIDTH, CSRNET_INPUT_HEIGHT],
                    "frame_size": [frame_width, frame_height],
                    "map_size": [DENSITY_MAP_OUTPUT_WIDTH, DENSITY_MAP_OUTPUT_HEIGHT],
                    "load_error": self.load_error,
                },
            }
        except Exception as error:
            fallback = self._build_default(tracks, current_count, used_density=False)
            fallback["density_context"]["runtime_error"] = str(error)
            return fallback
