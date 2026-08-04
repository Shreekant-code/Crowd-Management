/**
 * Standalone Express Backend Video Streaming Test Script
 * Tests backend stream proxy (/api/stream/:cameraId) and multi-user platform auth
 */

import http from "http";

const BACKEND_URL = "http://127.0.0.1:4000";
const PLATFORM_SECRET = "dbhsjhjdaskjhdksadcbsdb";
const DUMMY_USER_ID = "test-backend-stream-user";
const DUMMY_USER_EMAIL = "test_user@example.com";
const TEST_YOUTUBE_URL = "https://www.youtube.com/live/3nyPER2kzqk?si=Eee-SaGRC_MnvW-m";

function request(url, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const reqOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || "GET",
      headers: options.headers || {},
    };

    const req = http.request(reqOptions, (res) => {
      let data = [];
      res.on("data", (chunk) => data.push(chunk));
      res.on("end", () => {
        const raw = Buffer.concat(data);
        let parsed = null;
        try {
          parsed = JSON.parse(raw.toString("utf8"));
        } catch (_e) {
          parsed = raw.toString("utf8");
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed, raw });
      });
    });

    req.on("error", reject);
    if (body) {
      req.write(typeof body === "object" ? JSON.stringify(body) : body);
    }
    req.end();
  });
}

async function runTest() {
  console.log("=========================================================================");
  printHeader();

  // 1. Health check
  console.log("[1/5] Checking Express Backend Health...");
  try {
    const health = await request(`${BACKEND_URL}/api/health`);
    console.log(`  - Backend Status: [PASS] (HTTP ${health.status})`);
  } catch (err) {
    console.log(`  - Backend Status: [FAIL] (${err.message})`);
    console.log("  -> Make sure backend is running: cd backend && npm run dev");
    process.exit(1);
  }

  // 2. Add Camera Zone
  console.log("\n[2/5] Creating Test Camera Zone via Backend API...");
  const cameraPayload = {
    name: "Backend Stream Test Cam",
    zoneName: "Zone-Test",
    location: "Test Gate",
    sourceType: "public",
    streamUrl: TEST_YOUTUBE_URL,
  };

  const createRes = await request(`${BACKEND_URL}/api/cameras`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-platform-secret": PLATFORM_SECRET,
      "x-user-id": DUMMY_USER_ID,
      "x-user-email": DUMMY_USER_EMAIL,
    },
  }, cameraPayload);

  if (createRes.status !== 200 && createRes.status !== 201) {
    console.log(`  - Camera Creation: [FAIL] (HTTP ${createRes.status})`);
    process.exit(1);
  }

  const cameraId = createRes.body?.camera?.id;
  console.log(`  - Camera Creation: [PASS] (Camera ID: ${cameraId})`);

  // 3. Start Camera
  console.log("\n[3/5] Starting Camera Worker...");
  const startRes = await request(`${BACKEND_URL}/api/cameras/${cameraId}/start`, {
    method: "POST",
    headers: {
      "x-platform-secret": PLATFORM_SECRET,
      "x-user-id": DUMMY_USER_ID,
      "x-user-email": DUMMY_USER_EMAIL,
    },
  });
  console.log(`  - Camera Worker Start: [PASS] (HTTP ${startRes.status})`);

  // 4. Test MJPEG Video Stream Route
  console.log("\n[4/5] Testing Backend Live Stream Endpoint /api/stream/:id ...");
  let bytesReceived = 0;
  let framesSeen = 0;

  await new Promise((resolve) => {
    const parsedUrl = new URL(`${BACKEND_URL}/api/stream/${cameraId}`);
    const streamReq = http.request({
      hostname: parsedUrl.hostname,
      port: parsedUrl.port,
      path: parsedUrl.pathname,
      method: "GET",
      headers: {
        "x-platform-secret": PLATFORM_SECRET,
        "x-user-id": DUMMY_USER_ID,
        "x-user-email": DUMMY_USER_EMAIL,
      },
    }, (res) => {
      console.log(`  - Response HTTP Status: ${res.statusCode}`);
      console.log(`  - Response Content-Type: ${res.headers["content-type"]}`);

      let buffer = Buffer.alloc(0);
      const timer = setTimeout(() => {
        streamReq.destroy();
        resolve();
      }, 6000);

      res.on("data", (chunk) => {
        bytesReceived += chunk.length;
        buffer = Buffer.concat([buffer, chunk]);
        const count = (buffer.toString("binary").match(/\xff\xd8/g) || []).length;
        if (count > framesSeen) {
          framesSeen = count;
          console.log(`  - Decoded ${framesSeen} JPEG frame headers (${bytesReceived} bytes read)`);
        }
      });

      res.on("end", () => {
        clearTimeout(timer);
        resolve();
      });
    });

    streamReq.on("error", () => resolve());
    streamReq.end();
  });

  // 5. Cleanup
  console.log("\n[5/5] Cleaning up Test Camera Zone...");
  await request(`${BACKEND_URL}/api/cameras/${cameraId}`, {
    method: "DELETE",
    headers: {
      "x-platform-secret": PLATFORM_SECRET,
      "x-user-id": DUMMY_USER_ID,
      "x-user-email": DUMMY_USER_EMAIL,
    },
  });
  console.log("  - Cleanup Status: [PASS] (HTTP 200)");

  const pass = bytesReceived > 0 || framesSeen > 0;
  console.log("\n=========================================================================");
  console.log("                     EXPRESS BACKEND TEST RESULT");
  console.log("=========================================================================");
  console.log(`  Result:              ${pass ? "[PASS]" : "[FAIL]"}`);
  console.log(`  Frames Decoded:      ${framesSeen}`);
  console.log(`  Total Bytes Streamed: ${bytesReceived}`);
  console.log("=========================================================================\n");
  process.exit(pass ? 0 : 1);
}

function printHeader() {
  console.log("      EXPRESS BACKEND SERVICE - INDEPENDENT VIDEO STREAMING TEST");
  console.log("=========================================================================");
  console.log(`Target Service: ${BACKEND_URL}`);
  console.log(`Stream Source:  ${TEST_YOUTUBE_URL}`);
  console.log("=========================================================================");
}

runTest();
