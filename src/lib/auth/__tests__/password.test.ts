import { describe, expect, it } from "vitest";
import {
  generateRandomToken,
  hashLookupToken,
  hashPassword,
  verifyPassword,
} from "../password";

describe("password and token hashing", () => {
  it("hashes and verifies passwords with argon2id", async () => {
    const hash = await hashPassword("Sup3rS3cret!");
    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(hash, "Sup3rS3cret!")).toBe(true);
    expect(await verifyPassword(hash, "WrongPassword")).toBe(false);
  });

  it("produces deterministic sha256 lookup digests", () => {
    const d1 = hashLookupToken("TCH-ABC12345");
    const d2 = hashLookupToken("TCH-ABC12345");
    const d3 = hashLookupToken("TCH-OTHER999");

    expect(d1).toHaveLength(64);
    expect(d1).toBe(d2);
    expect(d1).not.toBe(d3);
  });

  it("generates random hex tokens of requested byte length", () => {
    const t1 = generateRandomToken(16);
    const t2 = generateRandomToken(16);
    expect(t1).toHaveLength(32);
    expect(t1).not.toBe(t2);
  });
});
