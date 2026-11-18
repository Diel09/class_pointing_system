import { createHmac, randomBytes, timingSafeEqual } from "crypto";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_16_REGEX = /^[0-9a-f]{16}$/i;

export interface ParsedAttendanceQrPayload {
  sessionId: string;
  bucket: number;
  sig: string;
}

/**
 * Generates a 32-byte server-only secret used to sign rotating attendance QR tokens.
 */
export function generateSessionQrSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Computes the deterministic integer time bucket for a given epoch timestamp and rotation interval.
 */
export function getTimeBucket(nowMs: number, rotationSeconds: number): number {
  return Math.floor(nowMs / (rotationSeconds * 1000));
}

function computeBucketSignature(
  sessionId: string,
  qrSecret: string,
  bucket: number
): string {
  return createHmac("sha256", qrSecret)
    .update(`${sessionId}:${bucket}`)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Creates a rotating attendance QR payload (`att:<sessionId>:<bucket>:<hmac16>`).
 */
export function signAttendanceQrToken(
  sessionId: string,
  qrSecret: string,
  bucket: number
): string {
  const sig = computeBucketSignature(sessionId, qrSecret, bucket);
  return `att:${sessionId}:${bucket}:${sig}`;
}

/**
 * Parses a scanned QR payload string into its structured attendance token components.
 */
export function parseAttendanceQrPayload(
  rawPayload: string
): ParsedAttendanceQrPayload | null {
  const trimmed = rawPayload.trim();
  const parts = trimmed.split(":");
  if (parts.length !== 4 || parts[0] !== "att") {
    return null;
  }

  const [, sessionId, bucketRaw, sig] = parts;
  if (!sessionId || !UUID_REGEX.test(sessionId)) {
    return null;
  }
  if (!bucketRaw || !/^\d+$/.test(bucketRaw)) {
    return null;
  }
  const bucket = Number.parseInt(bucketRaw, 10);
  if (!Number.isSafeInteger(bucket) || bucket < 0) {
    return null;
  }
  if (!sig || !HEX_16_REGEX.test(sig)) {
    return null;
  }

  return { sessionId, bucket, sig: sig.toLowerCase() };
}

export type VerifyAttendanceQrResult =
  | { valid: true; bucket: number }
  | {
      valid: false;
      reason:
        | "INVALID_FORMAT"
        | "SESSION_MISMATCH"
        | "EXPIRED_OR_INVALID_SIGNATURE";
    };

/**
 * Verifies a rotating attendance QR payload against the current bucket or 1-tick grace window.
 */
export function verifyAttendanceQrToken(params: {
  payload: string;
  sessionId: string;
  qrSecret: string;
  rotationSeconds: number;
  nowMs?: number;
}): VerifyAttendanceQrResult {
  const parsed = parseAttendanceQrPayload(params.payload);
  if (!parsed) {
    return { valid: false, reason: "INVALID_FORMAT" };
  }

  if (parsed.sessionId.toLowerCase() !== params.sessionId.toLowerCase()) {
    return { valid: false, reason: "SESSION_MISMATCH" };
  }

  const nowMs = params.nowMs ?? Date.now();
  const currentBucket = getTimeBucket(nowMs, params.rotationSeconds);
  const isWithinGraceWindow =
    parsed.bucket === currentBucket || parsed.bucket === currentBucket - 1;

  if (!isWithinGraceWindow) {
    return { valid: false, reason: "EXPIRED_OR_INVALID_SIGNATURE" };
  }

  const expectedSig = computeBucketSignature(
    params.sessionId,
    params.qrSecret,
    parsed.bucket
  );
  const actualBuf = Buffer.from(parsed.sig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");

  if (
    actualBuf.length !== expectedBuf.length ||
    !timingSafeEqual(actualBuf, expectedBuf)
  ) {
    return { valid: false, reason: "EXPIRED_OR_INVALID_SIGNATURE" };
  }

  return { valid: true, bucket: parsed.bucket };
}
