"""
YouTube Service Connection & Integration Test Script
Tests end-to-end connectivity between Frontend, Backend, and Python AI Service
using dummy data with YouTube live stream:
https://www.youtube.com/live/3nyPER2kzqk?si=Eee-SaGRC_MnvW-m
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request

# Configuration defaults
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:3000")
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:4000")
PYTHON_SERVICE_URL = os.getenv("PYTHON_SERVICE_URL", "http://127.0.0.1:8001")
PLATFORM_SECRET = os.getenv("PLATFORM_API_SECRET", "dbhsjhjdaskjhdksadcbsdb")
YOUTUBE_TEST_URL = "https://www.youtube.com/live/3nyPER2kzqk?si=Eee-SaGRC_MnvW-m"

DUMMY_USER = {
    "id": "dummy_test_user_77",
    "email": "dummy_test_user@example.com",
}

def make_http_request(url, method="GET", body=None, headers=None, timeout=10):
    req_headers = headers or {}
    data = None
    if body is not None:
        if isinstance(body, dict):
            data = json.dumps(body).encode("utf-8")
            req_headers["Content-Type"] = "application/json"
        elif isinstance(body, bytes):
            data = body

    req = urllib.request.Request(url, data=data, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as response:
            status = response.status
            content_type = response.headers.get("Content-Type", "")
            raw_data = response.read()
            if "application/json" in content_type:
                return status, json.loads(raw_data.decode("utf-8"))
            return status, raw_data.decode("utf-8", errors="replace")
    except urllib.error.HTTPError as error:
        raw_data = error.read()
        try:
            return error.code, json.loads(raw_data.decode("utf-8"))
        except Exception:
            return error.code, raw_data.decode("utf-8", errors="replace")
    except Exception as error:
        return 0, str(error)


def run_tests():
    print("=========================================================================")
    print("   CROWD MANAGEMENT PLATFORM - YOUTUBE SERVICE CONNECTION TEST")
    print("=========================================================================")
    print(f"Target YouTube Link: {YOUTUBE_TEST_URL}")
    print(f"Frontend URL:        {FRONTEND_URL}")
    print(f"Backend URL:         {BACKEND_URL}")
    print(f"Python Service URL:  {PYTHON_SERVICE_URL}")
    print("=========================================================================\n")

    results = []
    
    # -------------------------------------------------------------------------
    # STEP 1: Service Health Checks
    # -------------------------------------------------------------------------
    print("[1/5] Checking service health...")

    # Check Python AI Service
    py_status, py_res = make_http_request(f"{PYTHON_SERVICE_URL}/openapi.json")
    py_ok = py_status == 200
    results.append(("Python AI Service (Port 8001)", py_ok, f"Status: {py_status}"))
    print(f"  - Python AI Service (Port 8001): {'[PASS]' if py_ok else '[FAIL]'} (HTTP {py_status})")

    # Check Backend Express Service
    be_status, be_res = make_http_request(f"{BACKEND_URL}/health")
    if be_status != 200:
        be_status, be_res = make_http_request(f"{BACKEND_URL}/api/cameras", headers={
            "x-platform-secret": PLATFORM_SECRET,
            "x-user-id": DUMMY_USER["id"],
            "x-user-email": DUMMY_USER["email"]
        })
    be_ok = be_status == 200
    results.append(("Backend Express API (Port 4000)", be_ok, f"Status: {be_status}"))
    print(f"  - Express Backend API (Port 4000): {'[PASS]' if be_ok else '[FAIL]'} (HTTP {be_status})")

    # Check Frontend Next.js Service
    fe_status, fe_res = make_http_request(f"{FRONTEND_URL}/")
    fe_ok = fe_status in [200, 301, 302, 307, 308]
    results.append(("Frontend Next.js App (Port 3000)", fe_ok, f"Status: {fe_status}"))
    print(f"  - Next.js Frontend (Port 3000):    {'[PASS]' if fe_ok else '[FAIL]'} (HTTP {fe_status})\n")

    if not (py_ok and be_ok and fe_ok):
        print("[NOTICE] One or more services are currently offline.")
        print("Please launch all 3 services in separate terminals using:")
        print("  -> run_services.bat (Windows CMD)")
        print("  -> .\\run_services.ps1 (PowerShell)")
        print("  -> npm run dev:all\n")

    # -------------------------------------------------------------------------
    # STEP 2: Python Service Stream Resolution Check
    # -------------------------------------------------------------------------
    print("[2/5] Testing YouTube Stream Resolution in Python AI Service...")
    cam_id = f"test-yt-cam-{int(time.time())}"
    
    py_stream_ok = False
    start_status, start_res = make_http_request(
        f"{PYTHON_SERVICE_URL}/streams/start",
        method="POST",
        body={
            "camera_id": cam_id,
            "stream_url": YOUTUBE_TEST_URL,
            "user_id": DUMMY_USER["id"],
            "zone_name": "Dummy-Zone-YouTube"
        }
    )
    
    if isinstance(start_res, dict):
        py_stream_ok = (start_status in [200, 429]) and (start_res.get("status") in ["started", "running", "already_running", "processing_started", "connecting"] or start_status == 429)
        res_desc = start_res.get("status", "unknown")
    else:
        res_desc = f"Offline / Error ({start_status})"

    results.append(("Python Stream Resolution", py_stream_ok, f"Status: {start_status}, Res: {res_desc}"))
    print(f"  - YouTube Stream Start: {'[PASS]' if py_stream_ok else '[FAIL]'} ({res_desc})\n")

    # -------------------------------------------------------------------------
    # STEP 3: Frontend / Backend Camera Registration with Dummy Data
    # -------------------------------------------------------------------------
    print("[3/5] Registering Camera via Backend Platform API with Dummy Data...")
    dummy_camera_payload = {
        "name": "YouTube Live Dummy Camera",
        "zoneName": "Zone-A-North",
        "location": "North Entrance Stadium",
        "sourceType": "public",
        "streamUrl": YOUTUBE_TEST_URL,
    }

    create_status, create_res = make_http_request(
        f"{BACKEND_URL}/api/cameras",
        method="POST",
        body=dummy_camera_payload,
        headers={
            "x-platform-secret": PLATFORM_SECRET,
            "x-user-id": DUMMY_USER["id"],
            "x-user-email": DUMMY_USER["email"]
        }
    )

    created_cam_id = None
    create_ok = isinstance(create_res, dict) and create_status in [200, 201] and "camera" in create_res
    if create_ok:
        created_cam_id = create_res["camera"]["id"]
        print(f"  - Camera created successfully! ID: {created_cam_id}")
    else:
        print(f"  - Camera creation response: {create_status} -> {create_res}")

    results.append(("Backend Camera Creation", create_ok, f"Status: {create_status}"))
    print(f"  - Camera Creation: {'[PASS]' if create_ok else '[FAIL]'}\n")

    # -------------------------------------------------------------------------
    # STEP 4: Start Camera Worker & Poll Real AI Stream Analytics
    # -------------------------------------------------------------------------
    analytics_ok = False
    metrics_desc = "Not tested"
    if created_cam_id:
        print("[4/5] Starting Camera Worker & Polling YouTube Analytics Stream...")
        start_worker_status, start_worker_res = make_http_request(
            f"{BACKEND_URL}/api/cameras/{created_cam_id}/start",
            method="POST",
            headers={
                "x-platform-secret": PLATFORM_SECRET,
                "x-user-id": DUMMY_USER["id"],
                "x-user-email": DUMMY_USER["email"]
            }
        )
        print(f"  - Worker Start Command Status: {start_worker_status}")

        print("  - Waiting for stream resolution and frame decoding (8 seconds)...")
        time.sleep(8)

        # Fetch latest metrics from backend
        stats_status, stats_res = make_http_request(
            f"{BACKEND_URL}/api/cameras",
            method="GET",
            headers={
                "x-platform-secret": PLATFORM_SECRET,
                "x-user-id": DUMMY_USER["id"],
                "x-user-email": DUMMY_USER["email"]
            }
        )

        if stats_status == 200 and isinstance(stats_res, dict) and "cameras" in stats_res:
            for cam in stats_res["cameras"]:
                if cam.get("id") == created_cam_id:
                    metrics_found = cam.get("metrics", {})
                    resolution_status = metrics_found.get("stream_resolution_status", "unknown")
                    metrics_desc = f"Resolution: {resolution_status}, Count: {metrics_found.get('people_count', 0)}"
                    print(f"  - Stream Resolution Status: {resolution_status}")
                    print(f"  - Decoded People Count:      {metrics_found.get('people_count', 0)}")
                    print(f"  - Risk Score / Level:        {metrics_found.get('risk', 'N/A')}")
                    print(f"  - Stream Processing Status:  {metrics_found.get('processing_status', 'N/A')}")
                    if resolution_status in ["youtube_resolved", "public_resolved", "resolved"] or cam.get("status") == "running":
                        analytics_ok = True
                    break

        results.append(("Live Stream Analytics Poll", analytics_ok, metrics_desc))
        print(f"  - Live Analytics Pipeline: {'[PASS]' if analytics_ok else '[FAIL]'}\n")

        # -------------------------------------------------------------------------
        # STEP 5: Cleanup Dummy Test Camera
        # -------------------------------------------------------------------------
        print("[5/5] Cleaning up Dummy Camera...")
        del_status, _ = make_http_request(
            f"{BACKEND_URL}/api/cameras/{created_cam_id}",
            method="DELETE",
            headers={
                "x-platform-secret": PLATFORM_SECRET,
                "x-user-id": DUMMY_USER["id"],
                "x-user-email": DUMMY_USER["email"]
            }
        )
        print(f"  - Cleanup Status: {del_status}\n")
    else:
        results.append(("Live Stream Analytics Poll", False, "Skipped (Backend unreachable)"))
        print("[4/5] Skipping camera worker start (Backend unreachable)")
        print("[5/5] Skipping camera cleanup\n")

    # Stop Python stream test
    if py_ok:
        make_http_request(
            f"{PYTHON_SERVICE_URL}/streams/stop",
            method="POST",
            body={"camera_id": cam_id}
        )

    # -------------------------------------------------------------------------
    # FINAL SUMMARY REPORT
    # -------------------------------------------------------------------------
    print("=========================================================================")
    print("                     TEST EXECUTION SUMMARY REPORT")
    print("=========================================================================")
    passed_count = sum(1 for _, ok, _ in results if ok)
    total_count = len(results)

    for item_name, ok, details in results:
        badge = "[PASS]" if ok else "[FAIL]"
        print(f"  {badge:<7} | {item_name:<32} | {details}")

    print("=========================================================================")
    print(f"Result: {passed_count}/{total_count} steps passed.")
    print("=========================================================================\n")

    return 0 if passed_count == total_count else 1


if __name__ == "__main__":
    sys.exit(run_tests())
