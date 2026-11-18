import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) {
    return auth.response;
  }

  const user = auth.data;
  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      institutionalId: user.institutionalId,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
    },
  });
}
