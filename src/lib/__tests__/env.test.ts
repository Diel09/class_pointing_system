import { describe, expect, it } from "vitest";
import { parseServerEnv } from "@/lib/env";

const VALID_ENV = {
  NODE_ENV: "development",
  DATABASE_URL: "postgresql://postgres:pass@localhost:6543/postgres?pgbouncer=true",
  DIRECT_URL: "postgresql://postgres:pass@localhost:5432/postgres",
  AUTH_SECRET: "a".repeat(32),
  DEVICE_PEPPER: "b".repeat(32),
  P2P_QR_SECRET: "c".repeat(32),
};

describe("parseServerEnv", () => {
  it("accepts a valid environment configuration", () => {
    const parsed = parseServerEnv(VALID_ENV);
    expect(parsed.DATABASE_URL).toBe(VALID_ENV.DATABASE_URL);
    expect(parsed.NODE_ENV).toBe("development");
  });

  it("rejects missing DATABASE_URL", () => {
    expect(() =>
      parseServerEnv({
        ...VALID_ENV,
        DATABASE_URL: "",
      })
    ).toThrow(/DATABASE_URL/);
  });

  it("rejects secrets shorter than 32 characters", () => {
    expect(() =>
      parseServerEnv({
        ...VALID_ENV,
        AUTH_SECRET: "too-short",
      })
    ).toThrow(/AUTH_SECRET/);
  });
});
