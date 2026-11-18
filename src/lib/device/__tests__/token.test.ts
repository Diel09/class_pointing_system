import { describe, expect, it } from "vitest";
import {
  computeDeviceHash,
  createSignedDeviceToken,
  verifySignedDeviceToken,
} from "../token";

const PEPPER = "test-device-pepper-at-least-32-chars";

describe("device token signing and hashing", () => {
  it("creates and verifies a signed device token", () => {
    const token = createSignedDeviceToken(PEPPER);
    const deviceId = verifySignedDeviceToken(token, PEPPER);
    expect(deviceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );
  });

  it("rejects forged or mismatched-pepper device tokens", () => {
    const token = createSignedDeviceToken(PEPPER);
    expect(
      verifySignedDeviceToken(token, "different-pepper-at-least-32-chars")
    ).toBeNull();
    expect(verifySignedDeviceToken("not-a-uuid.abcdef", PEPPER)).toBeNull();
  });

  it("computes deterministic peppered SHA-256 device hashes", () => {
    const h1 = computeDeviceHash("11111111-1111-4111-8111-111111111111", PEPPER);
    const h2 = computeDeviceHash("11111111-1111-4111-8111-111111111111", PEPPER);
    const h3 = computeDeviceHash(
      "11111111-1111-4111-8111-111111111111",
      "another-pepper-at-least-32-characters"
    );

    expect(h1).toHaveLength(64);
    expect(h1).toBe(h2);
    expect(h1).not.toBe(h3);
  });
});
