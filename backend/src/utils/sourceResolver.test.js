import test from "node:test";
import assert from "node:assert/strict";
import { resolveSourceInput, safeNormalizeSource } from "./sourceResolver.js";
import { detectSourceType } from "./videoSource.js";

await test("source resolver normalizes and preserves direct media URLs", async () => {
  const { normalizedUrl, normalizedType } = safeNormalizeSource("rtsp://example.local/stream", "rtsp");
  assert.equal(normalizedUrl, "rtsp://example.local/stream");
  assert.equal(normalizedType, "rtsp");
});

await test("source resolver returns a resolution plan for supported stream sources", async () => {
  const plan = await resolveSourceInput({
    sourceUrl: "https://example.com/live.m3u8",
    sourceType: "hls",
  });

  assert.equal(plan.sourceType, "hls");
  assert.equal(plan.playableUrl, "https://example.com/live.m3u8");
  assert.ok(["direct", "resolved", "unresolved"].includes(plan.resolutionStatus));
});

await test("youtube urls are detected as public even when http is the preferred type", async () => {
  assert.equal(
    detectSourceType("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "http"),
    "public"
  );
});
