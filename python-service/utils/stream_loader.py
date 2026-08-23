from __future__ import annotations

import json
import os
import queue
import re
import shutil
import subprocess
import sys
import threading
import time
from typing import Any, Optional, Tuple
from urllib.parse import parse_qs, unquote, urlparse

import cv2
import requests

from utils.config import (
    STREAM_RECONNECT_DELAY_SECONDS,
    STREAM_RESIZE_HEIGHT,
    STREAM_RESIZE_WIDTH,
    STREAM_TARGET_FPS,
)
from utils.gst_ingestor import GstFrameIngestor


_RESOLVE_CACHE: dict[str, tuple[float, str]] = {}
_RESOLVE_CACHE_TTL_SECONDS = 300.0
_SOURCE_PROBE_FRAMES = int(os.getenv("SOURCE_PROBE_FRAMES", "1"))
_SOURCE_PROBE_TIMEOUT_SECONDS = float(os.getenv("SOURCE_PROBE_TIMEOUT_SECONDS", "4.0"))
_SOURCE_OPEN_TIMEOUT_SECONDS = float(os.getenv("SOURCE_OPEN_TIMEOUT_SECONDS", "8.0"))


def _is_direct_media_url(value: str) -> bool:
    normalized = (value or "").strip().lower()
    return normalized.startswith("rtsp://") or normalized.startswith("http://") or normalized.startswith("https://") or normalized.startswith("webcam://")


def _coerce_source_url(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return raw

    if re.search(r"<iframe\b", raw, flags=re.IGNORECASE) or re.search(r'src\s*=\s*["\'][^"\']+["\']', raw, flags=re.IGNORECASE):
        src_match = re.search(r'src\s*=\s*["\']([^"\']+)["\']', raw, flags=re.IGNORECASE)
        if src_match:
            return _coerce_source_url(src_match.group(1))

        url_match = re.search(r"https?://[^\"' <>\]]+", raw, flags=re.IGNORECASE)
        if url_match:
            return _coerce_source_url(url_match.group(0))

    return raw


def _get_host_name(value: str) -> str:
    try:
        return (urlparse(_coerce_source_url(value)).hostname or "").lower()
    except Exception:
        return ""


def _extract_youtube_video_id(raw_url: str) -> Optional[str]:
    value = (raw_url or "").strip()
    if not value:
        return None

    try:
        parsed = urlparse(value)
        host = (parsed.hostname or "").lower()
        if host == "youtu.be":
            candidate = parsed.path.strip("/").split("/")[0]
            return candidate or None
        if "youtube.com" in host:
            if parsed.path.startswith("/watch"):
                query = parse_qs(parsed.query)
                return query.get("v", [None])[0]
            parts = [part for part in parsed.path.split("/") if part]
            for index, part in enumerate(parts):
                if part in {"embed", "shorts", "live"} and index + 1 < len(parts):
                    return parts[index + 1]
    except Exception:
        match = re.search(r"youtu\.be/([A-Za-z0-9_-]{6,})", value, flags=re.IGNORECASE)
        if match:
            return match.group(1)
        match = re.search(r"[?&]v=([A-Za-z0-9_-]{6,})", value, flags=re.IGNORECASE)
        if match:
            return match.group(1)

    return None


def _extract_balanced_json(text: str, start_index: int) -> Optional[str]:
    depth = 0
    in_string = False
    escaped = False

    for index in range(start_index, len(text)):
        char = text[index]

        if in_string:
            if escaped:
                escaped = False
            elif char == "\\":
                escaped = True
            elif char == '"':
                in_string = False
            continue

        if char == '"':
            in_string = True
            continue

        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return text[start_index : index + 1]

    return None


def _parse_player_response(text: str) -> Optional[dict[str, Any]]:
    token = "ytInitialPlayerResponse"
    token_index = text.find(token)
    if token_index >= 0:
        brace_index = text.find("{", token_index)
        if brace_index >= 0:
            json_block = _extract_balanced_json(text, brace_index)
            if json_block:
                try:
                    return json.loads(json_block)
                except Exception:
                    pass

    manifest_match = re.search(r'"hlsManifestUrl":"([^"]+)"', text)
    if manifest_match:
        try:
            return {"streamingData": {"hlsManifestUrl": json.loads(f'"{manifest_match.group(1)}"')}}
        except Exception:
            pass

    query_match = re.search(r"[?&]player_response=([^&]+)", text)
    if query_match:
        try:
            decoded = unquote(query_match.group(1).replace("+", "%20"))
            return json.loads(decoded)
        except Exception:
            pass

    return None


def _fetch_text_with_timeout(url: str, timeout_seconds: float = 8.0) -> str:
    response = requests.get(
        url,
        timeout=timeout_seconds,
        headers={
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/126.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.8",
        },
    )
    response.raise_for_status()
    return response.text


def _try_resolve_with_ytdlp(video_url: str, stop_event: Optional[threading.Event] = None) -> Optional[str]:
    target_url = (video_url or "").strip()
    if not target_url:
        return None

    if stop_event and stop_event.is_set():
        return None

    commands = []
    if shutil.which("yt-dlp"):
        commands.append(["yt-dlp"])
    commands.append([sys.executable, "-m", "yt_dlp"])

    for cmd in commands:
        if stop_event and stop_event.is_set():
            return None
        try:
            proc = subprocess.Popen(
                [
                    *cmd,
                    "--no-warnings",
                    "--no-playlist",
                    "--skip-download",
                    "--get-url",
                    "--format",
                    "best[protocol^=m3u8]/best",
                    target_url,
                ],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )

            deadline = time.time() + 12.0
            stdout_data = ""
            while time.time() < deadline:
                if stop_event and stop_event.is_set():
                    proc.kill()
                    return None

                try:
                    stdout_data, _ = proc.communicate(timeout=0.2)
                    break
                except subprocess.TimeoutExpired:
                    continue

            if proc.poll() is None:
                proc.kill()
                proc.wait()

            if proc.returncode != 0:
                continue

            for line in (stdout_data or "").splitlines():
                candidate = line.strip()
                if candidate:
                    return candidate
        except Exception:
            continue

    return None


def _format_backend_failure_message(
    stage: str,
    *,
    candidate_url: str,
    candidate_type: str,
    backend_name: str,
    error: Optional[str] = None,
    details: Optional[str] = None,
) -> str:
    parts = [f"[stream-loader] {stage} backend={backend_name} type={candidate_type} url={candidate_url}"]
    if error:
        parts.append(f"error={error}")
    if details:
        parts.append(f"details={details}")
    return " ".join(parts)


def _log_backend_failure(
    stage: str,
    *,
    candidate_url: str,
    candidate_type: str,
    backend_name: str,
    error: Optional[str] = None,
    details: Optional[str] = None,
) -> None:
    print(_format_backend_failure_message(stage, candidate_url=candidate_url, candidate_type=candidate_type, backend_name=backend_name, error=error, details=details))


def _probe_capture(capture: cv2.VideoCapture, stream_url: str, stop_event: Optional[threading.Event] = None) -> bool:
    deadline_seconds = max(min(_SOURCE_PROBE_TIMEOUT_SECONDS, _SOURCE_OPEN_TIMEOUT_SECONDS), 1.0)
    deadline = time.time() + deadline_seconds
    frames_seen = 0

    while time.time() < deadline and frames_seen < max(_SOURCE_PROBE_FRAMES, 1):
        if stop_event and stop_event.is_set():
            raise RuntimeError("Probe cancelled by shutdown signal")

        ok, frame = capture.read()
        if ok and frame is not None and hasattr(frame, "shape") and len(frame.shape) >= 2:
            frames_seen += 1
            if frames_seen >= max(_SOURCE_PROBE_FRAMES, 1):
                return True
            continue

        if stop_event and stop_event.wait(timeout=0.1):
            raise RuntimeError("Probe cancelled by shutdown signal")
        elif not stop_event:
            time.sleep(0.2)

    raise RuntimeError(f"Unable to decode playable frames from {stream_url}")


def _configure_ffmpeg_http_options(stream_url: str) -> None:
    if not stream_url:
        return

    normalized = (stream_url or "").strip().lower()
    if normalized.startswith("rtsp://"):
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "rtsp_transport;udp|stimeout;5000000"
    elif normalized.startswith("http://") or normalized.startswith("https://"):
        os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "timeout;5000000"


def resolve_playable_stream_url(stream_url: str, source_type: str = "", stop_event: Optional[threading.Event] = None) -> str:
    raw_url = _coerce_source_url(stream_url)
    if not raw_url:
        raise ValueError("stream URL is empty")

    if stop_event and stop_event.is_set():
        raise RuntimeError("Stream resolution cancelled by shutdown signal")

    cache_key = f"{(source_type or '').lower()}:{raw_url}"
    cached = _RESOLVE_CACHE.get(cache_key)
    if cached and time.time() - cached[0] < _RESOLVE_CACHE_TTL_SECONDS:
        return cached[1]

    if _is_direct_media_url(raw_url) and "youtube.com" not in raw_url.lower() and "youtu.be" not in raw_url.lower() and "earthlive.tv" not in raw_url.lower():
        _RESOLVE_CACHE[cache_key] = (time.time(), raw_url)
        return raw_url

    host = _get_host_name(raw_url)
    normalized_type = (source_type or "").strip().lower()
    is_public_page = (
        normalized_type == "public"
        or "youtube.com" in host
        or "youtu.be" in host
        or "earthlive.tv" in host
    )

    if not is_public_page:
        _RESOLVE_CACHE[cache_key] = (time.time(), raw_url)
        return raw_url

    video_id = _extract_youtube_video_id(raw_url)
    candidates = []
    if video_id:
        candidates.extend([
            f"https://www.youtube.com/watch?v={video_id}&hl=en&gl=US",
            f"https://www.youtube.com/embed/{video_id}",
        ])
    else:
        candidates.append(raw_url)

    for candidate in candidates:
        if stop_event and stop_event.is_set():
            raise RuntimeError("Stream resolution cancelled by shutdown signal")
        try:
            text = _fetch_text_with_timeout(candidate)
            parsed = _parse_player_response(text)
            hls_manifest_url = (parsed or {}).get("streamingData", {}).get("hlsManifestUrl")
            if hls_manifest_url:
                _RESOLVE_CACHE[cache_key] = (time.time(), hls_manifest_url)
                return hls_manifest_url

            iframe_match = re.search(r"youtube\.com/embed/([A-Za-z0-9_-]{6,})", text, flags=re.IGNORECASE)
            if iframe_match and iframe_match.group(1) != video_id:
                return resolve_playable_stream_url(f"https://www.youtube.com/watch?v={iframe_match.group(1)}", "public", stop_event=stop_event)
        except Exception as err:
            print(f"[stream-loader] Candidate resolution failed for {candidate}: {err}")
            continue

    ytdlp_resolved = _try_resolve_with_ytdlp(raw_url, stop_event=stop_event)
    if ytdlp_resolved:
        _RESOLVE_CACHE[cache_key] = (time.time(), ytdlp_resolved)
        return ytdlp_resolved

    if _is_direct_media_url(raw_url):
        print(f"[stream-loader] Resolution failed for public page {raw_url}, falling back to raw URL")
        _RESOLVE_CACHE[cache_key] = (time.time(), raw_url)
        return raw_url

    raise RuntimeError(f"Unable to resolve playable stream from {raw_url}")


def detect_stream_type(stream_url: str) -> str:
    normalized = _coerce_source_url(stream_url).strip().lower()

    if normalized.startswith("webcam://"):
        return "webcam"
    if normalized.startswith("rtsp://"):
        return "rtsp"
    if normalized.endswith(".m3u8") or ".m3u8?" in normalized:
        return "hls"
    if normalized.endswith(".mjpg") or normalized.endswith(".mjpeg") or "mjpeg" in normalized:
        return "mjpeg"
    if normalized.endswith(".mp4") or normalized.endswith(".avi") or normalized.endswith(".mov") or normalized.endswith(".mkv") or normalized.endswith(".webm"):
        return "file"
    if normalized.startswith("http://") or normalized.startswith("https://"):
        if "youtube.com" in normalized or "youtu.be" in normalized or "earthlive.tv" in normalized:
            return "public"
        return "http"

    raise ValueError(f"Unsupported stream URL: {stream_url}")


def create_video_capture(stream_url: str, stop_event: Optional[threading.Event] = None) -> cv2.VideoCapture:
    source_url = _coerce_source_url(stream_url)
    try:
        resolved_stream_url = resolve_playable_stream_url(source_url, stop_event=stop_event)
    except Exception as error:
        print(f"[stream-loader] Failed to resolve playable URL for {source_url}: {error}")
        resolved_stream_url = source_url
    candidate_urls = [resolved_stream_url]
    if source_url and source_url != resolved_stream_url and detect_stream_type(source_url) != "public":
        candidate_urls.append(source_url)

    stream_type = detect_stream_type(resolved_stream_url)
    print(
        f"[stream-loader] detected stream type={stream_type} "
        f"url={source_url} resolved_url={resolved_stream_url}"
    )

    last_error: Optional[str] = None
    for candidate_url in candidate_urls:
        if stop_event and stop_event.is_set():
            raise RuntimeError("Capture initialization cancelled by shutdown signal")

        candidate_type = detect_stream_type(candidate_url)
        backend_name = "opencv"
        if candidate_type == "webcam":
            webcam_source = (candidate_url or "").strip().split("://", 1)[-1]
            if webcam_source.isdigit():
                capture = cv2.VideoCapture(int(webcam_source))
            else:
                capture = cv2.VideoCapture(0)
        elif candidate_type in {"rtsp", "http", "hls", "mjpeg", "public"}:
            backend_name = "ffmpeg"
            _configure_ffmpeg_http_options(candidate_url)
            capture = cv2.VideoCapture(candidate_url, cv2.CAP_FFMPEG)
            if not capture.isOpened():
                capture.release()
                _log_backend_failure(
                    "capture failed",
                    candidate_url=candidate_url,
                    candidate_type=candidate_type,
                    backend_name=backend_name,
                    error="FFmpeg backend could not open source",
                )
                capture = cv2.VideoCapture(candidate_url)
                backend_name = "opencv"
        else:
            capture = cv2.VideoCapture(candidate_url)

        capture.set(cv2.CAP_PROP_BUFFERSIZE, 2)

        if not capture.isOpened():
            capture.release()
            last_error = f"Unable to open {candidate_type} stream: {candidate_url}"
            _log_backend_failure(
                "capture failed",
                candidate_url=candidate_url,
                candidate_type=candidate_type,
                backend_name=backend_name,
                error=last_error,
            )
            continue

        try:
            _probe_capture(capture, candidate_url, stop_event=stop_event)
        except Exception as error:
            last_error = str(error)
            _log_backend_failure(
                "probe failed",
                candidate_url=candidate_url,
                candidate_type=candidate_type,
                backend_name=backend_name,
                error=last_error,
            )
            capture.release()
            continue

        print(f"[stream-loader] connection established type={candidate_type} backend={backend_name} url={candidate_url}")
        return capture

    raise RuntimeError(last_error or f"Unable to open stream: {resolved_stream_url}")


def reconnect_video_capture(stream_url: str, attempt: int) -> Tuple[cv2.VideoCapture, str]:
    stream_type = detect_stream_type(stream_url)
    print(
        f"[stream-loader] reconnect attempt={attempt} type={stream_type} url={stream_url}"
    )
    capture = create_video_capture(stream_url)
    return capture, stream_type


def resize_for_inference(frame: Any) -> Any:
    if frame is None:
        return frame

    target_width = max(int(STREAM_RESIZE_WIDTH), 160)
    target_height = max(int(STREAM_RESIZE_HEIGHT), 120)
    height, width = frame.shape[:2]
    if width == target_width and height == target_height:
        return frame

    return cv2.resize(frame, (target_width, target_height), interpolation=cv2.INTER_LINEAR)


class LatestFrameCapture:
    def __init__(self, stream_url: str) -> None:
        self.stream_url = stream_url
        self.stream_type = detect_stream_type(stream_url)
        self.stop_event = threading.Event()
        self.ingestor = GstFrameIngestor(
            rtsp_url=stream_url,
            width=int(STREAM_RESIZE_WIDTH),
            height=int(STREAM_RESIZE_HEIGHT),
            fps=float(STREAM_TARGET_FPS),
        )

    def start(self) -> None:
        self.ingestor.start()

    def stop(self) -> None:
        self.stop_event.set()
        self.ingestor.stop()

    def read(self, timeout: float = 1.0) -> Tuple[bool, Optional[Any]]:
        return self.ingestor.read(timeout=timeout)

    def get_latest_frame(self) -> Optional[Any]:
        return self.ingestor.get_latest_frame()
