import type { RedemptionStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp } from "@/lib/audit";
import { jsonError, requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { dispatchNotifications } from "@/lib/notifications/dispatch";
import { applyApprovedScoreBoostHook } from "@/lib/points/score-boost-hook";
import { reviewRedemptionSchema } from "@/lib/validations/points";

const uuidSchema = z.string().uuid();

interface LockedRedemptionRow {
  id: string;
  subjectId: string;
  enrollmentId: string;
  rewardItemId: string | null;
  targetAssessmentId: string | null;
  targetLabel: string | null;
  pointsEscrowed: number;
  projectedScoreBoost: unknown;
  status: RedemptionStatus;
}

interface LockedEnrollmentRow {
  id: string;
  studentId?: string;
  availableBalance: number;
  escrowedBalance: number;
}

class ReviewRedemptionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400
  ) {
    super(message);
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const roleResult = await requireRole(["TEACHER"]);
  if (!roleResult.ok) {
    return roleResult.response;
  }

  const { id } = await context.params;
  if (!uuidSchema.safeParse(id).success) {
    return jsonError("Redemption request not found.", 404, "ERR_NOT_FOUND");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = reviewRedemptionSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid review payload.",
      400,
      "ERR_VALIDATION"
    );
  }

  const user = roleResult.data;
  const teacherNote = parsed.data.teacherNote?.trim() || null;
  const ipAddress = getClientIp(request);

  try {
    const result = await db.$transaction(async (tx) => {
      const lockedRedemptions = await tx.$queryRaw<LockedRedemptionRow[]>`
        SELECT
          id,
          "subjectId",
          "enrollmentId",
          "rewardItemId",
          "targetAssessmentId",
          "targetLabel",
          "pointsEscrowed",
          "projectedScoreBoost",
          status
        FROM "RedemptionRequest"
        WHERE id = ${id}::uuid
        FOR UPDATE
      `;
      const redemption = lockedRedemptions[0];
      if (!redemption) {
        throw new ReviewRedemptionError(
          "Redemption request not found.",
          "ERR_NOT_FOUND",
          404
        );
      }

      const subject = await tx.subject.findUnique({
        where: { id: redemption.subjectId },
        select: { id: true, code: true, teacherId: true, isArchived: true },
      });
      if (!subject) {
        throw new ReviewRedemptionError(
          "Subject not found.",
          "ERR_NOT_FOUND",
          404
        );
      }
      if (subject.teacherId !== user.id) {
        throw new ReviewRedemptionError(
          "You do not own the subject for this redemption request.",
          "ERR_SUBJECT_FORBIDDEN",
          403
        );
      }
      if (subject.isArchived) {
        throw new ReviewRedemptionError(
          "Cannot review redemptions on an archived subject.",
          "ERR_SUBJECT_ARCHIVED",
          400
        );
      }

      if (redemption.status !== "PENDING") {
        throw new ReviewRedemptionError(
          `Redemption request has already been ${redemption.status}.`,
          "ERR_REDEMPTION_ALREADY_REVIEWED",
          409
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
        throw new ReviewRedemptionError(
          "Student enrollment not found.",
          "ERR_ENROLLMENT_NOT_FOUND",
          404
        );
      }

      const rewardItem = redemption.rewardItemId
        ? await tx.rewardItem.findUnique({
            where: { id: redemption.rewardItemId },
            select: {
              id: true,
              name: true,
              rewardType: true,
              allowExtraCredit: true,
            },
          })
        : null;

      const isApprove = parsed.data.decision === "APPROVE";
      const nextStatus: RedemptionStatus = isApprove ? "APPROVED" : "REJECTED";
      const nextEscrow = Math.max(
        0,
        enrollment.escrowedBalance - redemption.pointsEscrowed
      );
      const nextAvailable = isApprove
        ? enrollment.availableBalance
        : enrollment.availableBalance + redemption.pointsEscrowed;

      await tx.subjectEnrollment.update({
        where: { id: enrollment.id },
        data: {
          availableBalance: nextAvailable,
          escrowedBalance: nextEscrow,
        },
      });

      const reviewedAt = new Date();
      const updated = await tx.redemptionRequest.update({
        where: { id: redemption.id },
        data: {
          status: nextStatus,
          reviewedByTeacherId: user.id,
          teacherNote,
          reviewedAt,
        },
      });

      const targetDesc = redemption.targetLabel
        ? ` (${redemption.targetLabel})`
        : "";
      const noteSuffix = teacherNote ? ` — Note: ${teacherNote}` : "";

      await tx.pointLedgerEntry.create({
        data: {
          enrollmentId: enrollment.id,
          subjectId: redemption.subjectId,
          entryType: isApprove ? "REDEMPTION_FINALIZE" : "REDEMPTION_REFUND",
          availableDelta: isApprove ? 0 : redemption.pointsEscrowed,
          escrowDelta: -redemption.pointsEscrowed,
          availableAfter: nextAvailable,
          escrowAfter: nextEscrow,
          referenceType: "RedemptionRequest",
          referenceId: redemption.id,
          note: isApprove
            ? `Approved redemption: ${rewardItem?.name ?? "Custom Request"}${targetDesc}${noteSuffix}`
            : `Rejected redemption: ${rewardItem?.name ?? "Custom Request"}${targetDesc}${noteSuffix}`,
          actorUserId: user.id,
        },
      });

      const scoreBoostHook =
        isApprove && rewardItem?.rewardType === "SCORE_BOOST"
          ? await applyApprovedScoreBoostHook(tx, {
              redemptionId: redemption.id,
              subjectId: redemption.subjectId,
              enrollmentId: enrollment.id,
              targetAssessmentId: redemption.targetAssessmentId,
              targetLabel: redemption.targetLabel,
              projectedScoreBoost:
                redemption.projectedScoreBoost !== null
                  ? Number(redemption.projectedScoreBoost)
                  : null,
              allowExtraCredit: rewardItem.allowExtraCredit,
            })
          : null;

      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          subjectId: redemption.subjectId,
          action: isApprove ? "REDEMPTION_APPROVED" : "REDEMPTION_REJECTED",
          targetType: "RedemptionRequest",
          targetId: redemption.id,
          beforeState: {
            status: redemption.status,
            availableBalance: enrollment.availableBalance,
            escrowedBalance: enrollment.escrowedBalance,
          },
          afterState: {
            status: nextStatus,
            availableBalance: nextAvailable,
            escrowedBalance: nextEscrow,
            teacherNote,
            ...(scoreBoostHook
              ? {
                  scoreBoostHook: {
                    appliedToAssessment: scoreBoostHook.appliedToAssessment,
                    targetAssessmentId: scoreBoostHook.targetAssessmentId,
                    projectedScoreBoost: scoreBoostHook.projectedScoreBoost,
                    allowExtraCredit: scoreBoostHook.allowExtraCredit,
                  },
                }
              : {}),
          },
          ipAddress,
        },
      });

      return {
        studentUserId: enrollment.studentId ?? null,
        subjectId: redemption.subjectId,
        subjectCode: subject.code ?? "Subject",
        rewardName: rewardItem?.name ?? "Custom Request",
        targetLabel: redemption.targetLabel,
        redemption: {
          id: updated.id,
          status: updated.status,
          pointsEscrowed: updated.pointsEscrowed,
          projectedScoreBoost:
            updated.projectedScoreBoost !== null
              ? Number(updated.projectedScoreBoost)
              : null,
          teacherNote: updated.teacherNote,
          reviewedAt: updated.reviewedAt,
        },
        wallet: {
          availableBalance: nextAvailable,
          escrowedBalance: nextEscrow,
        },
        scoreBoostHook,
      };
    });

    if (result.studentUserId) {
      const isApproved = result.redemption.status === "APPROVED";
      const targetText = result.targetLabel ? ` (${result.targetLabel})` : "";
      const noteText = result.redemption.teacherNote
        ? ` Note: ${result.redemption.teacherNote}`
        : "";
      await dispatchNotifications([
        {
          userId: result.studentUserId,
          subjectId: result.subjectId,
          type: isApproved ? "REDEMPTION_APPROVED" : "REDEMPTION_REJECTED",
          title: isApproved
            ? `Redemption Approved (${result.subjectCode})`
            : `Redemption Rejected (${result.subjectCode})`,
          body: isApproved
            ? `Approved ${result.rewardName}${targetText} for ${result.redemption.pointsEscrowed} pts.${noteText}`
            : `Rejected ${result.rewardName}${targetText}; ${result.redemption.pointsEscrowed} pts refunded to Available.${noteText}`,
          linkUrl: `/subjects/${result.subjectId}`,
        },
      ]);
    }

    return NextResponse.json({
      redemption: result.redemption,
      wallet: result.wallet,
      scoreBoostHook: result.scoreBoostHook,
    });
  } catch (error) {
    if (error instanceof ReviewRedemptionError) {
      return jsonError(error.message, error.status, error.code);
    }
    throw error;
  }
}
