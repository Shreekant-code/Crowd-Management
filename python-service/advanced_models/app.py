from __future__ import annotations

from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Deque, Dict, Iterable

import cv2
import numpy as np
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse

from advanced_models.convlstm import ConvLSTMPredictor
from advanced_models.csrnet import CSRNetDensityEstimator
from utils.config import CSRNET_INPUT_HEIGHT, CSRNET_INPUT_WIDTH

try:
    from advanced_models.csrnet_runtime import run_csrnet  # type: ignore
except Exception:  # pragma: no cover - optional integration point
    run_csrnet = None


app = FastAPI(title="Advanced Crowd Analytics", version="1.0.0")
temporal_predictor = ConvLSTMPredictor()
density_estimator = CSRNetDensityEstimator()
csrnet_loaded = callable(run_csrnet) or bool(getattr(density_estimator, "enabled", False))
lstm_loaded = bool(getattr(temporal_predictor, "enabled", False))

COUNT_HISTORY_LENGTH = 10
TEMPORAL_WEIGHT = 0.3
DEBUG_FRAME_OUTPUT = Path(__file__).resolve().parent / "live_debug_frame.jpg"
MODEL_FRAME_SKIP = 1

current_source: str | None = None
current_count = 0
total_count = 0
last_count = 0
live_frame_id = 0
last_density_map: np.ndarray | None = None
last_smoothed_count = 0
last_updated_at: str | None = None


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _open_capture(source: str) -> cv2.VideoCapture:
    if not source:
        raise RuntimeError("Video source is required")

    capture_source: Any = 0 if source == "0" else source
    capture = (
        cv2.VideoCapture(capture_source, cv2.CAP_FFMPEG)
        if isinstance(capture_source, str) and capture_source.startswith("rtsp://")
        else cv2.VideoCapture(capture_source)
    )
    capture.set(cv2.CAP_PROP_BUFFERSIZE, 2)
    if not capture.isOpened():
        capture.release()
        raise RuntimeError(f"Unable to open video source: {source}")
    return capture


def _is_loopable_file_source(source: str) -> bool:
    normalized = (source or "").strip().lower()
    if not normalized or normalized == "0":
        return False
    if normalized.startswith("rtsp://") or normalized.startswith("http://") or normalized.startswith("https://"):
        return False
    return True


def _coerce_density_map(raw_map: Any, frame_shape: tuple[int, int, int]) -> np.ndarray:
    density_map = np.asarray(raw_map, dtype=np.float32)
    density_map = np.squeeze(density_map)
    if density_map.ndim == 0:
        density_map = np.zeros((frame_shape[0], frame_shape[1]), dtype=np.float32)
    elif density_map.ndim == 1:
        density_map = density_map.reshape(1, -1)

    if density_map.shape[:2] != frame_shape[:2]:
        density_map = cv2.resize(density_map, (frame_shape[1], frame_shape[0]))

    return np.maximum(density_map, 0.0)


def _blank_density_map(frame_shape: tuple[int, int, int]) -> np.ndarray:
    return np.zeros((frame_shape[0], frame_shape[1]), dtype=np.float32)


def _validate_csrnet_result(result: Any, frame_shape: tuple[int, int, int]) -> Dict[str, Any]:
    if isinstance(result, tuple) and len(result) >= 2:
        current_count, density_map = result[0], result[1]
        return {
            "current_count": max(int(round(float(current_count))), 0),
            "density_map": _coerce_density_map(density_map, frame_shape),
        }

    if isinstance(result, dict):
        density_map = _coerce_density_map(result.get("density_map", []), frame_shape)
        count = result.get("count", result.get("current_count", float(density_map.sum())))
        return {
            "current_count": max(int(round(float(count))), 0),
            "density_map": density_map,
        }

    raise ValueError("run_csrnet must return (count, density_map) or a dict with count/current_count and density_map")


def _run_primary_csrnet(frame: np.ndarray) -> Dict[str, Any]:
    if callable(run_csrnet):
        try:
            print("[DEBUG] CSRNet branch: run_csrnet")
            print("[RUNNING CSRNET]")
            result = run_csrnet(frame)
            if isinstance(result, tuple) and len(result) >= 2:
                current_count, density_map = result[0], result[1]
                print("[COUNT]", float(current_count))
                return {
                    "current_count": max(int(round(float(current_count))), 0),
                    "density_map": None if density_map is None else _coerce_density_map(density_map, frame.shape),
                }

            current_count = result
            print("[COUNT]", float(current_count))
            return {
                "current_count": max(int(round(float(current_count))), 0),
                "density_map": None,
            }
        except Exception as error:
            print(f"[live] run_csrnet failed validation/runtime error: {error}")
            return {
                "current_count": 0,
                "density_map": None,
            }

    if getattr(density_estimator, "enabled", False):
        try:
            print("[DEBUG] CSRNet branch: direct_model")
            model = density_estimator.model
            print("[DEBUG] model type:", type(model))
            try:
                first_parameter = next(model.parameters())
                print("[DEBUG] first parameter shape:", tuple(first_parameter.shape))
            except Exception as parameter_error:
                print(f"[DEBUG] unable to inspect model parameters: {parameter_error}")

            print("[DEBUG] live frame shape:", tuple(frame.shape))
            print("[DEBUG] using CSRNet input size:", (CSRNET_INPUT_WIDTH, CSRNET_INPUT_HEIGHT))
            tensor, _ = density_estimator._prepare_tensor(frame)
            print("[DEBUG] tensor shape:", tuple(tensor.shape))
            print("[RUNNING CSRNET]")
            with density_estimator.torch.no_grad():
                output = model(tensor)

            density_map = density_estimator._extract_density_array(output)
            count = int(round(float(density_map.sum())))
            print("[DEBUG] density min/max:", float(density_map.min()), float(density_map.max()))
            print("[DEBUG] density sum:", float(density_map.sum()))
            print("[COUNT]", float(density_map.sum()))
            return {
                "current_count": max(count, 0),
                "density_map": _coerce_density_map(density_map, frame.shape),
            }
        except Exception as error:
            print(f"[live] direct CSRNet fallback failed: {error}")

    return {
        "current_count": 0,
        "density_map": None,
    }


def _update_live_counts(next_count: int) -> None:
    global current_count, total_count, last_count, last_updated_at

    current_count = max(int(next_count), 0)
    if current_count > last_count:
        total_count += current_count - last_count
    last_count = current_count
    last_updated_at = utc_now()


def _predict_smoothed_count(count_history: Deque[float], current_count: int) -> int:
    if not lstm_loaded or len(count_history) < 5:
        return int(current_count)

    try:
        prediction = temporal_predictor.predict(list(count_history), float(current_count))
        predicted_count = float(prediction.get("predicted_crowd", current_count))
        final_count = ((1.0 - TEMPORAL_WEIGHT) * float(current_count)) + (TEMPORAL_WEIGHT * predicted_count)
        return max(int(round(final_count)), 0)
    except Exception as error:
        print(f"[live] ConvLSTM smoothing failed: {error}")
        return int(current_count)


def _build_heatmap_overlay(frame: np.ndarray, density_map: np.ndarray) -> np.ndarray:
    heat = cv2.resize(density_map, (frame.shape[1], frame.shape[0]))
    heat = cv2.normalize(heat, None, 0, 255, cv2.NORM_MINMAX).astype("uint8")
    heat = cv2.applyColorMap(heat, cv2.COLORMAP_JET)
    return cv2.addWeighted(frame, 0.6, heat, 0.4, 0)


def _annotate_frame(frame: np.ndarray, current_count: int, smoothed_count: int) -> np.ndarray:
    cv2.putText(
        frame,
        f"Current: {current_count}",
        (20, 40),
        cv2.FONT_HERSHEY_SIMPLEX,
        1,
        (0, 255, 0),
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        frame,
        f"Total: {total_count}",
        (20, 80),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.8,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    cv2.putText(
        frame,
        f"Smoothed: {smoothed_count}",
        (20, 116),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.7,
        (255, 255, 255),
        2,
        cv2.LINE_AA,
    )
    return frame


def _generate_live_stream(source: str) -> Iterable[bytes]:
    global current_source, current_count, total_count, last_count, live_frame_id, last_density_map, last_smoothed_count, last_updated_at

    if current_source != source:
        current_source = source
        current_count = 0
        total_count = 0
        last_count = 0
        live_frame_id = 0
        last_density_map = None
        last_smoothed_count = 0
        last_updated_at = None

    capture = _open_capture(source)
    loop_file = _is_loopable_file_source(source)
    count_history: Deque[float] = deque(maxlen=COUNT_HISTORY_LENGTH)
    debug_frame_saved = False

    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                if loop_file:
                    capture.set(cv2.CAP_PROP_POS_FRAMES, 0)
                    continue
                break

            live_frame_id += 1
            print("[FRAME RECEIVED]")
            print(f"[FRAME] {live_frame_id}")

            if not debug_frame_saved:
                try:
                    cv2.imwrite(str(DEBUG_FRAME_OUTPUT), frame)
                    debug_frame_saved = True
                    print(f"[DEBUG] saved live frame to: {DEBUG_FRAME_OUTPUT}")
                except Exception as error:
                    print(f"[DEBUG] failed to save live frame: {error}")

            try:
                if live_frame_id % MODEL_FRAME_SKIP == 0 or last_density_map is None:
                    print("[MODEL] Running CSRNet")
                    primary_result = _run_primary_csrnet(frame)
                    _update_live_counts(int(primary_result["current_count"]))
                    density_map = primary_result["density_map"]
                    last_density_map = density_map
                else:
                    density_map = last_density_map
            except Exception as error:
                print(f"[live] frame processing failed at frame={live_frame_id}: {error}")
                _update_live_counts(0)
                density_map = last_density_map

            print(f"[MODEL] Current Count: {current_count}")
            print("LIVE COUNT:", current_count)

            count_history.append(float(current_count))
            smoothed_count = _predict_smoothed_count(count_history, current_count)
            last_smoothed_count = smoothed_count

            output_frame = frame
            if density_map is not None:
                output_frame = _build_heatmap_overlay(output_frame, density_map)

            annotated = _annotate_frame(output_frame, current_count, smoothed_count)

            encoded, buffer = cv2.imencode(".jpg", annotated, [int(cv2.IMWRITE_JPEG_QUALITY), 85])
            if not encoded:
                continue

            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + buffer.tobytes() + b"\r\n"
            )
    finally:
        capture.release()


@app.get("/live")
def live(source: str | None = Query(None, description="0 for webcam or RTSP/HTTP stream URL")) -> StreamingResponse:
    if source is None or not source.strip():
        raise HTTPException(status_code=400, detail="source query parameter is required")

    try:
        stream = _generate_live_stream(source.strip())
        return StreamingResponse(
            stream,
            media_type="multipart/x-mixed-replace; boundary=frame",
        )
    except RuntimeError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@app.get("/health")
def health() -> Dict[str, Any]:
    return {
        "csrnet_loaded": csrnet_loaded,
        "lstm_loaded": lstm_loaded,
        "live_stream": "ready",
    }


@app.get("/stats")
def stats(source: str | None = Query(None)) -> Dict[str, Any]:
    normalized_source = source.strip() if isinstance(source, str) else None

    if normalized_source is not None and current_source is not None and normalized_source != current_source:
        return {
            "current_count": 0,
            "total_count": 0,
            "density_count": 0,
            "final_count": 0,
            "risk": "Low",
            "movement": 0.0,
            "frame_id": 0,
            "source": normalized_source,
            "updated_at": last_updated_at,
        }

    return {
        "current_count": current_count,
        "total_count": total_count,
        "density_count": current_count,
        "final_count": last_smoothed_count or current_count,
        "risk": "Low",
        "movement": 0.0,
        "frame_id": live_frame_id,
        "source": current_source,
        "updated_at": last_updated_at,
    }
