/**
 * Standalone Next.js Frontend Video Streaming & Proxy Route Test Script
 */

import http from "http";

const FRONTEND_URL = "http://localhost:3000";

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, data }));
    });
    req.on("error", reject);
  });
}

async function runTest() {
  console.log("=========================================================================");
  console.log("      NEXT.JS FRONTEND - INDEPENDENT VIDEO STREAMING TEST");
  console.log("=========================================================================");
  console.log(`Target Frontend: ${FRONTEND_URL}`);
  console.log("=========================================================================\n");

  console.log("[1/2] Checking Next.js Frontend App Health...");
  let feOk = false;
  try {
    const res = await fetchUrl(FRONTEND_URL);
    feOk = res.status === 200 || res.status === 307 || res.status === 308 || res.status === 302;
    console.log(`  - Frontend App Status: ${feOk ? "[PASS]" : "[FAIL]"} (HTTP ${res.status})`);
  } catch (err) {
    console.log(`  - Frontend App Status: [FAIL] (${err.message})`);
    console.log("  -> Make sure frontend is running: cd frontend && npm run dev");
  }

  console.log("\n[2/2] Checking Frontend API Proxy Authorization Check...");
  let authOk = false;
  try {
    const res = await fetchUrl(`${FRONTEND_URL}/api/stream/test-cam-id`);
    authOk = res.status === 401; // Expected 401 Unauthorized without session
    console.log(`  - Stream Route Auth Enforcement: ${authOk ? "[PASS]" : "[FAIL]"} (HTTP ${res.status})`);
  } catch (err) {
    console.log(`  - Stream Route Check: [FAIL] (${err.message})`);
  }

  const pass = feOk && authOk;
  console.log("\n=========================================================================");
  console.log("                     NEXT.JS FRONTEND TEST RESULT");
  console.log("=========================================================================");
  console.log(`  Result:              ${pass ? "[PASS]" : "[FAIL]"}`);
  console.log("=========================================================================\n");
  process.exit(pass ? 0 : 1);
}

runTest();
