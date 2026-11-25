import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Ensures `?pgbouncer=true` is present when connecting through Supabase's
 * transaction pooler (port 6543) to prevent `42P05` prepared statement errors.
 */
export function resolveRuntimeDatabaseUrl(
  rawUrl: string | undefined
): string | undefined {
  if (!rawUrl) return rawUrl;

  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.port === "6543" &&
      !parsed.searchParams.has("pgbouncer")
    ) {
      parsed.searchParams.set("pgbouncer", "true");
    }
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function createPrismaClient(): PrismaClient {
  const runtimeUrl = resolveRuntimeDatabaseUrl(process.env.DATABASE_URL);
  return new PrismaClient({
    ...(runtimeUrl ? { datasources: { db: { url: runtimeUrl } } } : {}),
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

/**
 * Shared PrismaClient singleton to prevent connection exhaustion across HMR
 * and reused serverless module evaluations.
 */
export const db = globalForPrisma.prisma ?? createPrismaClient();

globalForPrisma.prisma = db;
