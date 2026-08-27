import asyncio
import logging
import os
import sys
import threading
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import cv2
from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import StreamingResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("crowd-ai-service")

SERVICE_ROOT = os.path.dirname(os.path.abspath(__file__))
if SERVICE_ROOT not in sys.path:
    sys.path.insert(0, SERVICE_ROOT)

from detector import PersonDetector
from tracker import PersonTracker
from utils.analytics import AnalyticsEngine
from utils.callbacks import post_callback
from utils.config import (
    DEBUG_EVERY_N_FRAMES,
    FRAME_SKIP,
    MAX_ACTIVE_JOBS,
    STREAM_RECONNECT_DELAY_SECONDS,
    STREAM_STALE_AFTER_SECONDS,
    STREAM_TARGET_FPS,
    YOLO_CONFIDENCE,
    YOLO_MODEL,
)
from utils.crowd_runtime import CrowdRuntime
from utils.batched_stream_manager import BatchedStreamManager
from utils.schemas import FileJobRequest, StreamStartRequest, StreamStopRequest
from utils.stream_loader import LatestFrameCapture, _coerce_source_url, create_video_capture, detect_stream_type, resize_for_inference


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def log_frame(camera_id: str, frame_id: int, result: Dict[str, Any]) -> None:
    if DEBUG_EVERY_N_FRAMES <= 0 or frame_id % DEBUG_EVERY_N_FRAMES != 0:
        return

    print(
        f"[stream-frame] camera_id={camera_id} frame_id={frame_id} "
        f"people_count={result.get('people_count', 0)} "
        f"detections={len(result.get('detections', []))}"
    )


def log_pipeline_step(
    camera_id: str,
    frame_id: int,
    detection_count: int,
    track_count: int,
    source: str,
) -> None:
    if DEBUG_EVERY_N_FRAMES <= 0 or frame_id % DEBUG_EVERY_N_FRAMES != 0:
        return

    print(f"[{source}] camera_id={camera_id} frame_id={frame_id} Frame received")
    print(f"[{source}] camera_id={camera_id} frame_id={frame_id} Detections: {detection_count}")
    print(f"[{source}] camera_id={camera_id} frame_id={frame_id} Tracks: {track_count}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Service started and ready.")
    yield
    logger.info("Service shutting down. Stopping active stream processors...")
    try:
        batched_stream_manager.shutdown()
    except Exception as e:
        logger.exception(f"Error shutting down batched_stream_manager: {e}")
    with streams_lock:
        for camera_id, processor in list(active_streams.items()):
            try:
                processor.stop()
            except Exception as e:
                logger.exception(f"Error stopping processor for camera {camera_id}: {e}")
        active_streams.clear()
    logger.info("Service shutdown complete.")
    # Force immediate OS process termination so blocking C++ OpenCV network threads do not keep Uvicorn hanging on Ctrl+C
    os._exit(0)


from utils.error_logging import install_error_handlers

app = FastAPI(title="Crowd Analytics AI Service", version="1.0.0", lifespan=lifespan)
install_error_handlers(app)
detector = PersonDetector(model_name=YOLO_MODEL, confidence=YOLO_CONFIDENCE)
batched_stream_manager = BatchedStreamManager()
slot_limiter = threading.BoundedSemaphore(MAX_ACTIVE_JOBS)
jobs_lock = threading.Lock()
streams_lock = threading.Lock()
jobs: Dict[str, Dict[str, Any]] = {}
active_streams: Dict[str, "StreamProcessor"] = {}


def run_detection_pipeline(capture: cv2.VideoCapture, analytics: AnalyticsEngine, tracker: PersonTracker) -> Dict[str, Any]:
    runtime = CrowdRuntime()
    runtime.reset_for_new_video()
    last_result = analytics.empty_result()
    frame_index = 0
    processed_frame_id = 0
    logged_shape = False

    try:
        while True:
            ok, frame = capture.read()
            if not ok:
                break

            frame_index += 1
            if FRAME_SKIP > 1 and frame_index % FRAME_SKIP != 0:
                continue

            if not logged_shape:
                print(f"[file-pipeline] Frame shape: {getattr(frame, 'shape', None)}")
                print("[file-pipeline] Tracker reset successful")
                logged_shape = True

            processed_frame_id += 1
            last_result = runtime.process_frame(frame, frame_id=processed_frame_id)
            log_pipeline_step(
                camera_id="file-job",
                frame_id=processed_frame_id,
                detection_count=len(last_result.get("detections", [])),
                track_count=len(last_result.get("active_track_ids", [])),
                source="file-pipeline",
            )
            last_result.pop("_output_frame", None)
    finally:
        runtime.shutdown()

    return last_result


class StreamProcessor:
    def __init__(self, camera_id: str, stream_url: str, user_id: Optional[str], zone_name: Optional[str]) -> None:
        self.camera_id = camera_id
        self.stream_url = stream_url
        self.user_id = user_id
        self.zone_name = zone_name
        self.stop_event = threading.Event()
        self.lock = threading.Lock()
        self.latest_result: Optional[Dict[str, Any]] = None
        self.latest_jpeg: Optional[bytes] = None
        self.last_processed_at: Optional[float] = None
        self.status = "warming_up"
        self.reader: Optional[LatestFrameCapture] = None
        self.thread = threading.Thread(target=self._run, daemon=True)
        self._slot_acquired = False

    def acquire_slot(self) -> bool:
        if self._slot_acquired:
            return True

        acquired = slot_limiter.acquire(blocking=False)
        if acquired:
            self._slot_acquired = True
        return acquired

    def release_slot(self) -> None:
        if not self._slot_acquired:
            return

        self._slot_acquired = False
        try:
            slot_limiter.release()
        except ValueError:
            logger.warning(f"[stream-lifecycle] Attempted to release a slot for camera {self.camera_id} more than once.")

    def start(self) -> None:
        if not self.acquire_slot():
            raise RuntimeError("AI service is at concurrency limit")
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()
        if self.reader is not None:
            try:
                self.reader.stop()
            except Exception:
                pass

    def get_latest(self) -> Optional[Dict[str, Any]]:
        with self.lock:
            if self.latest_result is None:
                return None

            if self.last_processed_at is None:
                return self.latest_result

            if time.perf_counter() - self.last_processed_at > STREAM_STALE_AFTER_SECONDS:
                analytics = AnalyticsEngine()
                stale = analytics.stale_result(self.latest_result)
                stale.update(
                    {
                        "camera_id": self.camera_id,
                        "user_id": self.user_id,
                        "zone_name": self.zone_name,
                    }
                )
                return stale

            return self.latest_result

    def _run(self) -> None:
        runtime = CrowdRuntime()
        runtime.reset_for_new_video()
        stream_type = detect_stream_type(self.stream_url)
        self.reader = LatestFrameCapture(self.stream_url)
        frame_index = 0
        processed_frame_id = 0
        frame_interval = 1.0 / max(STREAM_TARGET_FPS, 1.0)
        last_processed_at = 0.0

        self.reader.start()
        try:
            while not self.stop_event.is_set():
                ok, frame = self.reader.read(timeout=0.2)
                if not ok or frame is None:
                    if self.stop_event.is_set():
                        break
                    self.status = "reconnecting"
                    if self.stop_event.wait(timeout=0.05):
                        break
                    continue

                now = time.perf_counter()
                if now - last_processed_at < frame_interval:
                    if self.stop_event.wait(timeout=0.001):
                        break
                    continue

                frame_index += 1
                if FRAME_SKIP > 1 and frame_index % FRAME_SKIP != 0:
                    if self.stop_event.wait(timeout=0.001):
                        break
                    continue

                processed_frame_id += 1
                last_processed_at = time.perf_counter()
                result = runtime.process_frame(frame, frame_id=processed_frame_id)
                output_frame = result.get("_output_frame", frame)
                sanitized_result = dict(result)
                sanitized_result.pop("_output_frame", None)
                log_pipeline_step(
                    camera_id=self.camera_id,
                    frame_id=processed_frame_id,
                    detection_count=len(sanitized_result.get("detections", [])),
                    track_count=len(sanitized_result.get("active_track_ids", [])),
                    source="stream-pipeline",
                )
                sanitized_result.update(
                    {
                        "camera_id": self.camera_id,
                        "user_id": self.user_id,
                        "zone_name": self.zone_name,
                        "updated_at": utc_now(),
                    }
                )
                log_frame(self.camera_id, processed_frame_id, sanitized_result)
                encoded, buffer = cv2.imencode(
                    ".jpg",
                    output_frame,
                    [int(cv2.IMWRITE_JPEG_QUALITY), 85],
                )
                if not encoded:
                    continue

                with self.lock:
                    self.latest_result = sanitized_result
                    self.latest_jpeg = buffer.tobytes()
                    self.last_processed_at = last_processed_at
                    self.status = "running"
        finally:
            with self.lock:
                self.status = "completed" if not self.stop_event.is_set() else "stopped"
            if self.reader is not None:
                self.reader.stop()
            runtime.shutdown()
            self.release_slot()
            with streams_lock:
                active_streams.pop(self.camera_id, None)
            logger.info(
                f"[stream-lifecycle] Camera {self.camera_id} video processing {self.status}. "
                f"Resources released & worker slot freed."
            )


def _normalize_stream_url(url: str) -> str:
    return _coerce_source_url(url).strip().rstrip('/')


def _get_or_create_stream_processor(camera_id: str, stream_url: str, user_id: Optional[str] = None, zone_name: Optional[str] = None) -> StreamProcessor:
    norm_url = _normalize_stream_url(stream_url)
    with streams_lock:
        existing = active_streams.get(camera_id)
        if existing is not None:
            if _normalize_stream_url(existing.stream_url) == norm_url and existing.status not in {"stopped", "failed"}:
                return existing

            existing.stop()
            active_streams.pop(camera_id, None)

        processor = StreamProcessor(camera_id, stream_url, user_id, zone_name)
        active_streams[camera_id] = processor

    try:
        processor.start()
    except Exception as error:
        with streams_lock:
            active_streams.pop(camera_id, None)
        raise error

    return processor


def process_file_job(job_id: str, request: FileJobRequest) -> None:
    capture = cv2.VideoCapture(request.file_path)
    tracker = PersonTracker()
    analytics = AnalyticsEngine()

    try:
        if not capture.isOpened():
            raise RuntimeError(f"Unable to open video file: {request.file_path}")

        result = run_detection_pipeline(capture, analytics, tracker)
        payload = {
            "job_id": job_id,
            "status": "completed",
            "result": {
                **result,
                "file_id": request.file_id,
                "user_id": request.user_id,
                "original_name": request.original_name,
            },
            "completed_at": utc_now(),
        }

        with jobs_lock:
            jobs[job_id] = payload

        if request.callback is not None:
            try:
                post_callback(request.callback.url, payload, request.callback.headers)
            except Exception:
                pass

        logger.info(f"[job-lifecycle] File job {job_id} processing completed successfully. Resources released.")
    except Exception as error:
        failure = {
            "job_id": job_id,
            "status": "failed",
            "error": str(error),
            "completed_at": utc_now(),
        }
        with jobs_lock:
            jobs[job_id] = failure

        if request.callback is not None:
            try:
                post_callback(request.callback.url, failure, request.callback.headers)
            except Exception:
                pass
    finally:
        capture.release()
        slot_limiter.release()


@app.get("/health")
def health() -> Dict[str, Any]:
    with streams_lock:
        active = list(active_streams.keys())

    return {
        "status": "ok",
        "model": YOLO_MODEL,
        "max_active_jobs": MAX_ACTIVE_JOBS,
        "active_streams": active,
        "timestamp": utc_now(),
    }


@app.post("/jobs/file")
def start_file_job(request: FileJobRequest) -> Dict[str, Any]:
    if not slot_limiter.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="AI service is at concurrency limit")

    job_id = str(uuid.uuid4())
    with jobs_lock:
        jobs[job_id] = {
            "job_id": job_id,
            "status": "processing_started",
            "file_id": request.file_id,
            "created_at": utc_now(),
        }

    thread = threading.Thread(target=process_file_job, args=(job_id, request), daemon=True)
    thread.start()

    return {
        "job_id": job_id,
        "status": "processing_started",
        "created_at": utc_now(),
    }


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> Dict[str, Any]:
    with jobs_lock:
        job = jobs.get(job_id)

    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    return job


@app.post("/streams/start")
@app.post("/stream/start")
def start_stream(request: StreamStartRequest) -> Dict[str, Any]:
    logger.info(f"[stream-lifecycle] Registering camera stream: {request.camera_id} ({request.stream_url})")
    res = batched_stream_manager.start_camera(
        camera_id=request.camera_id,
        stream_url=request.stream_url,
        user_id=request.user_id,
        zone_name=request.zone_name,
    )
    return {
        "camera_id": request.camera_id,
        "status": res.get("status", "processing_started"),
        "mode": res.get("mode", "d3d11_hardware"),
        "started_at": utc_now(),
    }


@app.post("/streams/stop")
@app.post("/stream/stop")
def stop_stream(request: StreamStopRequest) -> Dict[str, Any]:
    logger.info(f"[stream-lifecycle] Received stop request for camera_id={request.camera_id}")
    res = batched_stream_manager.stop_camera(request.camera_id)
    return {
        "camera_id": request.camera_id,
        "status": res.get("status", "stopped"),
        "timestamp": utc_now(),
    }


def _generate_warmup_placeholder_jpeg(width: int = 640, height: int = 360) -> bytes:
    try:
        import numpy as np
        img = np.zeros((height, width, 3), dtype=np.uint8)
        img[:] = (30, 24, 15)
        cv2.putText(img, "INITIALIZING AI STREAM...", (140, 190), cv2.FONT_HERSHEY_SIMPLEX, 0.8, (200, 200, 200), 2)
        _, buf = cv2.imencode(".jpg", img)
        return buf.tobytes()
    except Exception:
        return (
            b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
            b"\xff\xdb\x00C\x00\x08\x06\x06\x07\x06\x05\x08\x07\x07\x07\t\t\x08\n\x0c"
            b"\x14\r\x0c\x0b\x0b\x0c\x19\x12\x13\x0f\x14\x1d\x1a\x1f\x1e\x1d\x1a\x1c"
            b"\x1c $.' \",#\x1c\x1c(7),01444\x1f'9=82<.342\xff\xc0\x00\x0b\x08\x00"
            b"\x01\x00\x01\x01\x01\x11\x00\xff\xc4\x00\x1f\x00\x00\x01\x05\x01\x01"
            b"\x01\x01\x01\x01\x00\x00\x00\x00\x00\x00\x00\x00\x01\x02\x03\x04\x05"
            b"\x06\x07\x08\t\n\x0b\xff\xda\x00\x08\x01\x01\x00\x00?\x00\xbf\x00\xff\xd9"
        )

_WARMUP_PLACEHOLDER_JPEG = _generate_warmup_placeholder_jpeg()


@app.get("/live")
def live(
    source: str | None = Query(None, description="RTSP/HTTP/HLS stream URL"),
    camera_id: str | None = Query(None, description="Stable camera identifier"),
    user_id: str | None = Query(None, description="Optional user identifier"),
    zone_name: str | None = Query(None, description="Optional zone label"),
) -> StreamingResponse:
    if source is None or not source.strip():
        raise HTTPException(status_code=400, detail="source query parameter is required")

    normalized_source = source.strip()
    normalized_camera_id = (camera_id or normalized_source).strip()
    try:
        processor = _get_or_create_stream_processor(
            normalized_camera_id,
            normalized_source,
            user_id=user_id,
            zone_name=zone_name,
        )
    except RuntimeError as err:
        raise HTTPException(status_code=429, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))

    async def stream_generator():
        last_frame_bytes = None
        has_sent_initial = False
        try:
            while not processor.stop_event.is_set():
                with processor.lock:
                    latest_jpeg = processor.latest_jpeg
                    status = processor.status

                if latest_jpeg and latest_jpeg != last_frame_bytes:
                    last_frame_bytes = latest_jpeg
                    has_sent_initial = True
                    yield (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\n\r\n" + latest_jpeg + b"\r\n"
                    )
                    await asyncio.sleep(0.03)
                elif not has_sent_initial:
                    has_sent_initial = True
                    yield (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\n\r\n" + _WARMUP_PLACEHOLDER_JPEG + b"\r\n"
                    )
                    await asyncio.sleep(0.05)
                elif status in {"stopped", "completed", "failed"}:
                    break
                else:
                    await asyncio.sleep(0.03)
        except (GeneratorExit, asyncio.CancelledError):
            pass

    return StreamingResponse(
        stream_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.get("/camera/{camera_id}/live")
async def camera_live(
    camera_id: str,
    source: str | None = Query(None, description="RTSP/HTTP/HLS stream URL"),
    user_id: str | None = Query(None, description="Optional user identifier"),
    zone_name: str | None = Query(None, description="Optional zone label"),
) -> StreamingResponse:
    if source is None or not source.strip():
        raise HTTPException(status_code=400, detail="source query parameter is required")

    normalized_source = source.strip()
    try:
        processor = _get_or_create_stream_processor(
            camera_id.strip(),
            normalized_source,
            user_id=user_id,
            zone_name=zone_name,
        )
    except RuntimeError as err:
        raise HTTPException(status_code=429, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))

    async def stream_generator():
        last_frame_bytes = None
        has_sent_initial = False
        try:
            while not processor.stop_event.is_set():
                with processor.lock:
                    latest_jpeg = processor.latest_jpeg
                    status = processor.status

                if latest_jpeg and latest_jpeg != last_frame_bytes:
                    last_frame_bytes = latest_jpeg
                    has_sent_initial = True
                    yield (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\n\r\n" + latest_jpeg + b"\r\n"
                    )
                    await asyncio.sleep(0.03)
                elif not has_sent_initial:
                    has_sent_initial = True
                    yield (
                        b"--frame\r\n"
                        b"Content-Type: image/jpeg\r\n\r\n" + _WARMUP_PLACEHOLDER_JPEG + b"\r\n"
                    )
                    await asyncio.sleep(0.05)
                elif status in {"stopped", "completed", "failed"}:
                    break
                else:
                    await asyncio.sleep(0.03)
        except (GeneratorExit, asyncio.CancelledError):
            pass

    return StreamingResponse(
        stream_generator(),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )


@app.get("/streams/{camera_id}/latest")
@app.get("/stream/{camera_id}/stats")
def get_stream_latest(camera_id: str) -> Dict[str, Any]:
    stats = batched_stream_manager.get_camera_stats(camera_id)
    if stats:
        timestamp = stats.get("updatedAt") or stats.get("updated_at") or utc_now()
        return {
            "camera_id": camera_id,
            "status": "running",
            "updated_at": timestamp,
            "updatedAt": timestamp,
            "result": stats,
        }

    with streams_lock:
        processor = active_streams.get(camera_id)

    if processor is None:
        return {
            "camera_id": camera_id,
            "status": "idle",
            "updated_at": None,
            "result": None,
        }

    result = processor.get_latest()
    return {
        "camera_id": camera_id,
        "status": processor.status,
        "updated_at": result.get("updated_at") if result else None,
        "result": result,
    }


@app.get("/stats")
def get_stream_stats(
    source: str | None = Query(None, description="RTSP/HTTP/HLS stream URL"),
    camera_id: str | None = Query(None, description="Stable camera identifier"),
    user_id: str | None = Query(None, description="Optional user identifier"),
    zone_name: str | None = Query(None, description="Optional zone label"),
) -> Dict[str, Any]:
    if source is None or not source.strip():
        raise HTTPException(status_code=400, detail="source query parameter is required")

    normalized_source = source.strip()
    normalized_camera_id = (camera_id or normalized_source).strip()
    try:
        processor = _get_or_create_stream_processor(
            normalized_camera_id,
            normalized_source,
            user_id=user_id,
            zone_name=zone_name,
        )
    except RuntimeError as err:
        raise HTTPException(status_code=429, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))

    result = processor.get_latest()
    if result is None:
        return {
            "camera_id": normalized_camera_id,
            "status": processor.status,
            "updated_at": None,
            "result": None,
        }

    return {
        "camera_id": normalized_camera_id,
        "status": processor.status,
        "updated_at": result.get("updated_at"),
        "result": result,
    }


@app.get("/camera/{camera_id}/stats")
def get_camera_stream_latest(
    camera_id: str,
    source: str | None = Query(None, description="RTSP/HTTP/HLS stream URL"),
    user_id: str | None = Query(None, description="Optional user identifier"),
    zone_name: str | None = Query(None, description="Optional zone label"),
) -> Dict[str, Any]:
    if source is None or not source.strip():
        raise HTTPException(status_code=400, detail="source query parameter is required")

    try:
        processor = _get_or_create_stream_processor(
            camera_id.strip(),
            source.strip(),
            user_id=user_id,
            zone_name=zone_name,
        )
    except RuntimeError as err:
        raise HTTPException(status_code=429, detail=str(err))
    except Exception as err:
        raise HTTPException(status_code=500, detail=str(err))

    result = processor.get_latest()
    return {
        "camera_id": camera_id,
        "status": processor.status,
        "updated_at": result.get("updated_at") if result else None,
        "result": result,
    }


from advanced_models.evacuation_engine import evacuation_engine


@app.get("/evacuation/topology")
def get_evacuation_topology() -> Dict[str, Any]:
    """Returns static architectural graph topology with physical distances and capacities."""
    return evacuation_engine.get_topology_payload()


@app.post("/evacuation/routes")
def calculate_dynamic_evacuation_routes(payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """
    Computes dynamic congestion-aware evacuation paths across all zones using
    W_dynamic = D * (1 + alpha * rho).
    """
    telemetry = payload.get("telemetry", {}) if payload else {}
    return evacuation_engine.calculate_all_zone_evacuations(telemetry)


@app.post("/evacuation/route")
def calculate_single_evacuation_route(payload: Dict[str, Any]) -> Dict[str, Any]:
    """Calculates optimal path from a specific source zone to safe target exit."""
    source = payload.get("source", "Concourse_B")
    target_exit = payload.get("target_exit")
    telemetry = payload.get("telemetry", {})
    return evacuation_engine.calculate_evacuation_route(source, target_exit, telemetry)


@app.post("/evacuation/max-flow")
def calculate_network_max_flow(payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Computes Minimum-Cost Maximum-Flow multi-exit crowd distribution."""
    demands = payload.get("demands") if payload else None
    telemetry = payload.get("telemetry") if payload else None
    return evacuation_engine.calculate_min_cost_max_flow(demands, telemetry)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8001, reload=True)


