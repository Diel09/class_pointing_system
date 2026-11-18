import type { UserRole, UserStatus } from "@prisma/client";
import { cookies } from "next/headers";
import { db } from "@/lib/db";
import { getServerEnv } from "@/lib/env";
import {
  SESSION_COOKIE_NAME,
  SESSION_TTL_SECONDS,
  signSessionToken,
  verifySessionToken,
  type SessionPayload,
} from "./token";

export interface AuthenticatedUser {
  id: string;
  email: string;
  institutionalId: string | null;
  fullName: string;
  role: UserRole;
  status: UserStatus;
  sessionVersion: number;
}

/**
 * Sets the HTTP-only signed session cookie for an authenticated user.
 */
export async function setSessionCookie(user: {
  id: string;
  role: UserRole;
  sessionVersion: number;
}): Promise<void> {
  const env = getServerEnv();
  const token = await signSessionToken(
    {
      sub: user.id,
      role: user.role,
      sv: user.sessionVersion,
    },
    env.AUTH_SECRET
  );
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/**
 * Clears the HTTP-only session cookie.
 */
export async function clearSessionCookie(): Promise<void> {
  const env = getServerEnv();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}

/**
 * Reads and cryptographically verifies the session cookie without querying the database.
 */
export async function getSessionPayload(): Promise<SessionPayload | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }
  const env = getServerEnv();
  return verifySessionToken(token, env.AUTH_SECRET);
}

/**
 * Resolves the authenticated active user from the session cookie and checks sessionVersion.
 */
export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const payload = await getSessionPayload();
  if (!payload) {
    return null;
  }

  const user = await db.user.findUnique({
    where: { id: payload.sub },
    select: {
      id: true,
      email: true,
      institutionalId: true,
      fullName: true,
      role: true,
      status: true,
      sessionVersion: true,
    },
  });

  if (!user || user.status !== "ACTIVE" || user.sessionVersion !== payload.sv) {
    return null;
  }

  return user;
}
