import { backendUrl, platformApiSecret } from "@/lib/server/platform-env";

async function parseResponse(response, pathname = "") {
  let data;
  try {
    data = await response.json();
  } catch (_err) {
    data = { message: `Server returned status ${response.status}` };
  }

  if (!response.ok) {
    console.error("platform_backend_response_failed", { pathname, status: response.status, data });
    if (response.status === 401 && data.message === "Unauthorized platform request") {
      throw new Error(
        "Frontend and backend secrets do not match. Set the same PLATFORM_API_SECRET in frontend/.env.local and backend/.env."
      );
    }

    throw new Error(data.message || `Platform request failed with status ${response.status}`);
  }

  return data;
}

export async function platformFetch(pathname, session, options = {}) {
  let response;

  try {
    response = await fetch(`${backendUrl}${pathname}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        "x-platform-secret": platformApiSecret,
        "x-user-id": session.user.id,
        "x-user-email": session.user.email,
      },
      cache: "no-store",
    });
  } catch (error) {
    console.error("platform_backend_request_failed", { pathname, backendUrl, error });
    const reason =
      error?.cause?.code === "ECONNREFUSED"
        ? `Backend is unreachable at ${backendUrl}. Start the Express server and try again.`
        : "Platform request failed before the server could respond.";

    throw new Error(reason);
  }

  return parseResponse(response, pathname);
}
