import { describe, expect, it } from "vitest";
import { resolveRuntimeDatabaseUrl } from "@/lib/db";

describe("resolveRuntimeDatabaseUrl", () => {
  it("appends pgbouncer=true for port 6543 URLs missing it", () => {
    const result = resolveRuntimeDatabaseUrl(
      "postgresql://postgres.ref:pass@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres"
    );
    expect(result).toContain("pgbouncer=true");
  });

  it("preserves existing query params and pgbouncer setting", () => {
    const result = resolveRuntimeDatabaseUrl(
      "postgresql://postgres.ref:pass@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=5"
    );
    expect(result).toContain("pgbouncer=true");
    expect(result).toContain("connection_limit=5");
  });

  it("leaves direct port 5432 URLs unchanged", () => {
    const raw =
      "postgresql://postgres.ref:pass@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres";
    expect(resolveRuntimeDatabaseUrl(raw)).toBe(raw);
  });
});
