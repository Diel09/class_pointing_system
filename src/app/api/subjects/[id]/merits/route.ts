import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/audit";
import { jsonError, requireSubjectInstructor } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { dispatchNotifications } from "@/lib/notifications/dispatch";
import {
  computeMeritBalanceUpdate,
  formatMeritLedgerNote,
} from "@/lib/points/merit-math";
import { awardMeritSchema } from "@/lib/validations/points";

interface LockedEnrollmentRow {
  id: string;
  studentId: string;
  availableBalance: number;
  escrowedBalance: number;
}

class EnrollmentLookupError extends Error {
  constructor() {
    super("One or more selected students are not enrolled in this subject.");
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const owner = await requireSubjectInstructor(id);
  if (!owner.ok) {
    return owner.response;
  }

  const { subject, user } = owner.data;
  if (subject.isArchived) {
    return jsonError(
      "Cannot award merits or demerits on an archived subject.",
      400,
      "ERR_SUBJECT_ARCHIVED"
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = awardMeritSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid merit/demerit payload.",
      400,
      "ERR_VALIDATION"
    );
  }

  let presetName: string | null = null;
  let requestedDelta: number;
  let referenceType: "MeritPreset" | "MeritAdjustment";
  const batchId = randomUUID();
  let referenceId: string = batchId;

  if (parsed.data.presetId) {
    const preset = await db.meritPreset.findUnique({
      where: { id: parsed.data.presetId },
    });
    if (!preset || preset.subjectId !== id) {
      return jsonError("Merit preset not found.", 404, "ERR_PRESET_NOT_FOUND");
    }
    if (preset.isArchived) {
      return jsonError(
        "Archived presets cannot be applied.",
        400,
        "ERR_PRESET_ARCHIVED"
      );
    }
    presetName = preset.name;
    requestedDelta = preset.pointsDelta;
    referenceType = "MeritPreset";
    referenceId = preset.id;
  } else {
    requestedDelta = parsed.data.pointsDelta!;
    referenceType = "MeritAdjustment";
  }

  // Deduplicate and sort enrollment IDs deterministically to prevent lock-order deadlocks.
  const sortedEnrollmentIds = Array.from(new Set(parsed.data.enrollmentIds)).sort();
  const ipAddress = getClientIp(request);
  const entryType = requestedDelta > 0 ? ("MERIT" as const) : ("DEMERIT" as const);

  try {
    const results = await db.$transaction(async (tx) => {
      const lockedRows = await tx.$queryRaw<LockedEnrollmentRow[]>`
        SELECT id, "studentId", "availableBalance", "escrowedBalance"
        FROM "SubjectEnrollment"
        WHERE "subjectId" = ${id}::uuid
          AND id IN (${Prisma.join(
            sortedEnrollmentIds.map((eid) => Prisma.sql`${eid}::uuid`)
          )})
        ORDER BY id ASC
        FOR UPDATE
      `;

      if (lockedRows.length !== sortedEnrollmentIds.length) {
        throw new EnrollmentLookupError();
      }

      const ledgerRows: Prisma.PointLedgerEntryCreateManyInput[] = [];
      const auditRows: Prisma.AuditLogCreateManyInput[] = [];
      const responseItems: {
        enrollmentId: string;
        studentId: string;
        previousBalance: number;
        availableDelta: number;
        availableAfter: number;
        clamped: boolean;
        ledgerEntryId: string;
      }[] = [];

      for (const row of lockedRows) {
        const balanceUpdate = computeMeritBalanceUpdate({
          currentBalance: row.availableBalance,
          requestedDelta,
          allowNegativeBalance: subject.allowNegativeBalance,
        });

        const formattedNote = formatMeritLedgerNote({
          presetName,
          note: parsed.data.note,
          requestedDelta,
          actualDelta: balanceUpdate.actualDelta,
          clamped: balanceUpdate.clamped,
        });

        if (balanceUpdate.actualDelta !== 0) {
          await tx.subjectEnrollment.update({
            where: { id: row.id },
            data: { availableBalance: balanceUpdate.newBalance },
          });
        }

        const ledgerEntryId = randomUUID();
        ledgerRows.push({
          id: ledgerEntryId,
          enrollmentId: row.id,
          subjectId: id,
          entryType: balanceUpdate.entryType,
          availableDelta: balanceUpdate.actualDelta,
          escrowDelta: 0,
          availableAfter: balanceUpdate.newBalance,
          escrowAfter: row.escrowedBalance,
          referenceType,
          referenceId,
          note: formattedNote,
          actorUserId: user.id,
        });

        auditRows.push({
          actorUserId: user.id,
          subjectId: id,
          action:
            balanceUpdate.entryType === "MERIT"
              ? "MERIT_AWARDED"
              : "DEMERIT_APPLIED",
          targetType: "SubjectEnrollment",
          targetId: row.id,
          beforeState: {
            availableBalance: balanceUpdate.previousBalance,
          },
          afterState: {
            batchId,
            presetId: parsed.data.presetId ?? null,
            requestedDelta,
            actualDelta: balanceUpdate.actualDelta,
            availableBalance: balanceUpdate.newBalance,
            clamped: balanceUpdate.clamped,
            note: formattedNote,
          },
          ipAddress,
        });

        responseItems.push({
          enrollmentId: row.id,
          studentId: row.studentId,
          previousBalance: balanceUpdate.previousBalance,
          availableDelta: balanceUpdate.actualDelta,
          availableAfter: balanceUpdate.newBalance,
          clamped: balanceUpdate.clamped,
          ledgerEntryId,
        });
      }

      await tx.pointLedgerEntry.createMany({ data: ledgerRows });
      await tx.auditLog.createMany({ data: auditRows });

      return responseItems;
    });

    await dispatchNotifications(
      results.map((item) => {
        const isMerit = requestedDelta > 0;
        const deltaText =
          requestedDelta > 0 ? `+${requestedDelta}` : `${requestedDelta}`;
        const label = presetName ? `${presetName}: ` : "";
        return {
          userId: item.studentId,
          subjectId: id,
          type: isMerit ? "MERIT_RECEIVED" : "DEMERIT_RECEIVED",
          title: isMerit
            ? `Merit Received (${subject.code})`
            : `Demerit Recorded (${subject.code})`,
          body: `${label}${deltaText} pts${
            parsed.data.note ? ` — ${parsed.data.note}` : ""
          } (Balance: ${item.availableAfter} pts).`,
          linkUrl: `/subjects/${id}`,
        };
      })
    );

    return NextResponse.json(
      {
        batchId,
        entryType,
        requestedDelta,
        allowNegativeBalance: subject.allowNegativeBalance,
        results,
      },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof EnrollmentLookupError) {
      return jsonError(error.message, 404, "ERR_ENROLLMENT_NOT_FOUND");
    }
    throw error;
  }
}
