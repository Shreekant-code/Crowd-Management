"""Minimal smoke test for resolving and decoding a public YouTube live stream."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path


SERVICE_ROOT = Path(__file__).resolve().parents[1]
if str(SERVICE_ROOT) not in sys.path:
    sys.path.insert(0, str(SERVICE_ROOT))

from utils.stream_loader import create_video_capture, detect_stream_type, resolve_playable_stream_url


DEFAULT_SOURCE = "https://www.youtube.com/live/3nyPER2kzqk?si=Eee-SaGRC_MnvW-m"


def main() -> int:
    source = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SOURCE
    started_at = time.perf_counter()
    summary: dict[str, object] = {
        "source": source,
        "declared_stream_type": detect_stream_type(source),
    }
    capture = None

    try:
        resolved_url = resolve_playable_stream_url(source, "public")
        summary["resolved_url"] = resolved_url
        summary["resolved_stream_type"] = detect_stream_type(resolved_url)

        capture = create_video_capture(source)
        frames = []
        for _ in range(3):
            ok, frame = capture.read()
            if not ok or frame is None:
                raise RuntimeError("OpenCV opened the source but could not read a frame")
            frames.append({"width": int(frame.shape[1]), "height": int(frame.shape[0])})

        summary.update(
            {
                "status": "passed",
                "frames_decoded": len(frames),
                "frame_shapes": frames,
                "elapsed_seconds": round(time.perf_counter() - started_at, 2),
            }
        )
    except Exception as error:
        summary.update(
            {
                "status": "failed",
                "error_type": type(error).__name__,
                "error": str(error),
                "elapsed_seconds": round(time.perf_counter() - started_at, 2),
            }
        )
    finally:
        if capture is not None:
            capture.release()

    print(json.dumps(summary, indent=2))
    return 0 if summary["status"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
