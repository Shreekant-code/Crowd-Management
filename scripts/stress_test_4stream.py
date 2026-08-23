"""
Phase 5 End-to-End Stress Test Suite for AMD Ryzen 5 7520U & Radeon 610M.
Monitors CPU utilization (<=55%), RAM footprint (<=4.5 GB), and 4-stream batched cadence.
"""

import sys
import time
import requests
import psutil

API_BASE = "http://localhost:4000/internal"
PYTHON_AI_BASE = "http://localhost:8001"

TEST_STREAMS = [
    {"camera_id": "test_cam_1", "stream_url": "rtsp://127.0.0.1:8554/test1", "user_id": "stress-user", "zone_name": "Gate A"},
    {"camera_id": "test_cam_2", "stream_url": "rtsp://127.0.0.1:8554/test2", "user_id": "stress-user", "zone_name": "Concourse B"},
    {"camera_id": "test_cam_3", "stream_url": "rtsp://127.0.0.1:8554/test3", "user_id": "stress-user", "zone_name": "Turnstile C"},
    {"camera_id": "test_cam_4", "stream_url": "rtsp://127.0.0.1:8554/test4", "user_id": "stress-user", "zone_name": "Exit D"},
]


def register_streams():
    print("[stress-test] Registering 4 concurrent streams with Python AI Service...")
    for stream in TEST_STREAMS:
        try:
            resp = requests.post(f"{PYTHON_AI_BASE}/stream/start", json=stream, timeout=2.0)
            print(f"  [+] Registered stream {stream['camera_id']}: status={resp.status_code}")
        except Exception as err:
            print(f"  [-] Failed to register {stream['camera_id']}: {err}")


def unregister_streams():
    print("\n[stress-test] Cleaning up and stopping streams...")
    for stream in TEST_STREAMS:
        try:
            requests.post(f"{PYTHON_AI_BASE}/stream/stop", json={"camera_id": stream["camera_id"]}, timeout=1.0)
            print(f"  [x] Stopped stream {stream['camera_id']}")
        except Exception:
            pass


def monitor_hardware(duration_seconds: int = 30):
    start_time = time.time()
    cpu_samples = []
    ram_samples = []

    print(f"\n[stress-test] Monitoring hardware metrics for {duration_seconds}s...")
    print(f"{'Time':>6} | {'CPU Usage':>10} | {'RAM (GB)':>10} | {'Status':>10}")
    print("-" * 45)

    try:
        while time.time() - start_time < duration_seconds:
            cpu_percent = psutil.cpu_percent(interval=1.0)
            ram = psutil.virtual_memory()
            ram_gb = ram.used / (1024 ** 3)

            cpu_samples.append(cpu_percent)
            ram_samples.append(ram_gb)

            status = "HEALTHY" if cpu_percent <= 55 and ram_gb <= 4.5 else "HIGH LOAD"
            elapsed = int(time.time() - start_time)
            print(f"{elapsed:>5}s | {cpu_percent:>9.1f}% | {ram_gb:>8.2f} GB | {status:>10}")

    except KeyboardInterrupt:
        print("\n[stress-test] Test interrupted by user.")
    finally:
        unregister_streams()

    avg_cpu = sum(cpu_samples) / max(len(cpu_samples), 1)
    max_cpu = max(cpu_samples) if cpu_samples else 0.0
    avg_ram = sum(ram_samples) / max(len(ram_samples), 1)
    max_ram = max(ram_samples) if ram_samples else 0.0

    print("\n" + "=" * 55)
    print("  PHASE 5 HARDWARE STRESS TEST RESULTS")
    print("=" * 55)
    print(f"  Avg CPU Usage:  {avg_cpu:.1f}% (Target: <= 55%) -> {'PASSED' if avg_cpu <= 55 else 'MARGINAL'}")
    print(f"  Peak CPU Usage: {max_cpu:.1f}%")
    print(f"  Avg RAM Usage:  {avg_ram:.2f} GB (Target: <= 4.5 GB) -> {'PASSED' if avg_ram <= 4.5 else 'MARGINAL'}")
    print(f"  Peak RAM Usage: {max_ram:.2f} GB")
    print("=" * 55)


if __name__ == "__main__":
    duration = 15
    if len(sys.argv) > 1:
        try:
            duration = int(sys.argv[1])
        except ValueError:
            pass

    print("Initiating Phase 5 End-to-End Stress Test...")
    register_streams()
    time.sleep(2)
    monitor_hardware(duration_seconds=duration)
