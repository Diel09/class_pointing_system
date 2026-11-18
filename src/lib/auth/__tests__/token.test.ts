import { describe, expect, it } from "vitest";
import { signSessionToken, verifySessionToken } from "../token";

const TEST_SECRET = "test-auth-secret-with-at-least-32-chars";

describe("session token signing and verification", () => {
  it("signs and verifies a valid session token", async () => {
    const now = 1_700_000_000;
    const token = await signSessionToken(
      {
        sub: "user-123",
        role: "TEACHER",
        sv: 2,
        iat: now,
        exp: now + 3600,
      },
      TEST_SECRET
    );

    const verified = await verifySessionToken(token, TEST_SECRET, now + 60);
    expect(verified).toEqual({
      sub: "user-123",
      role: "TEACHER",
      sv: 2,
      iat: now,
      exp: now + 3600,
    });
  });

  it("rejects tampered tokens", async () => {
    const now = 1_700_000_000;
    const token = await signSessionToken(
      { sub: "user-123", role: "STUDENT", sv: 1, iat: now, exp: now + 3600 },
      TEST_SECRET
    );

    const [payloadPart, sigPart] = token.split(".");
    const tampered = `${payloadPart}x.${sigPart}`;
    expect(await verifySessionToken(tampered, TEST_SECRET, now + 10)).toBeNull();
    expect(
      await verifySessionToken(token, "wrong-secret-with-at-least-32-chars", now + 10)
    ).toBeNull();
  });

  it("rejects expired tokens", async () => {
    const now = 1_700_000_000;
    const token = await signSessionToken(
      { sub: "user-123", role: "ADMIN", sv: 1, iat: now, exp: now + 60 },
      TEST_SECRET
    );

    expect(await verifySessionToken(token, TEST_SECRET, now + 60)).toBeNull();
    expect(await verifySessionToken(token, TEST_SECRET, now + 120)).toBeNull();
  });
});
