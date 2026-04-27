import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { backendUrl, platformApiSecret } from "@/lib/server/platform-env";

export async function GET(_request, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { id } = await params;

  const response = await fetch(`${backendUrl}/api/cameras/${id}/preview`, {
    headers: {
      "x-platform-secret": platformApiSecret,
      "x-user-id": session.user.id,
      "x-user-email": session.user.email,
    },
    cache: "no-store",
  });

  if (!response.ok || !response.body) {
    const message = response.ok ? "Camera preview unavailable" : await response.text();
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
