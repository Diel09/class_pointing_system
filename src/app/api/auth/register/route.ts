import { Prisma, type UserRole, type UserStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError } from "@/lib/auth/guards";
import { hashLookupToken, hashPassword } from "@/lib/auth/password";
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

  const { fullName, email, institutionalId, password, accountType, inviteCode } =
    parsed.data;

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
      let role: UserRole = "STUDENT";
      let status: UserStatus = "ACTIVE";
      let usedInviteId: string | null = null;

      if (accountType === "TEACHER") {
        role = "TEACHER";
        if (inviteCode) {
          const codeHash = hashLookupToken(inviteCode);
          const invite = await tx.teacherInviteCode.findUnique({
            where: { codeHash },
          });

          if (!invite) {
            throw new Error("INVALID_INVITE");
          }
          if (invite.expiresAt && invite.expiresAt <= new Date()) {
            throw new Error("EXPIRED_INVITE");
          }

          const updated = await tx.teacherInviteCode.updateMany({
            where: {
              id: invite.id,
              usedCount: { lt: invite.maxUses },
            },
            data: {
              usedCount: { increment: 1 },
            },
          });

          if (updated.count === 0) {
            throw new Error("EXHAUSTED_INVITE");
          }
          usedInviteId = invite.id;
          status = "ACTIVE";
        } else {
          status = "PENDING";
        }
      }

      const user = await tx.user.create({
        data: {
          fullName,
          email,
          institutionalId,
          passwordHash,
          role,
          status,
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
            usedInviteId,
          },
          ipAddress,
        },
        tx
      );

      return user;
    });

    if (result.status === "ACTIVE") {
      await setSessionCookie(result);
    }
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
        pendingApproval: result.status === "PENDING",
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "INVALID_INVITE") {
        return jsonError("Invalid teacher invite code.", 400, "ERR_INVALID_INVITE");
      }
      if (error.message === "EXPIRED_INVITE") {
        return jsonError("Teacher invite code has expired.", 400, "ERR_EXPIRED_INVITE");
      }
      if (error.message === "EXHAUSTED_INVITE") {
        return jsonError(
          "Teacher invite code has reached its usage limit.",
          400,
          "ERR_EXHAUSTED_INVITE"
        );
      }
    }
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
