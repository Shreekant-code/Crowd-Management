import jwt from "jsonwebtoken";
import { getServerSession } from "next-auth";
import { NextResponse } from "next/server";
import { authOptions } from "@/lib/auth";
import { socketTokenSecret } from "@/lib/server/platform-env";

export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const token = jwt.sign(
    {
      userId: session.user.id,
      email: session.user.email,
    },
    socketTokenSecret,
    { expiresIn: "1h" }
  );

  return NextResponse.json({ token });
}
