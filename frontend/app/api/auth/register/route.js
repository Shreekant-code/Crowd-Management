import { NextResponse } from "next/server";
import { createUser } from "@/lib/server/users";
import { signUpSchema } from "@/lib/server/validators";

export async function POST(request) {
  try {
    const payload = await request.json();
    const parsed = signUpSchema.parse(payload);
    const user = await createUser(parsed);

    return NextResponse.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
      },
    });
  } catch (error) {
    if (error.name === "ZodError") {
      return NextResponse.json({ message: error.issues[0]?.message || "Invalid input" }, { status: 400 });
    }

    return NextResponse.json({ message: error.message || "Registration failed" }, { status: 400 });
  }
}

