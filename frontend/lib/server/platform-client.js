import { backendUrl, platformApiSecret } from "@/lib/server/platform-env";

async function parseResponse(response) {
  const data = await response.json();

  if (!response.ok) {
    if (response.status === 401 && data.message === "Unauthorized platform request") {
      throw new Error(
        "Frontend and backend secrets do not match. Set the same PLATFORM_API_SECRET in frontend/.env.local and backend/.env."
      );
    }

    throw new Error(data.message || "Platform request failed");
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
    const reason =
      error?.cause?.code === "ECONNREFUSED"
        ? `Backend is unreachable at ${backendUrl}. Start the Express server and try again.`
        : "Platform request failed before the server could respond.";

    throw new Error(reason);
  }

  return parseResponse(response);
}
