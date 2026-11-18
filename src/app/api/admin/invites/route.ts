import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError, requireRole } from "@/lib/auth/guards";
import { hashLookupToken } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { adminCreateInviteSchema } from "@/lib/validations/auth";
import { generateInviteCode } from "@/lib/validations/subject";

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

export async function POST(request: Request) {
  const roleCheck = await requireRole(["ADMIN"]);
  if (!roleCheck.ok) {
    return roleCheck.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = adminCreateInviteSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid invite payload.",
      400,
      "ERR_VALIDATION"
    );
  }

  const rawCode = `TCH-${generateInviteCode(8)}`;
  const codeHash = hashLookupToken(rawCode);
  const expiresAt = parsed.data.expiresInDays
    ? new Date(Date.now() + parsed.data.expiresInDays * 24 * 60 * 60 * 1000)
    : null;

  const invite = await db.$transaction(async (tx) => {
    const created = await tx.teacherInviteCode.create({
      data: {
        codeHash,
        label: parsed.data.label ?? null,
        maxUses: parsed.data.maxUses,
        expiresAt,
        createdByAdminId: roleCheck.data.id,
      },
      select: {
        id: true,
        label: true,
        maxUses: true,
        usedCount: true,
        expiresAt: true,
        createdAt: true,
      },
    });

    await recordAuditLog(
      {
        actorUserId: roleCheck.data.id,
        action: "TEACHER_INVITE_CREATED",
        targetType: "TeacherInviteCode",
        targetId: created.id,
        afterState: {
          label: created.label,
          maxUses: created.maxUses,
          expiresAt: created.expiresAt?.toISOString() ?? null,
        },
        ipAddress: getClientIp(request),
      },
      tx
    );

    return created;
  });

  return NextResponse.json({ invite, rawCode }, { status: 201 });
}
