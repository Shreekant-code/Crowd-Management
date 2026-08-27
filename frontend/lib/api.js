async function parseResponse(response) {
  let data;

  try {
    data = await response.json();
  } catch (_error) {
    data = { message: "Server returned an unreadable response" };
    console.error("frontend_api_response_parse_failed", _error);
  }

  if (!response.ok) {
    const detail = data.error ? ` ${data.error}` : "";
    const error = new Error(`${data.message || "Request failed"}${detail}`.trim());
    console.error("frontend_api_response_failed", { status: response.status, error });
    throw error;
  }

  return data;
}

export async function getDashboardData() {
  const response = await fetch("/api/platform/dashboard", { cache: "no-store" });
  return parseResponse(response);
}

export async function createCamera(payload) {
  const response = await fetch("/api/platform/cameras", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}

export async function changeCameraState(id, action) {
  const response = await fetch(`/api/platform/cameras/${id}/${action}`, {
    method: "POST",
  });
  return parseResponse(response);
}

export async function deleteCamera(id) {
  const response = await fetch(`/api/platform/cameras/${id}`, {
    method: "DELETE",
  });
  return parseResponse(response);
}

export async function uploadVideo(formData) {
  const response = await fetch("/api/platform/uploads", {
    method: "POST",
    body: formData,
  });
  return parseResponse(response);
}

export async function getEvacuationTopology() {
  const response = await fetch("/api/platform/evacuation", { cache: "no-store" });
  return parseResponse(response);
}

export async function calculateEvacuationRoutes(payload = {}) {
  const response = await fetch("/api/platform/evacuation", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return parseResponse(response);
}
