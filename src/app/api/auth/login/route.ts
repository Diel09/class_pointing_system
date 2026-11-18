import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError } from "@/lib/auth/guards";
import { verifyPassword } from "@/lib/auth/password";
import { setSessionCookie } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ensureDeviceCookie } from "@/lib/device/token";
import { loginSchema } from "@/lib/validations/auth";

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid login credentials.",
      400,
      "ERR_VALIDATION"
    );
  }

  const { identifier, password } = parsed.data;
  const normalizedEmail = identifier.toLowerCase();
  const normalizedId = identifier.toUpperCase();

  const user = await db.user.findFirst({
    where: {
      OR: [{ email: normalizedEmail }, { institutionalId: normalizedId }],
    },
  });

  if (!user) {
    return jsonError(
      "Invalid email/ID or password.",
      401,
      "ERR_INVALID_CREDENTIALS"
    );
  }

  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) {
    return jsonError(
      "Invalid email/ID or password.",
      401,
      "ERR_INVALID_CREDENTIALS"
    );
  }

  if (user.status === "PENDING") {
    return jsonError(
      "Your teacher account is awaiting admin approval.",
      403,
      "ERR_ACCOUNT_PENDING"
    );
  }

  if (user.status === "SUSPENDED") {
    return jsonError(
      "Your account has been suspended. Contact an administrator.",
      403,
      "ERR_ACCOUNT_SUSPENDED"
    );
  }

  await setSessionCookie(user);
  await ensureDeviceCookie();

  await recordAuditLog({
    actorUserId: user.id,
    action: "USER_LOGIN",
    targetType: "User",
    targetId: user.id,
    ipAddress: getClientIp(request),
  });

  return NextResponse.json({
    user: {
      id: user.id,
      email: user.email,
      institutionalId: user.institutionalId,
      fullName: user.fullName,
      role: user.role,
      status: user.status,
    },
  });
}
