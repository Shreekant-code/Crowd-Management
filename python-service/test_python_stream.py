"""
Standalone Python AI Service Video Streaming Test
Tests live MJPEG video streaming endpoints directly on Python Service (Port 8001)
"""

import sys
import time
import urllib.parse
import urllib.request

PYTHON_SERVICE_URL = "http://127.0.0.1:8001"
TEST_STREAM_URL = "https://www.youtube.com/live/3nyPER2kzqk?si=Eee-SaGRC_MnvW-m"
CAMERA_ID = "test-python-stream-cam"

def run_test():
    print("=========================================================================")
    print("      PYTHON AI SERVICE - INDEPENDENT VIDEO STREAMING TEST")
    print("=========================================================================")
    print(f"Target Service: {PYTHON_SERVICE_URL}")
    print(f"Stream Source:  {TEST_STREAM_URL}")
    print("=========================================================================\n")

    # Step 1: Health check
    print("[1/3] Checking Python Service health...")
    try:
        with urllib.request.urlopen(f"{PYTHON_SERVICE_URL}/openapi.json", timeout=5) as resp:
            if resp.status == 200:
                print("  - Python Service Health: [PASS] (HTTP 200)")
            else:
                print(f"  - Python Service Health: [FAIL] (HTTP {resp.status})")
                return 1
    except Exception as err:
        print(f"  - Python Service Health: [FAIL] ({err})")
        print("  -> Please start Python service: .\\.venv\\Scripts\\python.exe -m uvicorn main:app --host 127.0.0.1 --port 8001")
        return 1

    # Step 2: Trigger stream start
    print("\n[2/3] Registering stream processor...")
    req_body = urllib.parse.urlencode({}).encode('utf-8')
    url_encoded_source = urllib.parse.quote(TEST_STREAM_URL)
    stream_endpoint = f"{PYTHON_SERVICE_URL}/camera/{CAMERA_ID}/live?source={url_encoded_source}"

    print(f"  - Connecting to MJPEG stream route: /camera/{CAMERA_ID}/live")

    # Step 3: Connect and read MJPEG stream chunks
    print("\n[3/3] Reading live MJPEG frames from Python Service...")
    frames_received = 0
    bytes_received = 0
    start_time = time.time()
    jpeg_header = b"\xff\xd8"

    try:
        req = urllib.request.Request(stream_endpoint, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=12) as response:
            content_type = response.headers.get("Content-Type", "")
            print(f"  - Response HTTP Status: {response.status}")
            print(f"  - Response Content-Type: {content_type}")

            buffer = b""
            while time.time() - start_time < 8:
                chunk = response.read(64)
                if not chunk:
                    break
                bytes_received += len(chunk)
                buffer += chunk

                frames_received = buffer.count(jpeg_header)
                if bytes_received > 0:
                    print(f"  - Received {bytes_received} stream bytes ({frames_received} JPEG frames)")
                    if frames_received >= 1:
                        break

    except Exception as err:
        print(f"  - Stream Read Error: {err}")

    # Summary
    success = frames_received > 0 or bytes_received > 50000
    print("\n=========================================================================")
    print("                     PYTHON SERVICE TEST RESULT")
    print("=========================================================================")
    print(f"  Result:              {'[PASS]' if success else '[FAIL]'}")
    print(f"  Frames Received:     {frames_received}")
    print(f"  Total Bytes Read:    {bytes_received}")
    print("=========================================================================\n")
    return 0 if success else 1

if __name__ == "__main__":
    sys.exit(run_test())
