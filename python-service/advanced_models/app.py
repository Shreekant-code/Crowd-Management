from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, Optional

import cv2
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse

from utils.config import (
    LIVE_SESSION_IDLE_SECONDS,
    LIVE_STREAM_JPEG_QUALITY,
    STREAM_RECONNECT_DELAY_SECONDS,
    STREAM_TARGET_FPS,
)
from utils.crowd_runtime import CrowdRuntime, get_shared_csrnet
from utils.error_logging import install_error_handlers
from utils.stream_loader import LatestFrameCapture, detect_stream_type

app = FastAPI(title="Advanced Crowd Analytics", version="2.0.0")
install_error_handlers(app)
logger = logging.getLogger(__name__)
sessions_lock = threading.Lock()
sessions: Dict[str, "LiveSession"] = {}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class LiveSession:
    def __init__(self, camera_id: str, stream_url: str) -> None:
        self.camera_id = camera_id
        self.stream_url = stream_url
        self.runtime = CrowdRuntime()
        self.stop_event = threading.Event()
        self.lock = threading.Lock()
        self.status = "warming_up"
        self.latest_result: Optional[Dict[str, Any]] = None
        self.latest_jpeg: Optional[bytes] = None
        self.last_processed_at = 0.0
        self.last_access_at = time.time()
        self.viewer_count = 0
        self.thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()

    def touch(self) -> None:
        with self.lock:
            self.last_access_at = time.time()

    def add_viewer(self) -> None:
        with self.lock:
            self.viewer_count += 1
            self.last_access_at = time.time()

    def remove_viewer(self) -> None:
        with self.lock:
            self.viewer_count = max(self.viewer_count - 1, 0)
            self.last_access_at = time.time()

    def snapshot(self) -> Optional[Dict[str, Any]]:
        with self.lock:
            self.last_access_at = time.time()
            if self.latest_result is None:
                return None
            return {
                key: value
                for key, value in self.latest_result.items()
                if not key.startswith("_")
            }

    def latest_frame(self) -> Optional[bytes]:
        with self.lock:
            self.last_access_at = time.time()
            return self.latest_jpeg

    def idle_for_too_long(self) -> bool:
        with self.lock:
            return self.viewer_count == 0 and (time.time() - self.last_access_at) > LIVE_SESSION_IDLE_SECONDS

    def _run(self) -> None:
        stream_type = detect_stream_type(self.stream_url)
        reader = LatestFrameCapture(self.stream_url)
        frame_interval = 1.0 / max(STREAM_TARGET_FPS, 1.0)
        frame_id = 0
        last_processed_at = 0.0

        reader.start()
        try:
            while not self.stop_event.is_set():
                ok, frame = reader.read(timeout=STREAM_RECONNECT_DELAY_SECONDS)
                if not ok or frame is None:
                    self.status = "reconnecting"
                    time.sleep(0.05)
                    continue

                now = time.perf_counter()
                if now - last_processed_at < frame_interval:
                    time.sleep(0.001)
                    continue

                frame_id += 1
                last_processed_at = now
                result = self.runtime.process_frame(frame, frame_id=frame_id)
                result.update(
                    {
                        "camera_id": self.camera_id,
                        "stream_url": self.stream_url,
                        "updated_at": utc_now(),
                        "stream_type": stream_type,
                    }
                )

                output_frame = result.get("_output_frame", frame)
                encoded, buffer = cv2.imencode(
                    ".jpg",
                    output_frame,
                    [int(cv2.IMWRITE_JPEG_QUALITY), LIVE_STREAM_JPEG_QUALITY],
                )
                if not encoded:
                    continue

                with self.lock:
                    self.latest_result = result
                    self.latest_jpeg = buffer.tobytes()
                    self.last_processed_at = time.time()
                    self.last_access_at = time.time()
                    self.status = "running"
        except Exception as error:
            self.status = "failed"
            logger.exception(
                "advanced_stream_session_failed camera_id=%s stream_type=%s",
                self.camera_id,
                stream_type,
                exc_info=error,
            )
        finally:
            reader.stop()
            self.runtime.shutdown()
            with sessions_lock:
                current = sessions.get(self.camera_id)
                if current is self:
                    sessions.pop(self.camera_id, None)


def _cleanup_idle_sessions() -> None:
    stale_camera_ids = []
    with sessions_lock:
        for camera_id, session in sessions.items():
            if session.idle_for_too_long():
                stale_camera_ids.append(camera_id)

        for camera_id in stale_camera_ids:
            session = sessions.pop(camera_id, None)
            if session is not None:
                session.stop()


def _ensure_session(camera_id: str, source: str) -> LiveSession:
    if not source.strip():
        raise HTTPException(status_code=400, detail="source query parameter is required")

    _cleanup_idle_sessions()

    with sessions_lock:
        existing = sessions.get(camera_id)
        if existing is not None:
            if existing.stream_url == source:
                existing.touch()
                return existing
            existing.stop()
            sessions.pop(camera_id, None)

        session = LiveSession(camera_id=camera_id, stream_url=source)
        sessions[camera_id] = session

    session.start()
    return session


def _camera_id_from_params(source: str, camera_id: Optional[str]) -> str:
    normalized_camera_id = (camera_id or "").strip()
    if normalized_camera_id:
        return normalized_camera_id
    return source.strip()


def _stream_generator(session: LiveSession) -> Iterable[bytes]:
    session.add_viewer()
    try:
        while True:
            if session.stop_event.is_set():
                break

            frame = session.latest_frame()
            if frame is None:
                time.sleep(0.05)
                continue

            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + frame + b"\r\n"
            )
            time.sleep(1.0 / max(STREAM_TARGET_FPS, 1.0))
    finally:
        session.remove_viewer()


@app.get("/live")
def live(
    source: str | None = Query(None, description="RTSP/HTTP stream URL"),
    camera_id: str | None = Query(None, description="Stable camera identifier"),
) -> StreamingResponse:
    if source is None or not source.strip():
        raise HTTPException(status_code=400, detail="source query parameter is required")

    session = _ensure_session(_camera_id_from_params(source, camera_id), source.strip())
    return StreamingResponse(
        _stream_generator(session),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.get("/camera/{camera_id}/live")
def camera_live(camera_id: str, source: str | None = Query(None)) -> StreamingResponse:
    if source is None or not source.strip():
        raise HTTPException(status_code=400, detail="source query parameter is required")

    session = _ensure_session(camera_id, source.strip())
    return StreamingResponse(
        _stream_generator(session),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.get("/stats")
def stats(
    source: str | None = Query(None),
    camera_id: str | None = Query(None),
) -> Dict[str, Any]:
    if source is None or not source.strip():
        raise HTTPException(status_code=400, detail="source query parameter is required")

    session = _ensure_session(_camera_id_from_params(source, camera_id), source.strip())
    snapshot = session.snapshot()
    if snapshot is None:
        return {
            "camera_id": session.camera_id,
            "count": 0,
            "current_count": 0,
            "mode": "YOLO",
            "stream_url": session.stream_url,
            "heatmap_active": False,
            "fps": 0,
            "status": session.status,
            "updated_at": None,
        }

    return {
        **snapshot,
        "status": session.status,
    }


@app.get("/camera/{camera_id}/stats")
def camera_stats(camera_id: str, source: str | None = Query(None)) -> Dict[str, Any]:
    if source is None or not source.strip():
        raise HTTPException(status_code=400, detail="source query parameter is required")

    session = _ensure_session(camera_id, source.strip())
    snapshot = session.snapshot()
    if snapshot is None:
        return {
            "camera_id": camera_id,
            "count": 0,
            "current_count": 0,
            "mode": "YOLO",
            "stream_url": source.strip(),
            "heatmap_active": False,
            "fps": 0,
            "status": session.status,
            "updated_at": None,
        }

    return {
        **snapshot,
        "status": session.status,
    }


@app.get("/streams/{camera_id}/latest")
def stream_latest(camera_id: str, source: str | None = Query(None)) -> Dict[str, Any]:
    if source is None or not source.strip():
        raise HTTPException(status_code=400, detail="source query parameter is required")

    session = _ensure_session(_camera_id_from_params(source, camera_id), source.strip())
    snapshot = session.snapshot()
    if snapshot is None:
        return {
            "camera_id": camera_id,
            "status": session.status,
            "updated_at": None,
            "result": None,
        }

    return {
        "camera_id": camera_id,
        "status": session.status,
        "updated_at": snapshot.get("updated_at"),
        "result": snapshot,
    }


@app.get("/health")
def health() -> Dict[str, Any]:
    with sessions_lock:
        active_sessions = {
            camera_id: {
                "stream_url": session.stream_url,
                "status": session.status,
            }
            for camera_id, session in sessions.items()
        }

    return {
        "status": "ok",
        "csrnet_loaded": bool(getattr(get_shared_csrnet(), "enabled", False)),
        "active_sessions": active_sessions,
        "timestamp": utc_now(),
    }


@app.get("/global")
def global_summary() -> Dict[str, Any]:
    with sessions_lock:
        snapshots = []
        for camera_id, session in sessions.items():
            snapshot = session.snapshot()
            if snapshot is None:
                continue
            snapshots.append(
                {
                    "camera_id": camera_id,
                    "current_count": snapshot.get("current_count", 0),
                    "predicted_count": snapshot.get("predicted_count", snapshot.get("predicted_crowd", 0)),
                    "risk_level": snapshot.get("risk_level", "low"),
                    "model_used": snapshot.get("model_used", snapshot.get("mode", "YOLO")),
                }
            )

    if not snapshots:
        return {
            "most_crowded_camera": None,
            "fastest_growing_camera": None,
            "high_risk_cameras": [],
            "cameras": [],
            "updated_at": utc_now(),
        }

    most_crowded = max(snapshots, key=lambda item: item["current_count"])
    fastest_growing = max(
        snapshots,
        key=lambda item: float(item["predicted_count"]) - float(item["current_count"]),
    )
    high_risk = [item for item in snapshots if item["risk_level"] == "high"]

    return {
        "most_crowded_camera": most_crowded,
        "fastest_growing_camera": fastest_growing,
        "high_risk_cameras": high_risk,
        "cameras": snapshots,
        "updated_at": utc_now(),
    }
