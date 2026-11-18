import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError } from "@/lib/auth/guards";
import { generateRandomToken, hashLookupToken } from "@/lib/auth/password";
import { db } from "@/lib/db";
import { passwordResetRequestSchema } from "@/lib/validations/auth";

const RESET_TTL_MS = 1000 * 60 * 30; // 30 minutes

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = passwordResetRequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid email address.",
      400,
      "ERR_VALIDATION"
    );
  }

  const user = await db.user.findUnique({
    where: { email: parsed.data.email },
    select: { id: true, email: true, status: true },
  });

  if (user && user.status === "ACTIVE") {
    const rawToken = generateRandomToken(32);
    const tokenHash = hashLookupToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TTL_MS);

    await db.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
      },
    });

    await recordAuditLog({
      actorUserId: user.id,
      action: "PASSWORD_RESET_REQUESTED",
      targetType: "User",
      targetId: user.id,
      ipAddress: getClientIp(request),
    });

    if (process.env.NODE_ENV !== "production") {
      console.info(
        `[DEV Password Reset] ${user.email}: /reset-password?token=${rawToken}`
      );
    }
  }

  // Always return generic 200 to prevent account enumeration.
  return NextResponse.json({
    ok: true,
    message:
      "If an active account matches that email, password reset instructions have been generated.",
  });
}
