import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError } from "@/lib/auth/guards";
import { hashPassword } from "@/lib/auth/password";
import { setSessionCookie } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ensureDeviceCookie } from "@/lib/device/token";
import { registerSchema } from "@/lib/validations/auth";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = registerSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid registration input.",
      400,
      "ERR_VALIDATION"
    );
  }

  const { fullName, email, institutionalId, password, accountType } =
    parsed.data;

  if (accountType === "TEACHER") {
    return jsonError(
      "Teacher self-registration is disabled. Contact an administrator to create a teacher account.",
      403,
      "ERR_TEACHER_REGISTRATION_DISABLED"
    );
  }

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
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          fullName,
          email,
          institutionalId,
          passwordHash,
          role: "STUDENT",
          status: "ACTIVE",
        },
        select: {
          id: true,
          email: true,
          institutionalId: true,
          fullName: true,
          role: true,
          status: true,
          sessionVersion: true,
          createdAt: true,
        },
      });

      await recordAuditLog(
        {
          actorUserId: user.id,
          action: "USER_REGISTERED",
          targetType: "User",
          targetId: user.id,
          afterState: {
            role: user.role,
            status: user.status,
          },
          ipAddress,
        },
        tx
      );

      return user;
    });

    await setSessionCookie(result);
    await ensureDeviceCookie();

    return NextResponse.json(
      {
        user: {
          id: result.id,
          email: result.email,
          institutionalId: result.institutionalId,
          fullName: result.fullName,
          role: result.role,
          status: result.status,
        },
        pendingApproval: false,
      },
      { status: 201 }
    );
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
    console.error("Register error:", error);
    return jsonError("Registration failed.", 500, "ERR_INTERNAL");
  }
}
