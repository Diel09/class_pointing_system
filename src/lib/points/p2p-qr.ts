import { createHmac, timingSafeEqual } from "crypto";
import { getServerEnv } from "@/lib/env";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HEX_16_REGEX = /^[0-9a-f]{16}$/i;

export interface P2pQrPayloadData {
  subjectId: string;
  receiverEnrollmentId: string;
  requestedAmount: number | null;
  requestedNote: string | null;
}

export interface ParsedP2pQrPayload extends P2pQrPayloadData {
  amountPart: string;
  noteB64: string;
  hasNoteSegment: boolean;
  sig: string;
}

function computeP2pSignature(
  signingInput: string,
  secret: string
): string {
  return createHmac("sha256", secret)
    .update(signingInput)
    .digest("hex")
    .slice(0, 16);
}

/**
 * Generates an HMAC-SHA256 signed subject-scoped P2P QR payload.
 */
export function signP2pQrPayload(
  params: {
    subjectId: string;
    receiverEnrollmentId: string;
    requestedAmount?: number | null;
    requestedNote?: string | null;
  },
  secretOverride?: string
): string {
  const secret = secretOverride ?? getServerEnv().P2P_QR_SECRET;
  const amountPart =
    params.requestedAmount !== undefined && params.requestedAmount !== null
      ? String(params.requestedAmount)
      : "";
  const trimmedNote = params.requestedNote?.trim() ?? "";
  const noteB64 = trimmedNote
    ? Buffer.from(trimmedNote, "utf8").toString("base64url")
    : "";

  const signingInput = `${params.subjectId}:${params.receiverEnrollmentId}:${amountPart}:${noteB64}`;
  const sig = computeP2pSignature(signingInput, secret);
  return `p2p:${signingInput}:${sig}`;
}

/**
 * Parses a scanned P2P QR payload string without verifying its cryptographic signature.
 */
export function parseP2pQrPayload(
  rawPayload: string
): ParsedP2pQrPayload | null {
  const trimmed = rawPayload.trim();
  const parts = trimmed.split(":");
  if (parts[0] !== "p2p" || (parts.length !== 5 && parts.length !== 6)) {
    return null;
  }

  const subjectId = parts[1];
  const receiverEnrollmentId = parts[2];
  const amountPart = parts[3] ?? "";
  const hasNoteSegment = parts.length === 6;
  const noteB64 = hasNoteSegment ? (parts[4] ?? "") : "";
  const sig = hasNoteSegment ? parts[5] : parts[4];

  if (
    !subjectId ||
    !UUID_REGEX.test(subjectId) ||
    !receiverEnrollmentId ||
    !UUID_REGEX.test(receiverEnrollmentId)
  ) {
    return null;
  }

  let requestedAmount: number | null = null;
  if (amountPart !== "") {
    if (!/^[1-9]\d*$/.test(amountPart)) {
      return null;
    }
    const parsedAmount = Number.parseInt(amountPart, 10);
    if (!Number.isSafeInteger(parsedAmount) || parsedAmount <= 0) {
      return null;
    }
    requestedAmount = parsedAmount;
  }

  let requestedNote: string | null = null;
  if (noteB64 !== "") {
    if (!/^[A-Za-z0-9_-]+$/.test(noteB64)) {
      return null;
    }
    try {
      const decoded = Buffer.from(noteB64, "base64url").toString("utf8").trim();
      requestedNote = decoded || null;
    } catch {
      return null;
    }
  }

  if (!sig || !HEX_16_REGEX.test(sig)) {
    return null;
  }

  return {
    subjectId: subjectId.toLowerCase(),
    receiverEnrollmentId: receiverEnrollmentId.toLowerCase(),
    requestedAmount,
    requestedNote,
    amountPart,
    noteB64,
    hasNoteSegment,
    sig: sig.toLowerCase(),
  };
}

export type VerifyP2pQrResult =
  | { valid: true; data: P2pQrPayloadData }
  | { valid: false; reason: "INVALID_FORMAT" | "INVALID_SIGNATURE" };

/**
 * Verifies the structure and HMAC-SHA256 signature of a P2P QR payload.
 */
export function verifyP2pQrPayload(
  rawPayload: string,
  secretOverride?: string
): VerifyP2pQrResult {
  const parsed = parseP2pQrPayload(rawPayload);
  if (!parsed) {
    return { valid: false, reason: "INVALID_FORMAT" };
  }

  const secret = secretOverride ?? getServerEnv().P2P_QR_SECRET;
  const signingInput = parsed.hasNoteSegment
    ? `${parsed.subjectId}:${parsed.receiverEnrollmentId}:${parsed.amountPart}:${parsed.noteB64}`
    : `${parsed.subjectId}:${parsed.receiverEnrollmentId}:${parsed.amountPart}`;

  const expectedSig = computeP2pSignature(signingInput, secret);
  const actualBuf = Buffer.from(parsed.sig, "utf8");
  const expectedBuf = Buffer.from(expectedSig, "utf8");

  if (
    actualBuf.length !== expectedBuf.length ||
    !timingSafeEqual(actualBuf, expectedBuf)
  ) {
    return { valid: false, reason: "INVALID_SIGNATURE" };
  }

  return {
    valid: true,
    data: {
      subjectId: parsed.subjectId,
      receiverEnrollmentId: parsed.receiverEnrollmentId,
      requestedAmount: parsed.requestedAmount,
      requestedNote: parsed.requestedNote,
    },
  };
}
