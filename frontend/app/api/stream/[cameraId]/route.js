import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { backendUrl, platformApiSecret } from "@/lib/server/platform-env";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request, { params }) {
  const session = await getServerSession(authOptions);
  const user = session?.user;

  // Fallback to email/demo if session exists but user.id is not explicitly set
  const userId = user?.id || user?.email || "authenticated-user";
  const userEmail = user?.email || "authenticated-user@crowd.local";

  if (!user && process.env.NODE_ENV === "production") {
    return new Response("Unauthorized", { status: 401 });
  }

  const { cameraId } = await params;
  let response;

  console.log(`[frontend-stream-proxy] Requesting live MJPEG stream from backend: cameraId=${cameraId}, userId=${userId}, backendUrl=${backendUrl}`);

  try {
    response = await fetch(`${backendUrl}/api/stream/${cameraId}`, {
      headers: {
        "x-platform-secret": platformApiSecret,
        "x-user-id": String(userId),
        "x-user-email": String(userEmail),
      },
      cache: "no-store",
    });
  } catch (error) {
    console.error(`[frontend-stream-proxy] Backend stream request failed: cameraId=${cameraId}`, error);
    const message =
      error?.cause?.code === "ECONNREFUSED"
        ? `Backend is unreachable at ${backendUrl}. Start the backend server.`
        : "Camera stream request failed before the backend could respond.";
    return new Response(message, { status: 502 });
  }

  if (!response.ok || !response.body) {
    const message = response.ok ? "Camera stream unavailable" : await response.text();
    console.error(`[frontend-stream-proxy] Backend stream returned error status: ${response.status}`, message);
    return new Response(message, { status: response.status || 502 });
  }

  const contentType = response.headers.get("content-type") || "multipart/x-mixed-replace; boundary=frame";
  console.log(`[frontend-stream-proxy] Backend stream connected successfully! HTTP ${response.status}, Content-Type=${contentType}`);

  return new Response(response.body, {
    status: response.status,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
    },
  });
}
