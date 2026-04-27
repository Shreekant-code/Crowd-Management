import threading
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import cv2
from fastapi import FastAPI, HTTPException

from detector import PersonDetector
from tracker import PersonTracker
from utils.analytics import AnalyticsEngine
from utils.callbacks import post_callback
from utils.config import (
    DEBUG_EVERY_N_FRAMES,
    FRAME_SKIP,
    MAX_ACTIVE_JOBS,
    STREAM_STALE_AFTER_SECONDS,
    STREAM_TARGET_FPS,
    YOLO_CONFIDENCE,
    YOLO_MODEL,
)
from utils.schemas import FileJobRequest, StreamStartRequest, StreamStopRequest
from utils.stream_loader import create_video_capture, detect_stream_type, reconnect_video_capture


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


app = FastAPI(title="Crowd Analytics AI Service", version="1.0.0")
detector = PersonDetector(model_name=YOLO_MODEL, confidence=YOLO_CONFIDENCE)
slot_limiter = threading.BoundedSemaphore(MAX_ACTIVE_JOBS)
jobs_lock = threading.Lock()
streams_lock = threading.Lock()
jobs: Dict[str, Dict[str, Any]] = {}
active_streams: Dict[str, "StreamProcessor"] = {}


def run_detection_pipeline(capture: cv2.VideoCapture, analytics: AnalyticsEngine, tracker: PersonTracker) -> Dict[str, Any]:
    last_result = analytics.empty_result()
    frame_index = 0
    processed_frame_id = 0
    pipeline_camera_id = "file-job"

    while True:
        ok, frame = capture.read()
        if not ok:
            break

        frame_index += 1
        if FRAME_SKIP > 1 and frame_index % FRAME_SKIP != 0:
            continue

        detections = detector.detect(frame)
        tracks = tracker.update(detections)
        processed_frame_id += 1
        log_pipeline_step(
            camera_id=pipeline_camera_id,
            frame_id=processed_frame_id,
            detection_count=len(detections),
            track_count=len(tracks),
            source="file-pipeline",
        )
        last_result = analytics.update(tracks, frame, frame.shape, frame_id=processed_frame_id)

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
        self.last_processed_at: Optional[float] = None
        self.status = "warming_up"
        self.thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self.thread.start()

    def stop(self) -> None:
        self.stop_event.set()

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
        tracker = PersonTracker()
        analytics = AnalyticsEngine()
        capture = create_video_capture(self.stream_url)
        stream_type = detect_stream_type(self.stream_url)
        frame_index = 0
        processed_frame_id = 0
        reconnect_attempt = 0
        frame_interval = 1.0 / max(STREAM_TARGET_FPS, 1.0)
        last_processed_at = 0.0

        try:
            while not self.stop_event.is_set():
                ok, frame = capture.read()
                if not ok:
                    self.status = "reconnecting"
                    reconnect_attempt += 1
                    print(
                        f"[stream-loader] frame read failed camera_id={self.camera_id} "
                        f"type={stream_type} attempt={reconnect_attempt}"
                    )
                    capture.release()
                    time.sleep(1.0)
                    try:
                        capture, stream_type = reconnect_video_capture(
                            self.stream_url, reconnect_attempt
                        )
                    except RuntimeError as error:
                        print(
                            f"[stream-loader] reconnect failed camera_id={self.camera_id} "
                            f"error={error}"
                        )
                        time.sleep(1.0)
                        continue
                    continue

                reconnect_attempt = 0
                now = time.perf_counter()
                if now - last_processed_at < frame_interval:
                    time.sleep(0.001)
                    continue

                frame_index += 1
                if FRAME_SKIP > 1 and frame_index % FRAME_SKIP != 0:
                    time.sleep(0.001)
                    continue

                detections = detector.detect(frame)
                tracks = tracker.update(detections)
                processed_frame_id += 1
                log_pipeline_step(
                    camera_id=self.camera_id,
                    frame_id=processed_frame_id,
                    detection_count=len(detections),
                    track_count=len(tracks),
                    source="stream-pipeline",
                )
                last_processed_at = time.perf_counter()
                result = analytics.update(tracks, frame, frame.shape, frame_id=processed_frame_id)
                result.update(
                    {
                        "camera_id": self.camera_id,
                        "user_id": self.user_id,
                        "zone_name": self.zone_name,
                        "updated_at": utc_now(),
                    }
                )
                log_frame(self.camera_id, processed_frame_id, result)

                with self.lock:
                    self.latest_result = result
                    self.last_processed_at = last_processed_at
                    self.status = "running"
        finally:
            capture.release()
            slot_limiter.release()
            with streams_lock:
                active_streams.pop(self.camera_id, None)


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
            post_callback(request.callback.url, payload, request.callback.headers)
    except Exception as exc:
        failure = {
            "job_id": job_id,
            "status": "failed",
            "error": str(exc),
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
def start_stream(request: StreamStartRequest) -> Dict[str, Any]:
    with streams_lock:
        if request.camera_id in active_streams:
            return {
                "camera_id": request.camera_id,
                "status": active_streams[request.camera_id].status,
                "started_at": utc_now(),
            }

        if not slot_limiter.acquire(blocking=False):
            raise HTTPException(status_code=429, detail="AI service is at concurrency limit")

        processor = StreamProcessor(
            camera_id=request.camera_id,
            stream_url=request.stream_url,
            user_id=request.user_id,
            zone_name=request.zone_name,
        )
        active_streams[request.camera_id] = processor

    processor.start()
    return {
        "camera_id": request.camera_id,
        "status": "processing_started",
        "started_at": utc_now(),
    }


@app.post("/streams/stop")
def stop_stream(request: StreamStopRequest) -> Dict[str, Any]:
    with streams_lock:
        processor = active_streams.get(request.camera_id)

    if processor is not None:
        processor.stop()

    return {
        "camera_id": request.camera_id,
        "status": "stopping",
        "timestamp": utc_now(),
    }


@app.get("/streams/{camera_id}/latest")
def get_stream_latest(camera_id: str) -> Dict[str, Any]:
    with streams_lock:
        processor = active_streams.get(camera_id)

    if processor is None:
        raise HTTPException(status_code=404, detail="Stream not found")

    result = processor.get_latest()
    return {
        "camera_id": camera_id,
        "status": processor.status,
        "updated_at": result.get("updated_at") if result else None,
        "result": result,
    }
