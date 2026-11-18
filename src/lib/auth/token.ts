import type { UserRole } from "@prisma/client";

export interface SessionPayload {
  sub: string;
  role: UserRole;
  sv: number;
  iat: number;
  exp: number;
}

export const SESSION_COOKIE_NAME = "cp_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(input: string): Uint8Array | null {
  try {
    const padded = input.replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - (padded.length % 4)) % 4;
    const base64 = padded + "=".repeat(padLength);
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  } catch {
    return null;
  }
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

/**
 * Signs a session payload into a compact HMAC-SHA256 token compatible with Edge and Node runtimes.
 */
export async function signSessionToken(
  payload: Omit<SessionPayload, "iat" | "exp"> & { iat?: number; exp?: number },
  secret: string
): Promise<string> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const fullPayload: SessionPayload = {
    sub: payload.sub,
    role: payload.role,
    sv: payload.sv,
    iat: payload.iat ?? nowSeconds,
    exp: payload.exp ?? nowSeconds + SESSION_TTL_SECONDS,
  };
  const encodedPayload = toBase64Url(encoder.encode(JSON.stringify(fullPayload)));
  const key = await importHmacKey(secret);
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(encodedPayload)
  );
  const encodedSignature = toBase64Url(new Uint8Array(signature));
  return `${encodedPayload}.${encodedSignature}`;
}

/**
 * Verifies an HMAC-SHA256 session token and checks expiration.
 */
export async function verifySessionToken(
  token: string,
  secret: string,
  nowSeconds = Math.floor(Date.now() / 1000)
): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }
  const [encodedPayload, encodedSignature] = parts;
  if (!encodedPayload || !encodedSignature) {
    return null;
  }

  const signatureBytes = fromBase64Url(encodedSignature);
  if (!signatureBytes) {
    return null;
  }

  const key = await importHmacKey(secret);
  const isValid = await globalThis.crypto.subtle.verify(
    "HMAC",
    key,
    signatureBytes as BufferSource,
    encoder.encode(encodedPayload)
  );
  if (!isValid) {
    return null;
  }

  const payloadBytes = fromBase64Url(encodedPayload);
  if (!payloadBytes) {
    return null;
  }

  try {
    const parsed = JSON.parse(decoder.decode(payloadBytes)) as Partial<SessionPayload>;
    if (
      typeof parsed.sub !== "string" ||
      (parsed.role !== "STUDENT" && parsed.role !== "TEACHER" && parsed.role !== "ADMIN") ||
      typeof parsed.sv !== "number" ||
      typeof parsed.iat !== "number" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    if (parsed.exp <= nowSeconds) {
      return null;
    }
    return parsed as SessionPayload;
  } catch {
    return null;
  }
}
