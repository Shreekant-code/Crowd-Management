import http from "http";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const CAMERA_ID = "808a5c66-1a83-4ab6-b70d-4a502895d5b9";
const YOUTUBE_SOURCE = "https://www.youtube.com/live/3nyPER2kzqk?si=Eee-SaGRC_MnvW-m";
const PLATFORM_SECRET = process.env.PLATFORM_API_SECRET || "dbhsjhjdaskjhdksadcbsdb";
const USER_ID = "e57605de-ba09-43a5-90c1-ee2d135be57c";

const spawnedProcesses = [];

function checkEndpoint(url, headers = {}) {
  return new Promise((resolve) => {
    const req = http.get(url, { headers, timeout: 3000 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 400);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

function waitForService(name, url, timeoutMs = 20000) {
  const start = Date.now();
  console.log(`[Diagnostic] Waiting for ${name} to become ready on ${url}...`);

  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      const isHealthy = await checkEndpoint(url);
      if (isHealthy) {
        clearInterval(interval);
        console.log(`[Diagnostic] ✅ ${name} is UP and healthy!`);
        resolve(true);
      } else if (Date.now() - start > timeoutMs) {
        clearInterval(interval);
        reject(new Error(`Timed out waiting for ${name} at ${url}`));
      }
    }, 1000);
  });
}

async function ensureServicesRunning() {
  console.log("==================================================");
  console.log("1. Checking Service Health Across Ports");
  console.log("==================================================");

  const pythonUp = await checkEndpoint("http://127.0.0.1:8001/health");
  const backendUp = await checkEndpoint("http://127.0.0.1:4000/api/health");
  const frontendUp = await checkEndpoint("http://127.0.0.1:3000");

  console.log(`Python AI Service (Port 8001): ${pythonUp ? "RUNNING" : "NOT RUNNING"}`);
  console.log(`Express Backend   (Port 4000): ${backendUp ? "RUNNING" : "NOT RUNNING"}`);
  console.log(`Next.js Frontend  (Port 3000): ${frontendUp ? "RUNNING" : "NOT RUNNING"}`);

  if (!pythonUp) {
    console.log("\n[Launcher] Starting Python AI Service on port 8001...");
    const pythonProc = spawn(
      path.join(rootDir, ".venv", "Scripts", "python.exe"),
      ["-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"],
      { cwd: path.join(rootDir, "python-service"), stdio: "inherit", shell: true }
    );
    spawnedProcesses.push(pythonProc);
    await waitForService("Python AI Service", "http://127.0.0.1:8001/health");
  }

  if (!backendUp) {
    console.log("\n[Launcher] Starting Express Backend on port 4000...");
    const backendProc = spawn("node", ["src/server.js"], {
      cwd: path.join(rootDir, "backend"),
      stdio: "inherit",
      shell: true,
    });
    spawnedProcesses.push(backendProc);
    await waitForService("Express Backend", "http://127.0.0.1:4000/api/health");
  }

  if (!frontendUp) {
    console.log("\n[Launcher] Starting Next.js Frontend dev server on port 3000...");
    const frontendProc = spawn("npm", ["run", "dev"], {
      cwd: path.join(rootDir, "frontend"),
      stdio: "inherit",
      shell: true,
    });
    spawnedProcesses.push(frontendProc);
    await waitForService("Next.js Frontend", "http://127.0.0.1:3000");
  }
}

function startCameraInBackend() {
  return new Promise((resolve) => {
    console.log(`\n[Backend] Activating camera=${CAMERA_ID} status to 'running'...`);
    const data = JSON.stringify({ action: "start" });
    const req = http.request(
      `http://127.0.0.1:4000/api/cameras/${CAMERA_ID}/start`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-platform-secret": PLATFORM_SECRET,
          "x-user-id": USER_ID,
          "x-user-email": "user@crowd.local",
        },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          console.log(`[Backend] Start camera response (HTTP ${res.statusCode}): ${body.slice(0, 120)}`);
          resolve(res.statusCode < 400);
        });
      }
    );
    req.on("error", (err) => {
      console.warn(`[Backend] Warning triggering camera start: ${err.message}`);
      resolve(false);
    });
    req.write(data);
    req.end();
  });
}

function testStreamLayer(caseName, url, headers = {}) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    console.log(`\n--------------------------------------------------`);
    console.log(`[TEST] ${caseName}`);
    console.log(`[URL]  ${url}`);
    console.log(`--------------------------------------------------`);

    const req = http.get(url, { headers, timeout: 10000 }, (res) => {
      const contentType = res.headers["content-type"] || "";
      const connection = res.headers["connection"] || "";
      const ttffMs = Date.now() - startTime;

      console.log(`HTTP Status : ${res.statusCode} ${res.statusMessage}`);
      console.log(`Content-Type: ${contentType}`);
      console.log(`Connection  : ${connection}`);
      console.log(`Time-To-Header: ${ttffMs}ms`);

      let firstChunkReceived = false;

      res.on("data", (chunk) => {
        if (!firstChunkReceived) {
          firstChunkReceived = true;
          const latencyMs = Date.now() - startTime;
          const snippet = chunk.slice(0, 120).toString("ascii", 0, Math.min(120, chunk.length));
          const hasBoundary = contentType.includes("multipart/x-mixed-replace") || snippet.includes("--frame");
          const hasJpegMarker = chunk.includes(Buffer.from([0xff, 0xd8]));

          console.log(`First Chunk : ${chunk.length} bytes (Latency: ${latencyMs}ms)`);
          console.log(`Chunk Sample:\n>>> ${snippet.replace(/\r\n/g, "\\r\\n\n>>> ")}`);
          console.log(`Has Boundary Header : ${hasBoundary ? "YES ✅" : "NO ❌"}`);
          console.log(`Has JPEG Start (FF D8): ${hasJpegMarker ? "YES ✅" : "NO ❌"}`);

          req.destroy();

          if (res.statusCode === 200 && hasBoundary) {
            console.log(`\nResult: ✅ SUCCESS - ${caseName} is operational!`);
            resolve({ success: true, statusCode: res.statusCode, contentType, latencyMs });
          } else {
            console.log(`\nResult: ⚠️ WARNING - ${caseName} returned status ${res.statusCode}`);
            resolve({ success: false, statusCode: res.statusCode, contentType, latencyMs });
          }
        }
      });

      res.on("error", (err) => {
        console.error(`Result: ❌ ERROR - Data stream error: ${err.message}`);
        resolve({ success: false, error: err.message });
      });
    });

    req.on("error", (err) => {
      console.error(`Result: ❌ ERROR - Connection failed: ${err.message}`);
      resolve({ success: false, error: err.message });
    });

    req.on("timeout", () => {
      console.error(`Result: ⏰ TIMEOUT - Server did not respond within 10s`);
      req.destroy();
      resolve({ success: false, error: "timeout" });
    });
  });
}

async function runIntegratedDiagnostic() {
  try {
    await ensureServicesRunning();
    await startCameraInBackend();

    console.log("\n==================================================");
    console.log("2. Running 3-Layer Stream Pipeline Diagnostics");
    console.log("==================================================");

    // Case 1: Direct Python AI Service (Port 8001)
    const case1 = await testStreamLayer(
      "Case 1: Python AI Service Direct Stream (Port 8001)",
      `http://127.0.0.1:8001/camera/${CAMERA_ID}/live?source=${encodeURIComponent(YOUTUBE_SOURCE)}`
    );

    // Case 2: Express Backend Stream Proxy (Port 4000)
    const case2 = await testStreamLayer(
      "Case 2: Express Backend Stream Proxy (Port 4000)",
      `http://127.0.0.1:4000/api/stream/${CAMERA_ID}`,
      {
        "x-platform-secret": PLATFORM_SECRET,
        "x-user-id": USER_ID,
        "x-user-email": "user@crowd.local",
      }
    );

    // Case 3: Next.js Frontend Stream Proxy (Port 3000)
    const case3 = await testStreamLayer(
      "Case 3: Next.js Frontend Stream Proxy (Port 3000)",
      `http://127.0.0.1:3000/api/stream/${CAMERA_ID}`
    );

    console.log("\n==================================================");
    console.log("3. Root Cause Diagnostic Summary");
    console.log("==================================================");
    console.log(`Layer 1 (Python AI Service) : ${case1.success ? "✅ OPERATIONAL" : "❌ FAILED (" + (case1.error || case1.statusCode) + ")"}`);
    console.log(`Layer 2 (Express Backend)   : ${case2.success ? "✅ OPERATIONAL" : "❌ FAILED (" + (case2.error || case2.statusCode) + ")"}`);
    console.log(`Layer 3 (Next.js Frontend)  : ${case3.success ? "✅ OPERATIONAL" : "❌ FAILED (" + (case3.error || case3.statusCode) + ")"}`);

    if (case1.success && case2.success && case3.success) {
      console.log("\n🎉 VERDICT: All 3 streaming layers are 100% operational and delivering valid MJPEG streams!");
    } else if (!case1.success) {
      console.log("\n🚨 VERDICT: Root cause is at Layer 1 (Python AI Service). Check YouTube stream loader resolution.");
    } else if (!case2.success) {
      console.log("\n🚨 VERDICT: Root cause is at Layer 2 (Express Backend). Check backend streamController proxy.");
    } else if (!case3.success) {
      console.log("\n🚨 VERDICT: Root cause is at Layer 3 (Next.js Frontend). Check Next.js auth session or route handler.");
    }

    console.log("==================================================\n");
  } catch (error) {
    console.error("Diagnostic execution error:", error);
  } finally {
    spawnedProcesses.forEach((proc) => {
      try {
        proc.kill();
      } catch (e) {}
    });
  }
}

runIntegratedDiagnostic();
