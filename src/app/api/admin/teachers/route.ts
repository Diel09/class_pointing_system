import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError, requireRole } from "@/lib/auth/guards";
import { hashPassword } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { adminCreateTeacherSchema } from "@/lib/validations/auth";

export async function GET() {
  const roleCheck = await requireRole(["ADMIN"]);
  if (!roleCheck.ok) {
    return roleCheck.response;
  }

  const teachers = await db.user.findMany({
    where: { role: "TEACHER" },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      email: true,
      institutionalId: true,
      fullName: true,
      role: true,
      status: true,
      createdAt: true,
      _count: {
        select: { taughtSubjects: true },
      },
    },
  });

  return NextResponse.json({ teachers });
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

  const parsed = adminCreateTeacherSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid teacher account payload.",
      400,
      "ERR_VALIDATION"
    );
  }

  const { fullName, email, institutionalId, password } = parsed.data;

  const existingEmail = await db.user.findUnique({
    where: { email },
    select: { id: true },
  });
  if (existingEmail) {
    return jsonError(
      "An account with this email already exists.",
      409,
      "ERR_EMAIL_EXISTS"
    );
  }

  if (institutionalId) {
    const existingId = await db.user.findUnique({
      where: { institutionalId },
      select: { id: true },
    });
    if (existingId) {
      return jsonError(
        "An account with this Institutional ID already exists.",
        409,
        "ERR_INSTITUTIONAL_ID_EXISTS"
      );
    }
  }

  const passwordHash = await hashPassword(password);
  const ipAddress = getClientIp(request);

  try {
    const teacher = await db.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          fullName,
          email,
          institutionalId,
          passwordHash,
          role: "TEACHER",
          status: "ACTIVE",
        },
        select: {
          id: true,
          email: true,
          institutionalId: true,
          fullName: true,
          role: true,
          status: true,
          createdAt: true,
          _count: {
            select: { taughtSubjects: true },
          },
        },
      });

      await recordAuditLog(
        {
          actorUserId: roleCheck.data.id,
          action: "ADMIN_TEACHER_CREATED",
          targetType: "User",
          targetId: created.id,
          afterState: {
            email: created.email,
            institutionalId: created.institutionalId,
            role: created.role,
            status: created.status,
          },
          ipAddress,
        },
        tx
      );

      return created;
    });

    return NextResponse.json({ teacher }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError(
        "Email or Institutional ID is already registered.",
        409,
        "ERR_DUPLICATE_ACCOUNT"
      );
    }
    console.error("Admin create teacher error:", error);
    return jsonError("Failed to create teacher account.", 500, "ERR_INTERNAL");
  }
}
