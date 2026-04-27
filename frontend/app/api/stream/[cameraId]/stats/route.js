import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { backendUrl, platformApiSecret } from "@/lib/server/platform-env";

export async function GET(_request, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { cameraId } = await params;
  let response;
  try {
    response = await fetch(`${backendUrl}/api/stream/${cameraId}/stats`, {
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
        : "Camera stats request failed before the backend could respond.";
    return Response.json(
      {
        cameraId,
        status: "offline",
        metrics: {
          current_count: 0,
          total_count: 0,
          density_count: 0,
          final_count: 0,
          risk: "Low",
          frame_id: null,
          updatedAt: null,
        },
        message,
      },
      { status: 502 }
    );
  }

  const payload = await response.text();
  return new Response(payload, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") || "application/json",
      "Cache-Control": "no-store",
    },
  });
}
