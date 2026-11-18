import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError, requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { adminUpdateTeacherSchema } from "@/lib/validations/auth";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const roleCheck = await requireRole(["ADMIN"]);
  if (!roleCheck.ok) {
    return roleCheck.response;
  }

  const { id } = await context.params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = adminUpdateTeacherSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid teacher status update.", 400, "ERR_VALIDATION");
  }

  const existing = await db.user.findUnique({
    where: { id },
    select: { id: true, role: true, status: true },
  });

  if (!existing || existing.role !== "TEACHER") {
    return jsonError("Teacher account not found.", 404, "ERR_NOT_FOUND");
  }

  const updated = await db.$transaction(async (tx) => {
    const teacher = await tx.user.update({
      where: { id },
      data: {
        status: parsed.data.status,
        ...(parsed.data.status === "SUSPENDED"
          ? { sessionVersion: { increment: 1 } }
          : {}),
      },
      select: {
        id: true,
        email: true,
        institutionalId: true,
        fullName: true,
        role: true,
        status: true,
      },
    });

    await recordAuditLog(
      {
        actorUserId: roleCheck.data.id,
        action: "ADMIN_TEACHER_STATUS_UPDATED",
        targetType: "User",
        targetId: id,
        beforeState: { status: existing.status },
        afterState: { status: teacher.status },
        ipAddress: getClientIp(request),
      },
      tx
    );

    return teacher;
  });

  return NextResponse.json({ teacher: updated });
}
