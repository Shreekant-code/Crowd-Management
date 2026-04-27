from typing import Tuple

import cv2


def detect_stream_type(stream_url: str) -> str:
    normalized = (stream_url or "").strip().lower()

    if normalized.startswith("rtsp://"):
        return "rtsp"
    if normalized.startswith("http://") or normalized.startswith("https://"):
        return "http"

    raise ValueError(f"Unsupported stream URL: {stream_url}")


def create_video_capture(stream_url: str) -> cv2.VideoCapture:
    stream_type = detect_stream_type(stream_url)
    print(f"[stream-loader] detected stream type={stream_type} url={stream_url}")

    if stream_type == "rtsp":
        capture = cv2.VideoCapture(stream_url, cv2.CAP_FFMPEG)
    else:
        capture = cv2.VideoCapture(stream_url)

    capture.set(cv2.CAP_PROP_BUFFERSIZE, 2)

    if not capture.isOpened():
        capture.release()
        print(f"[stream-loader] connection failed type={stream_type} url={stream_url}")
        raise RuntimeError(f"Unable to open {stream_type} stream: {stream_url}")

    print(f"[stream-loader] connection established type={stream_type} url={stream_url}")
    return capture


def reconnect_video_capture(stream_url: str, attempt: int) -> Tuple[cv2.VideoCapture, str]:
    stream_type = detect_stream_type(stream_url)
    print(
        f"[stream-loader] reconnect attempt={attempt} type={stream_type} url={stream_url}"
    )
    capture = create_video_capture(stream_url)
    return capture, stream_type
