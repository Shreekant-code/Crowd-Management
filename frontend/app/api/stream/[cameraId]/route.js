import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { backendUrl, platformApiSecret } from "@/lib/server/platform-env";

export async function GET(_request, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { cameraId } = await params;
  let response;

  try {
    response = await fetch(`${backendUrl}/api/stream/${cameraId}`, {
      headers: {
        "x-platform-secret": platformApiSecret,
        "x-user-id": session.user.id,
        "x-user-email": session.user.email,
      },
      cache: "no-store",
    });
  } catch (error) {
    const message =
      error?.cause?.code === "ECONNREFUSED"
        ? `Backend is unreachable at ${backendUrl}. Start the backend server.`
        : "Camera stream request failed before the backend could respond.";
    return new Response(message, { status: 502 });
  }

  if (!response.ok || !response.body) {
    const message = response.ok ? "Camera stream unavailable" : await response.text();
    return new Response(message, { status: response.status || 502 });
  }

  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type":
        response.headers.get("content-type") || "multipart/x-mixed-replace; boundary=ffserver",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
    },
  });
}
