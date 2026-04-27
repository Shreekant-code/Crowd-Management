import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { platformFetch } from "@/lib/server/platform-client";

export async function POST(_request, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const { id, action } = await params;

  if (!["start", "stop"].includes(action)) {
    return NextResponse.json({ message: "Unsupported action" }, { status: 400 });
  }

  try {
    const data = await platformFetch(`/api/cameras/${id}/${action}`, session, {
      method: "POST",
    });
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json({ message: error.message }, { status: 400 });
  }
}
