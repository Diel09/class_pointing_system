import { describe, expect, it } from "vitest";
import {
  parseP2pQrPayload,
  signP2pQrPayload,
  verifyP2pQrPayload,
} from "../p2p-qr";

const SECRET = "p2p-test-secret-key-at-least-32-chars-long";
const SUBJECT_ID = "11111111-1111-4111-8111-111111111111";
const ENROLL_ID = "22222222-2222-4222-8222-222222222222";

describe("P2P QR Signing & Verification", () => {
  it("signs and verifies a payload with optional amount and note", () => {
    const payload = signP2pQrPayload(
      {
        subjectId: SUBJECT_ID,
        receiverEnrollmentId: ENROLL_ID,
        requestedAmount: 25,
        requestedNote: "Lab 3: snacks & coffee!",
      },
      SECRET
    );

    const parsed = parseP2pQrPayload(payload);
    expect(parsed).not.toBeNull();
    expect(parsed?.requestedAmount).toBe(25);
    expect(parsed?.requestedNote).toBe("Lab 3: snacks & coffee!");

    const verified = verifyP2pQrPayload(payload, SECRET);
    expect(verified).toEqual({
      valid: true,
      data: {
        subjectId: SUBJECT_ID,
        receiverEnrollmentId: ENROLL_ID,
        requestedAmount: 25,
        requestedNote: "Lab 3: snacks & coffee!",
      },
    });
  });

  it("signs and verifies a payload without amount or note", () => {
    const payload = signP2pQrPayload(
      {
        subjectId: SUBJECT_ID,
        receiverEnrollmentId: ENROLL_ID,
      },
      SECRET
    );

    const verified = verifyP2pQrPayload(payload, SECRET);
    expect(verified).toEqual({
      valid: true,
      data: {
        subjectId: SUBJECT_ID,
        receiverEnrollmentId: ENROLL_ID,
        requestedAmount: null,
        requestedNote: null,
      },
    });
  });

  it("rejects tampered amount, receiver, or malformed payloads", () => {
    const payload = signP2pQrPayload(
      {
        subjectId: SUBJECT_ID,
        receiverEnrollmentId: ENROLL_ID,
        requestedAmount: 10,
      },
      SECRET
    );

    const tampered = payload.replace(":10:", ":999:");
    expect(verifyP2pQrPayload(tampered, SECRET)).toEqual({
      valid: false,
      reason: "INVALID_SIGNATURE",
    });

    expect(verifyP2pQrPayload("att:not-p2p:123:abcd", SECRET)).toEqual({
      valid: false,
      reason: "INVALID_FORMAT",
    });
  });
});
