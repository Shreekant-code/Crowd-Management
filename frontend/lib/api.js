async function parseResponse(response) {
  let data;

  try {
    data = await response.json();
  } catch (_error) {
    data = { message: "Server returned an unreadable response" };
  }

  if (!response.ok) {
    const detail = data.error ? ` ${data.error}` : "";
    throw new Error(`${data.message || "Request failed"}${detail}`.trim());
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
