import {
  aiRequestTimeoutMs,
  aiRetryCount,
  pythonServiceUrl,
} from "../config/env.js";

function buildUrl(path) {
  return new URL(path, pythonServiceUrl).toString();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function requestJson(path, options = {}) {
  const {
    method = "GET",
    body,
    timeoutMs = aiRequestTimeoutMs,
    retries = aiRetryCount,
    headers = {},
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(buildUrl(path), {
        method,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`AI service request failed with status ${response.status}`);
      }

      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } catch (error) {
      lastError =
        error.name === "AbortError"
          ? new Error(`AI service request timed out after ${timeoutMs}ms`)
          : error;

      if (attempt < retries) {
        await sleep(250 * (attempt + 1));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error("Unknown AI service error");
}

export { requestJson };
