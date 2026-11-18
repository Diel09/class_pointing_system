import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError, requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { adminUpdateTermSchema } from "@/lib/validations/auth";

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

  const parsed = adminUpdateTermSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError("Invalid academic term update.", 400, "ERR_VALIDATION");
  }

  const existing = await db.academicTerm.findUnique({ where: { id } });
  if (!existing) {
    return jsonError("Academic term not found.", 404, "ERR_NOT_FOUND");
  }

  const term = await db.$transaction(async (tx) => {
    if (parsed.data.isActive) {
      await tx.academicTerm.updateMany({
        where: { id: { not: id }, isActive: true },
        data: { isActive: false },
      });
    }

    const updated = await tx.academicTerm.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.isActive !== undefined
          ? { isActive: parsed.data.isActive }
          : {}),
      },
    });

    await recordAuditLog(
      {
        actorUserId: roleCheck.data.id,
        action: "ACADEMIC_TERM_UPDATED",
        targetType: "AcademicTerm",
        targetId: id,
        beforeState: { name: existing.name, isActive: existing.isActive },
        afterState: { name: updated.name, isActive: updated.isActive },
        ipAddress: getClientIp(request),
      },
      tx
    );

    return updated;
  });

  return NextResponse.json({ term });
}
