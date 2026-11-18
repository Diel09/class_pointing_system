import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

type AuditDbClient = Prisma.TransactionClient | typeof db;

export interface AuditLogInput {
  actorUserId?: string | null;
  subjectId?: string | null;
  action: string;
  targetType: string;
  targetId: string;
  beforeState?: Prisma.InputJsonValue;
  afterState?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}

/**
 * Extracts the client IP address from standard proxy headers.
 */
export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) {
      return first;
    }
  }
  return request.headers.get("x-real-ip")?.trim() || null;
}

/**
 * Appends an immutable audit entry using either the root Prisma client or an active transaction.
 */
export async function recordAuditLog(
  input: AuditLogInput,
  client: AuditDbClient = db
): Promise<void> {
  await client.auditLog.create({
    data: {
      actorUserId: input.actorUserId ?? null,
      subjectId: input.subjectId ?? null,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      beforeState: input.beforeState,
      afterState: input.afterState,
      ipAddress: input.ipAddress ?? null,
    },
  });
}
