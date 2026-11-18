import type { RedemptionStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp } from "@/lib/audit";
import { jsonError, requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";

const uuidSchema = z.string().uuid();

interface LockedRedemptionRow {
  id: string;
  subjectId: string;
  enrollmentId: string;
  pointsEscrowed: number;
  status: RedemptionStatus;
  targetLabel: string | null;
}

interface LockedEnrollmentRow {
  id: string;
  studentId: string;
  availableBalance: number;
  escrowedBalance: number;
}

class CancelRedemptionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400
  ) {
    super(message);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const roleResult = await requireRole(["STUDENT"]);
  if (!roleResult.ok) {
    return roleResult.response;
  }

  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return jsonError("Redemption request not found.", 404, "ERR_NOT_FOUND");
  }

  const user = roleResult.data;
  const ipAddress = getClientIp(request);

  try {
    const result = await db.$transaction(async (tx) => {
      const lockedRedemptions = await tx.$queryRaw<LockedRedemptionRow[]>`
        SELECT id, "subjectId", "enrollmentId", "pointsEscrowed", status, "targetLabel"
        FROM "RedemptionRequest"
        WHERE id = ${id}::uuid
        FOR UPDATE
      `;
      const redemption = lockedRedemptions[0];
      if (!redemption) {
        throw new CancelRedemptionError(
          "Redemption request not found.",
          "ERR_NOT_FOUND",
          404
        );
      }

      const lockedEnrollments = await tx.$queryRaw<LockedEnrollmentRow[]>`
        SELECT id, "studentId", "availableBalance", "escrowedBalance"
        FROM "SubjectEnrollment"
        WHERE id = ${redemption.enrollmentId}::uuid
        FOR UPDATE
      `;
      const enrollment = lockedEnrollments[0];
      if (!enrollment) {
        throw new CancelRedemptionError(
          "Enrollment not found.",
          "ERR_ENROLLMENT_NOT_FOUND",
          404
        );
      }

      if (enrollment.studentId !== user.id) {
        throw new CancelRedemptionError(
          "You can only cancel your own redemption requests.",
          "ERR_FORBIDDEN",
          403
        );
      }

      if (redemption.status !== "PENDING") {
        throw new CancelRedemptionError(
          `Cannot cancel a redemption that is already ${redemption.status}.`,
          "ERR_REDEMPTION_NOT_PENDING",
          409
        );
      }

      const nextAvailable =
        enrollment.availableBalance + redemption.pointsEscrowed;
      const nextEscrow = Math.max(
        0,
        enrollment.escrowedBalance - redemption.pointsEscrowed
      );

      await tx.subjectEnrollment.update({
        where: { id: enrollment.id },
        data: {
          availableBalance: nextAvailable,
          escrowedBalance: nextEscrow,
        },
      });

      const updatedRedemption = await tx.redemptionRequest.update({
        where: { id: redemption.id },
        data: {
          status: "CANCELLED",
          reviewedAt: new Date(),
        },
      });

      await tx.pointLedgerEntry.create({
        data: {
          enrollmentId: enrollment.id,
          subjectId: redemption.subjectId,
          entryType: "REDEMPTION_REFUND",
          availableDelta: redemption.pointsEscrowed,
          escrowDelta: -redemption.pointsEscrowed,
          availableAfter: nextAvailable,
          escrowAfter: nextEscrow,
          referenceType: "RedemptionRequest",
          referenceId: redemption.id,
          note: redemption.targetLabel
            ? `Cancelled redemption (${redemption.targetLabel}); points refunded`
            : "Cancelled pending redemption; points refunded",
          actorUserId: user.id,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          subjectId: redemption.subjectId,
          action: "REDEMPTION_CANCELLED",
          targetType: "RedemptionRequest",
          targetId: redemption.id,
          beforeState: {
            status: redemption.status,
            availableBalance: enrollment.availableBalance,
            escrowedBalance: enrollment.escrowedBalance,
          },
          afterState: {
            status: "CANCELLED",
            availableBalance: nextAvailable,
            escrowedBalance: nextEscrow,
          },
          ipAddress,
        },
      });

      return {
        redemption: {
          id: updatedRedemption.id,
          status: updatedRedemption.status,
          pointsEscrowed: updatedRedemption.pointsEscrowed,
        },
        wallet: {
          availableBalance: nextAvailable,
          escrowedBalance: nextEscrow,
        },
      };
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof CancelRedemptionError) {
      return jsonError(error.message, error.status, error.code);
    }
    throw error;
  }
}
