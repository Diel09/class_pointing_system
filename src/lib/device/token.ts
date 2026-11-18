import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import { getServerEnv } from "@/lib/env";

export const DEVICE_COOKIE_NAME = "cp_device_token";
export const DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365; // 1 year

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function signDeviceId(deviceId: string, pepper: string): string {
  return createHmac("sha256", pepper).update(deviceId).digest("hex");
}

/**
 * Creates an HMAC-signed persistent device token (`deviceId.signature`).
 */
export function createSignedDeviceToken(
  pepper: string,
  deviceId = randomUUID()
): string {
  const sig = signDeviceId(deviceId, pepper);
  return `${deviceId}.${sig}`;
}

/**
 * Verifies an HMAC-signed device token and returns its raw deviceId if valid.
 */
export function verifySignedDeviceToken(
  token: string,
  pepper: string
): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [deviceId, sig] = parts;
  if (!deviceId || !sig || !UUID_REGEX.test(deviceId)) {
    return null;
  }

  const expectedSig = signDeviceId(deviceId, pepper);
  const sigBuffer = Buffer.from(sig, "utf8");
  const expectedBuffer = Buffer.from(expectedSig, "utf8");
  if (sigBuffer.length !== expectedBuffer.length) {
    return null;
  }
  if (!timingSafeEqual(sigBuffer, expectedBuffer)) {
    return null;
  }
  return deviceId;
}

/**
 * Computes the server-peppered SHA-256 digest used to deduplicate devices per attendance session.
 */
export function computeDeviceHash(deviceId: string, pepper: string): string {
  return createHash("sha256").update(`${deviceId}:${pepper}`).digest("hex");
}

/**
 * Persists the signed device token in a long-lived HTTP-only cookie.
 */
export async function setDeviceCookie(signedToken: string): Promise<void> {
  const env = getServerEnv();
  const cookieStore = await cookies();
  cookieStore.set(DEVICE_COOKIE_NAME, signedToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: DEVICE_COOKIE_MAX_AGE,
  });
}

/**
 * Reads and verifies the current device token cookie, returning the deviceId if valid.
 */
export async function getVerifiedDeviceFromCookie(): Promise<{
  token: string;
  deviceId: string;
} | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(DEVICE_COOKIE_NAME)?.value;
  if (!token) {
    return null;
  }
  const env = getServerEnv();
  const deviceId = verifySignedDeviceToken(token, env.DEVICE_PEPPER);
  if (!deviceId) {
    return null;
  }
  return { token, deviceId };
}

/**
 * Ensures a valid signed device token cookie exists, optionally restoring from a verified IndexedDB mirror.
 */
export async function ensureDeviceCookie(
  mirrorToken?: string | null
): Promise<{ token: string; deviceId: string }> {
  const env = getServerEnv();
  const existing = await getVerifiedDeviceFromCookie();
  if (existing) {
    return existing;
  }

  if (mirrorToken) {
    const mirrorDeviceId = verifySignedDeviceToken(mirrorToken, env.DEVICE_PEPPER);
    if (mirrorDeviceId) {
      await setDeviceCookie(mirrorToken);
      return { token: mirrorToken, deviceId: mirrorDeviceId };
    }
  }

  const freshToken = createSignedDeviceToken(env.DEVICE_PEPPER);
  const freshDeviceId = verifySignedDeviceToken(freshToken, env.DEVICE_PEPPER)!;
  await setDeviceCookie(freshToken);
  return { token: freshToken, deviceId: freshDeviceId };
}
