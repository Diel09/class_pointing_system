import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";

export async function GET() {
  const roleCheck = await requireRole(["ADMIN"]);
  if (!roleCheck.ok) {
    return roleCheck.response;
  }

  const students = await db.user.findMany({
    where: { role: "STUDENT" },
    orderBy: [{ fullName: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      email: true,
      institutionalId: true,
      fullName: true,
      role: true,
      status: true,
      createdAt: true,
      _count: {
        select: { enrollments: true },
      },
    },
  });

  return NextResponse.json({ students });
}
