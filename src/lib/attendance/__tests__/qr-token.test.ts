import { describe, expect, it } from "vitest";
import {
  generateSessionQrSecret,
  getTimeBucket,
  parseAttendanceQrPayload,
  signAttendanceQrToken,
  verifyAttendanceQrToken,
} from "../qr-token";

const SESSION_ID = "11111111-1111-4111-8111-111111111111";

describe("attendance rotating HMAC QR tokens", () => {
  it("accepts the current bucket and immediate previous bucket grace window", () => {
    const secret = generateSessionQrSecret();
    const rotationSeconds = 12;
    const nowMs = 1_700_000_004_000;
    const currentBucket = getTimeBucket(nowMs, rotationSeconds);

    const currentToken = signAttendanceQrToken(SESSION_ID, secret, currentBucket);
    const parsed = parseAttendanceQrPayload(currentToken);
    expect(parsed).not.toBeNull();
    expect(parsed?.sessionId).toBe(SESSION_ID);
    expect(parsed?.bucket).toBe(currentBucket);

    const currentRes = verifyAttendanceQrToken({
      payload: currentToken,
      sessionId: SESSION_ID,
      qrSecret: secret,
      rotationSeconds,
      nowMs,
    });
    expect(currentRes).toEqual({ valid: true, bucket: currentBucket });

    const graceToken = signAttendanceQrToken(
      SESSION_ID,
      secret,
      currentBucket - 1
    );
    const graceRes = verifyAttendanceQrToken({
      payload: graceToken,
      sessionId: SESSION_ID,
      qrSecret: secret,
      rotationSeconds,
      nowMs,
    });
    expect(graceRes).toEqual({ valid: true, bucket: currentBucket - 1 });
  });

  it("rejects expired tokens, future buckets, wrong sessions, and tampered signatures", () => {
    const secret = generateSessionQrSecret();
    const rotationSeconds = 12;
    const nowMs = 1_700_000_004_000;
    const currentBucket = getTimeBucket(nowMs, rotationSeconds);

    const expiredToken = signAttendanceQrToken(
      SESSION_ID,
      secret,
      currentBucket - 2
    );
    expect(
      verifyAttendanceQrToken({
        payload: expiredToken,
        sessionId: SESSION_ID,
        qrSecret: secret,
        rotationSeconds,
        nowMs,
      })
    ).toEqual({ valid: false, reason: "EXPIRED_OR_INVALID_SIGNATURE" });

    const futureToken = signAttendanceQrToken(
      SESSION_ID,
      secret,
      currentBucket + 1
    );
    expect(
      verifyAttendanceQrToken({
        payload: futureToken,
        sessionId: SESSION_ID,
        qrSecret: secret,
        rotationSeconds,
        nowMs,
      })
    ).toEqual({ valid: false, reason: "EXPIRED_OR_INVALID_SIGNATURE" });

    const validToken = signAttendanceQrToken(SESSION_ID, secret, currentBucket);
    const tampered = `${validToken.slice(0, -1)}${
      validToken.endsWith("0") ? "1" : "0"
    }`;
    expect(
      verifyAttendanceQrToken({
        payload: tampered,
        sessionId: SESSION_ID,
        qrSecret: secret,
        rotationSeconds,
        nowMs,
      })
    ).toEqual({ valid: false, reason: "EXPIRED_OR_INVALID_SIGNATURE" });

    expect(
      verifyAttendanceQrToken({
        payload: validToken,
        sessionId: "22222222-2222-4222-8222-222222222222",
        qrSecret: secret,
        rotationSeconds,
        nowMs,
      })
    ).toEqual({ valid: false, reason: "SESSION_MISMATCH" });

    expect(parseAttendanceQrPayload("not-a-valid-qr")).toBeNull();
  });
});
