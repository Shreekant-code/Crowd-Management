import http from "http";
import https from "https";

const CAMERA_ID = "808a5c66-1a83-4ab6-b70d-4a502895d5b9";
const YOUTUBE_SOURCE = "https://www.youtube.com/live/3nyPER2kzqk?si=Eee-SaGRC_MnvW-m";
const PLATFORM_SECRET = process.env.PLATFORM_API_SECRET || "dbhsjhjdaskjhdksadcbsdb";
const USER_ID = "e57605de-ba09-43a5-90c1-ee2d135be57c";

function testStreamUrl(caseName, url, headers = {}) {
  return new Promise((resolve) => {
    console.log(`\n==================================================`);
    console.log(`[TEST] ${caseName}`);
    console.log(`[URL]  ${url}`);
    console.log(`==================================================`);

    const req = http.get(url, { headers, timeout: 8000 }, (res) => {
      console.log(`[Response] HTTP Status: ${res.statusCode} ${res.statusMessage}`);
      console.log(`[Response] Content-Type: ${res.headers["content-type"] || "NONE"}`);
      console.log(`[Response] Connection: ${res.headers["connection"] || "NONE"}`);

      let bytesReceived = 0;
      let firstChunkReceived = false;

      res.on("data", (chunk) => {
        bytesReceived += chunk.length;
        if (!firstChunkReceived) {
          firstChunkReceived = true;
          const preview = chunk.slice(0, 100).toString("ascii", 0, Math.min(100, chunk.length));
          console.log(`[Chunk]  Received first data chunk (${chunk.length} bytes):`);
          console.log(`-------- CHUNK HEAD --------\n${preview}\n----------------------------`);

          const isMultipart = (res.headers["content-type"] || "").includes("multipart/x-mixed-replace");
          const hasFrameHeader = preview.includes("--frame") || preview.includes("Content-Type: image/jpeg");
          const hasJpegMarker = chunk.includes(Buffer.from([0xff, 0xd8]));

          if (res.statusCode === 200 && isMultipart && (hasFrameHeader || hasJpegMarker)) {
            console.log(`✅ SUCCESS: ${caseName} returned a valid, live MJPEG stream!`);
          } else {
            console.log(`⚠️ WARNING: ${caseName} returned HTTP ${res.statusCode} but boundary/JPEG markers need review.`);
          }

          req.destroy();
          resolve(true);
        }
      });

      res.on("error", (err) => {
        console.error(`❌ ERROR reading stream data for ${caseName}:`, err.message);
        resolve(false);
      });
    });

    req.on("error", (err) => {
      console.error(`❌ ERROR connecting to ${caseName}:`, err.message);
      resolve(false);
    });

    req.on("timeout", () => {
      console.error(`⏰ TIMEOUT connecting to ${caseName} (server did not respond in 8 seconds)`);
      req.destroy();
      resolve(false);
    });
  });
}

async function runAllTests() {
  console.log("Starting 3-Case Stream Pipeline Test...");

  // Case 1: Direct Python AI Service (Port 8001)
  await testStreamUrl(
    "Case 1: Direct Python AI Service Stream",
    `http://127.0.0.1:8001/camera/${CAMERA_ID}/live?source=${encodeURIComponent(YOUTUBE_SOURCE)}`
  );

  // Case 2: Express Backend Stream Proxy (Port 4000)
  await testStreamUrl(
    "Case 2: Express Backend Stream Proxy",
    `http://127.0.0.1:4000/api/stream/${CAMERA_ID}`,
    {
      "x-platform-secret": PLATFORM_SECRET,
      "x-user-id": USER_ID,
      "x-user-email": "user@crowd.local",
    }
  );

  // Case 3: Next.js Frontend Stream Proxy (Port 3000)
  await testStreamUrl(
    "Case 3: Next.js Frontend Stream Proxy",
    `http://127.0.0.1:3000/api/stream/${CAMERA_ID}`
  );

  console.log("\n==================================================");
  console.log("All 3-Case Stream Pipeline Tests Completed!");
  console.log("==================================================\n");
}

runAllTests();
