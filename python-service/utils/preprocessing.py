from __future__ import annotations

from typing import Any, Dict, Tuple

import cv2
import numpy as np


def _frame_metrics(frame: np.ndarray) -> Dict[str, float]:
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    brightness = float(np.mean(gray) / 255.0)
    contrast = float(np.std(gray) / 255.0)
    blur = float(cv2.Laplacian(gray, cv2.CV_64F).var())
    return {
        "brightness": round(brightness, 4),
        "contrast": round(contrast, 4),
        "blur": round(blur, 2),
    }


def _apply_gamma(frame: np.ndarray, gamma: float) -> np.ndarray:
    gamma = max(float(gamma), 0.2)
    inverse_gamma = 1.0 / gamma
    table = np.array(
        [((index / 255.0) ** inverse_gamma) * 255 for index in range(256)],
        dtype=np.uint8,
    )
    return cv2.LUT(frame, table)


def _apply_clahe(frame: np.ndarray) -> np.ndarray:
    lab = cv2.cvtColor(frame, cv2.COLOR_BGR2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_enhanced = clahe.apply(l_channel)
    merged = cv2.merge((l_enhanced, a_channel, b_channel))
    return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)


def _apply_sharpen(frame: np.ndarray) -> np.ndarray:
    kernel = np.array([[0, -1, 0], [-1, 5, -1], [0, -1, 0]], dtype=np.float32)
    return cv2.filter2D(frame, -1, kernel)


def preprocess_frame(frame: Any) -> Tuple[Any, Dict[str, Any]]:
    if frame is None or not hasattr(frame, "shape") or len(frame.shape) < 2:
        return frame, {
            "enabled": False,
            "reason": "invalid_frame",
        }

    if len(frame.shape) == 2:
        frame = cv2.cvtColor(frame, cv2.COLOR_GRAY2BGR)

    quality = _frame_metrics(frame)
    processed = frame.copy()
    enhancements = []

    if quality["brightness"] < 0.45:
        gamma = 1.15 if quality["brightness"] > 0.25 else 1.35
        processed = _apply_gamma(processed, gamma)
        enhancements.append(f"gamma:{gamma:.2f}")
        processed = _apply_clahe(processed)
        enhancements.append("clahe")

    if quality["contrast"] < 0.18:
        processed = _apply_clahe(processed)
        enhancements.append("contrast_clahe")

    if quality["blur"] < 55.0:
        processed = _apply_sharpen(processed)
        enhancements.append("sharpen")

    if not enhancements:
        return frame, {
            "enabled": False,
            "enhancements": [],
            "quality": quality,
        }

    return processed, {
        "enabled": bool(enhancements),
        "enhancements": enhancements,
        "quality": quality,
    }
