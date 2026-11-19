import { NextResponse } from "next/server";
import { jsonError, requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";

export async function GET() {
  const roleCheck = await requireRole(["ADMIN"]);
  if (!roleCheck.ok) {
    return roleCheck.response;
  }

  const invites = await db.teacherInviteCode.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      label: true,
      maxUses: true,
      usedCount: true,
      expiresAt: true,
      createdAt: true,
      createdByAdmin: {
        select: { fullName: true, email: true },
      },
    },
  });

  return NextResponse.json({ invites });
}

export async function POST() {
  const roleCheck = await requireRole(["ADMIN"]);
  if (!roleCheck.ok) {
    return roleCheck.response;
  }

  return jsonError(
    "Teacher invite codes are disabled because teacher accounts are created directly by administrators.",
    410,
    "ERR_TEACHER_REGISTRATION_DISABLED"
  );
}
