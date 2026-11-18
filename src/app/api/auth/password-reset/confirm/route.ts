import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError } from "@/lib/auth/guards";
import { hashLookupToken, hashPassword } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { passwordResetConfirmSchema } from "@/lib/validations/auth";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = passwordResetConfirmSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid reset payload.",
      400,
      "ERR_VALIDATION"
    );
  }

  const tokenHash = hashLookupToken(parsed.data.token);
  const newPasswordHash = await hashPassword(parsed.data.newPassword);
  const ipAddress = getClientIp(request);

  try {
    await db.$transaction(async (tx) => {
      const record = await tx.passwordResetToken.findUnique({
        where: { tokenHash },
      });

      if (!record || record.usedAt !== null || record.expiresAt <= new Date()) {
        throw new Error("INVALID_OR_EXPIRED_TOKEN");
      }

      const claimed = await tx.passwordResetToken.updateMany({
        where: {
          id: record.id,
          usedAt: null,
        },
        data: {
          usedAt: new Date(),
        },
      });

      if (claimed.count === 0) {
        throw new Error("INVALID_OR_EXPIRED_TOKEN");
      }

      await tx.user.update({
        where: { id: record.userId },
        data: {
          passwordHash: newPasswordHash,
          sessionVersion: { increment: 1 },
        },
      });

      await recordAuditLog(
        {
          actorUserId: record.userId,
          action: "PASSWORD_RESET_COMPLETED",
          targetType: "User",
          targetId: record.userId,
          ipAddress,
        },
        tx
      );
    });

    return NextResponse.json({
      ok: true,
      message: "Password updated. You can now sign in with your new password.",
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INVALID_OR_EXPIRED_TOKEN") {
      return jsonError(
        "Reset token is invalid or has expired.",
        400,
        "ERR_INVALID_RESET_TOKEN"
      );
    }
    console.error("Password reset confirm error:", error);
    return jsonError("Failed to reset password.", 500, "ERR_INTERNAL");
  }
}
