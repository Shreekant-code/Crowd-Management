from __future__ import annotations

import os
import shutil
import subprocess
import sys
import threading
import time
from typing import Any, Optional, Tuple
import cv2
import numpy as np

from utils.config import (
    STREAM_RECONNECT_DELAY_SECONDS,
    STREAM_TARGET_FPS,
)

# 1. Register Windows GStreamer DLL directories if available
GSTREAMER_SYSTEM_PATHS = [
    os.getenv("GSTREAMER_BIN_DIR", ""),
    r"C:\gstreamer\1.0\msvc_x86_64\bin",
    r"C:\gstreamer\1.0\x86_64\bin",
    r"C:\Program Files\gstreamer\1.0\msvc_x86_64\bin",
]

GST_DLL_REGISTERED = False
for path in GSTREAMER_SYSTEM_PATHS:
    if path and os.path.exists(path):
        if hasattr(os, "add_dll_directory"):
            try:
                os.add_dll_directory(path)
                GST_DLL_REGISTERED = True
            except Exception as e:
                print(f"[gst-ingestor] Warning: Could not register DLL directory {path}: {e}")
        if path not in os.environ.get("PATH", ""):
            os.environ["PATH"] = f"{path};{os.environ.get('PATH', '')}"

# 2. Try initializing native PyGObject GStreamer bindings
try:
    import gi  # type: ignore
    gi.require_version("Gst", "1.0")
    from gi.repository import Gst, GLib  # type: ignore
    Gst.init(None)
    PYGOBJECT_AVAILABLE = True
except Exception:
    PYGOBJECT_AVAILABLE = False


def is_gst_cli_available() -> bool:
    return shutil.which("gst-launch-1.0") is not None or shutil.which("gst-launch-1.0.exe") is not None


def letterbox_image(image: np.ndarray, target_size: Tuple[int, int] = (640, 640)) -> Tuple[np.ndarray, float, int, int]:
    """
    Applies black letterbox borders to preserve native aspect ratio without image distortion.
    """
    target_w, target_h = target_size
    h, w = image.shape[:2]
    scale = min(target_w / w, target_h / h)
    nw, nh = int(round(w * scale)), int(round(h * scale))

    resized = cv2.resize(image, (nw, nh), interpolation=cv2.INTER_LINEAR)
    canvas = np.zeros((target_h, target_w, 3), dtype=np.uint8)

    top = (target_h - nh) // 2
    left = (target_w - nw) // 2
    canvas[top : top + nh, left : left + nw] = resized
    return canvas, scale, left, top


class GstFrameIngestor:
    """
    Hardware-Accelerated Frame Ingestor optimized for AMD Radeon VCN.
    
    1. Offloads H.264/H.265 decompression to AMD GPU (d3d11h264dec).
    2. Performs letterbox scaling inside VRAM (d3d11convert add-borders=true).
    3. Decimates stream from 30 FPS to 2 FPS inside VRAM before PCIe transfer.
    4. Downloads only the final 2 FPS 640x640 RGB tensor to System RAM (d3d11download).
    5. Rigorously cleans PyGObject C-binding memory allocations to prevent RAM leaks.
    """

    def __init__(
        self,
        rtsp_url: str,
        width: int = 640,
        height: int = 640,
        fps: float = 2.0,
        use_hardware: bool = True,
    ) -> None:
        self.rtsp_url = rtsp_url.strip()
        self.width = width
        self.height = height
        self.fps = fps
        self.use_hardware = use_hardware
        self.latest_frame: Optional[np.ndarray] = None
        self.last_frame_at: float = 0.0
        self.lock = threading.Lock()
        self.stop_event = threading.Event()
        self.is_running = False
        self.mode = "uninitialized"

        # GStreamer PyGObject pipeline instances
        self.pipeline = None
        self.sink = None

        # Fallback thread instances
        self.fallback_thread: Optional[threading.Thread] = None

    def _build_d3d11_pipeline_str(self) -> str:
        # Full GPU VRAM Pipeline: Decode -> Decimate immediately to 2 FPS -> Letterbox Scale -> Download
        return (
            f'rtspsrc location="{self.rtsp_url}" latency=50 protocols=tcp ! '
            f'rtph264depay ! h264parse ! d3d11h264dec ! '
            f'videorate ! video/x-raw(memory:D3D11Memory),framerate={int(round(self.fps))}/1 ! '
            f'd3d11convert add-borders=true ! '
            f'video/x-raw(memory:D3D11Memory),width={self.width},height={self.height},format=RGBA ! '
            f'd3d11download ! videoconvert ! video/x-raw,format=RGB ! '
            f'appsink name=sink emit-signals=True max-buffers=1 drop=True sync=False'
        )

    def _build_software_gst_pipeline_str(self) -> str:
        return (
            f'rtspsrc location="{self.rtsp_url}" latency=50 protocols=tcp ! '
            f'rtph264depay ! h264parse ! openh264dec ! '
            f'videorate ! video/x-raw,framerate={int(round(self.fps))}/1 ! '
            f'videoscale add-borders=true ! video/x-raw,width={self.width},height={self.height},format=RGB ! '
            f'appsink name=sink emit-signals=True max-buffers=1 drop=True sync=False'
        )

    def start(self) -> None:
        self.stop_event.clear()

        # Mode A: Native PyGObject Direct3D11 Pipeline
        if PYGOBJECT_AVAILABLE and self.use_hardware and self.rtsp_url.lower().startswith("rtsp://"):
            try:
                pipeline_str = self._build_d3d11_pipeline_str()
                self.pipeline = Gst.parse_launch(pipeline_str)
                self.sink = self.pipeline.get_by_name("sink")
                self.sink.connect("new-sample", self._on_new_sample)

                bus = self.pipeline.get_bus()
                bus.add_signal_watch()
                bus.connect("message::error", self._on_bus_error)
                bus.connect("message::eos", self._on_bus_eos)

                ret = self.pipeline.set_state(Gst.State.PLAYING)
                if ret != Gst.StateChangeReturn.FAILURE:
                    self.mode = "d3d11_hardware"
                    self.is_running = True
                    print(f"[gst-ingestor] Direct3D11 Hardware Ingestion active for {self.rtsp_url}")
                    return
            except Exception as error:
                print(f"[gst-ingestor] D3D11 pipeline launch failed, trying fallback: {error}")
                if self.pipeline:
                    self.pipeline.set_state(Gst.State.NULL)
                    self.pipeline = None

        # Mode B: Resilient Decimated Hardware-Assisted Software Reader
        self.mode = "decimated_fallback"
        self.is_running = True
        self.fallback_thread = threading.Thread(target=self._fallback_reader_loop, daemon=True)
        self.fallback_thread.start()
        print(f"[gst-ingestor] Decimated Ingestion active ({self.fps} FPS) for {self.rtsp_url}")

    def _on_new_sample(self, sink) -> Any:
        if self.stop_event.is_set():
            return Gst.FlowReturn.EOS

        sample = sink.emit("pull-sample")
        if not sample:
            return Gst.FlowReturn.ERROR

        buf = sample.get_buffer()
        success, map_info = buf.map(Gst.MapFlags.READ)

        if success:
            try:
                # Decoupled NumPy copy to safely release C-level buffer
                frame = np.ndarray(
                    shape=(self.height, self.width, 3),
                    dtype=np.uint8,
                    buffer=map_info.data,
                ).copy()

                now = time.perf_counter()
                with self.lock:
                    self.latest_frame = frame
                    self.last_frame_at = now
            finally:
                buf.unmap(map_info)

        # Explicit garbage collection on C-bindings to prevent RAM leakage
        del map_info
        del buf
        del sample

        return Gst.FlowReturn.OK

    def _on_bus_error(self, bus, msg) -> None:
        err, debug = msg.parse_error()
        print(f"[gst-ingestor] Bus Error: {err.message} | Details: {debug}")
        self._reconnect()

    def _on_bus_eos(self, bus, msg) -> None:
        print("[gst-ingestor] End-of-Stream received on bus")
        self._reconnect()

    def _reconnect(self) -> None:
        if self.stop_event.is_set() or not self.pipeline:
            return
        try:
            self.pipeline.set_state(Gst.State.NULL)
            time.sleep(max(STREAM_RECONNECT_DELAY_SECONDS, 1.0))
            self.pipeline.set_state(Gst.State.PLAYING)
        except Exception as e:
            print(f"[gst-ingestor] Reconnection exception: {e}")

    def _fallback_reader_loop(self) -> None:
        frame_interval = 1.0 / max(self.fps, 0.5)
        last_grabbed_at = 0.0

        while not self.stop_event.is_set():
            capture = None
            try:
                if self.rtsp_url.isdigit():
                    capture = cv2.VideoCapture(int(self.rtsp_url))
                else:
                    capture = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)

                capture.set(cv2.CAP_PROP_BUFFERSIZE, 1)

                while not self.stop_event.is_set() and capture.isOpened():
                    now = time.perf_counter()
                    # Hardware Frame Decimation: skip decoding if interval has not elapsed
                    if now - last_grabbed_at < frame_interval:
                        capture.grab()  # Drops frame quickly at hardware buffer level
                        time.sleep(0.01)
                        continue

                    ok, raw_frame = capture.read()
                    if not ok or raw_frame is None:
                        break

                    last_grabbed_at = now
                    # Letterbox to 640x640 to prevent YOLO aspect ratio distortion
                    letterboxed_frame, _, _, _ = letterbox_image(raw_frame, (self.width, self.height))

                    with self.lock:
                        self.latest_frame = letterboxed_frame
                        self.last_frame_at = now
            except Exception as err:
                print(f"[gst-ingestor] Fallback reader loop warning: {err}")
            finally:
                if capture is not None:
                    capture.release()

            if not self.stop_event.is_set():
                time.sleep(STREAM_RECONNECT_DELAY_SECONDS)

    def read(self, timeout: float = 1.0) -> Tuple[bool, Optional[np.ndarray]]:
        start_time = time.time()
        while time.time() - start_time < timeout:
            with self.lock:
                if self.latest_frame is not None:
                    return True, self.latest_frame
            time.sleep(0.01)
        return False, None

    def get_latest_frame(self) -> Optional[np.ndarray]:
        with self.lock:
            return self.latest_frame

    def stop(self) -> None:
        self.stop_event.set()
        self.is_running = False

        if self.pipeline:
            try:
                self.pipeline.set_state(Gst.State.NULL)
            except Exception:
                pass
            self.pipeline = None
            self.sink = None

        if self.fallback_thread and self.fallback_thread.is_alive():
            self.fallback_thread.join(timeout=1.0)
            self.fallback_thread = None
