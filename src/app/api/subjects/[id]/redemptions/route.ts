import { randomUUID } from "crypto";
import type { Prisma, RedemptionStatus } from "@prisma/client";
import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/audit";
import { jsonError, requireSubjectMember } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { dispatchNotifications } from "@/lib/notifications/dispatch";
import {
  createRedemptionSchema,
  redemptionStatusFilterSchema,
} from "@/lib/validations/points";

interface LockedEnrollmentRow {
  id: string;
  availableBalance: number;
  escrowedBalance: number;
}

class RedemptionRejectedError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 400
  ) {
    super(message);
  }
}

function serializeRedemption(row: {
  id: string;
  subjectId: string;
  enrollmentId: string;
  rewardItemId: string | null;
  isCustomRequest: boolean;
  targetAssessmentId: string | null;
  targetLabel: string | null;
  pointsEscrowed: number;
  requestedUnits: number;
  projectedScoreBoost: unknown;
  studentNote: string | null;
  status: RedemptionStatus;
  reviewedByTeacherId: string | null;
  teacherNote: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  rewardItem?: {
    id: string;
    name: string;
    rewardType: "SCORE_BOOST" | "FIXED_PERK";
    pointCostPerUnit: number;
    scoreValuePerUnit: unknown;
    allowExtraCredit: boolean;
  } | null;
  targetAssessment?: {
    id: string;
    title: string;
    maxScore: unknown;
    scores?: {
      status: string;
      rawScore: unknown;
      bonusPoints: unknown;
      allowExtraCredit: boolean;
    }[];
  } | null;
  enrollment?: {
    id: string;
    availableBalance: number;
    escrowedBalance: number;
    student?: {
      id: string;
      fullName: string;
      institutionalId: string | null;
      email: string;
    };
  };
  reviewedByTeacher?: {
    id: string;
    fullName: string;
  } | null;
}) {
  return {
    id: row.id,
    subjectId: row.subjectId,
    enrollmentId: row.enrollmentId,
    rewardItemId: row.rewardItemId,
    isCustomRequest: row.isCustomRequest,
    targetAssessmentId: row.targetAssessmentId,
    targetLabel: row.targetLabel,
    pointsEscrowed: row.pointsEscrowed,
    requestedUnits: row.requestedUnits,
    projectedScoreBoost:
      row.projectedScoreBoost !== null ? Number(row.projectedScoreBoost) : null,
    studentNote: row.studentNote,
    status: row.status,
    reviewedByTeacherId: row.reviewedByTeacherId,
    teacherNote: row.teacherNote,
    reviewedAt: row.reviewedAt,
    createdAt: row.createdAt,
    rewardItem: row.rewardItem
      ? {
          id: row.rewardItem.id,
          name: row.rewardItem.name,
          rewardType: row.rewardItem.rewardType,
          pointCostPerUnit: row.rewardItem.pointCostPerUnit,
          scoreValuePerUnit: Number(row.rewardItem.scoreValuePerUnit),
          allowExtraCredit: row.rewardItem.allowExtraCredit,
        }
      : null,
    ...(row.targetAssessment
      ? {
          targetAssessment: {
            id: row.targetAssessment.id,
            title: row.targetAssessment.title,
            maxScore: Number(row.targetAssessment.maxScore),
            currentScore: row.targetAssessment.scores?.[0]
              ? {
                  status: row.targetAssessment.scores[0].status,
                  rawScore:
                    row.targetAssessment.scores[0].rawScore !== null
                      ? Number(row.targetAssessment.scores[0].rawScore)
                      : null,
                  bonusPoints: Number(row.targetAssessment.scores[0].bonusPoints),
                  allowExtraCredit:
                    row.targetAssessment.scores[0].allowExtraCredit,
                }
              : null,
          },
        }
      : {}),
    ...(row.enrollment?.student ? { enrollment: row.enrollment } : {}),
    ...(row.reviewedByTeacher !== undefined
      ? { reviewedByTeacher: row.reviewedByTeacher }
      : {}),
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const member = await requireSubjectMember(id);
  if (!member.ok) {
    return member.response;
  }

  const { user, enrollment } = member.data;
  const { searchParams } = new URL(request.url);
  const rawStatus = searchParams.get("status") ?? "ALL";
  const parsedStatus = redemptionStatusFilterSchema.safeParse(rawStatus);
  if (!parsedStatus.success) {
    return jsonError("Invalid redemption status filter.", 400, "ERR_VALIDATION");
  }

  const where: Prisma.RedemptionRequestWhereInput = {
    subjectId: id,
    ...(user.role === "STUDENT" && enrollment
      ? { enrollmentId: enrollment.id }
      : {}),
    ...(parsedStatus.data !== "ALL" ? { status: parsedStatus.data } : {}),
  };

  const redemptions = await db.redemptionRequest.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: {
      rewardItem: {
        select: {
          id: true,
          name: true,
          rewardType: true,
          pointCostPerUnit: true,
          scoreValuePerUnit: true,
          allowExtraCredit: true,
        },
      },
      reviewedByTeacher: {
        select: { id: true, fullName: true },
      },
      targetAssessment: {
        select: {
          id: true,
          title: true,
          maxScore: true,
        },
      },
      ...(user.role !== "STUDENT"
        ? {
            enrollment: {
              select: {
                id: true,
                availableBalance: true,
                escrowedBalance: true,
                student: {
                  select: {
                    id: true,
                    fullName: true,
                    institutionalId: true,
                    email: true,
                  },
                },
              },
            },
          }
        : {}),
    },
  });

  const targetAssessmentPairs = redemptions
    .filter((r) => Boolean(r.targetAssessmentId))
    .map((r) => ({
      assessmentId: r.targetAssessmentId!,
      enrollmentId: r.enrollmentId,
    }));

  const targetScores =
    targetAssessmentPairs.length > 0 && db.assessmentScore?.findMany
      ? await db.assessmentScore.findMany({
          where: {
            OR: targetAssessmentPairs,
          },
          select: {
            assessmentId: true,
            enrollmentId: true,
            status: true,
            rawScore: true,
            bonusPoints: true,
            allowExtraCredit: true,
          },
        })
      : [];

  const targetScoreMap = new Map(
    targetScores.map((s) => [`${s.assessmentId}:${s.enrollmentId}`, s])
  );

  const enriched = redemptions.map((r) => {
    if (!r.targetAssessment) return r;
    const matchedScore = targetScoreMap.get(
      `${r.targetAssessment.id}:${r.enrollmentId}`
    );
    return {
      ...r,
      targetAssessment: {
        ...r.targetAssessment,
        scores: matchedScore ? [matchedScore] : [],
      },
    };
  });

  return NextResponse.json({
    redemptions: enriched.map(serializeRedemption),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const member = await requireSubjectMember(id);
  if (!member.ok) {
    return member.response;
  }

  const { user, subject, enrollment } = member.data;
  if (user.role !== "STUDENT" || !enrollment) {
    return jsonError(
      "Only enrolled students can submit point redemption requests.",
      403,
      "ERR_FORBIDDEN"
    );
  }

  if (subject.isArchived) {
    return jsonError(
      "Cannot submit redemptions on an archived subject.",
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

  const parsed = createRedemptionSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid redemption request.",
      400,
      "ERR_VALIDATION"
    );
  }

  const ipAddress = getClientIp(request);

  try {
    const result = await db.$transaction(async (tx) => {
      const liveSubject = await tx.subject.findUnique({
        where: { id },
        select: { id: true, isArchived: true, allowOpenRedemptions: true },
      });
      if (!liveSubject) {
        throw new RedemptionRejectedError("Subject not found.", "ERR_NOT_FOUND", 404);
      }
      if (liveSubject.isArchived) {
        throw new RedemptionRejectedError(
          "Cannot submit redemptions on an archived subject.",
          "ERR_SUBJECT_ARCHIVED",
          400
        );
      }

      let pointsCost = 0;
      let requestedUnits = parsed.data.requestedUnits ?? 1;
      let projectedScoreBoost: number | null = null;
      let rewardLabel = "";
      let rewardItemId: string | null = null;
      let resolvedTargetLabel = parsed.data.targetLabel?.trim() || null;

      if (parsed.data.isCustomRequest) {
        if (!liveSubject.allowOpenRedemptions) {
          throw new RedemptionRejectedError(
            "Open/custom redemption requests are currently disabled for this subject.",
            "ERR_OPEN_REDEMPTIONS_DISABLED",
            400
          );
        }
        pointsCost = parsed.data.customPointsCost!;
        requestedUnits = 1;
        rewardLabel = "Custom Spend Request";
      } else {
        const reward = await tx.rewardItem.findUnique({
          where: { id: parsed.data.rewardItemId! },
        });
        if (!reward || reward.subjectId !== id) {
          throw new RedemptionRejectedError(
            "Reward item not found in this subject.",
            "ERR_REWARD_NOT_FOUND",
            404
          );
        }
        if (!reward.isActive) {
          throw new RedemptionRejectedError(
            "This reward item is no longer active.",
            "ERR_REWARD_INACTIVE",
            400
          );
        }

        rewardItemId = reward.id;
        rewardLabel = reward.name;
        if (reward.rewardType === "FIXED_PERK") {
          requestedUnits = 1;
        } else {
          const boost = Number(
            (requestedUnits * Number(reward.scoreValuePerUnit)).toFixed(2)
          );
          if (
            reward.maxBoostPerAssessment !== null &&
            boost > Number(reward.maxBoostPerAssessment)
          ) {
            throw new RedemptionRejectedError(
              `Requested boost (+${boost}) exceeds the maximum allowed boost of +${Number(
                reward.maxBoostPerAssessment
              )} per assessment.`,
              "ERR_MAX_BOOST_EXCEEDED",
              400
            );
          }

          if (parsed.data.targetAssessmentId) {
            const targetAssessment = await tx.assessment.findUnique({
              where: { id: parsed.data.targetAssessmentId },
              select: { id: true, subjectId: true, categoryId: true, title: true },
            });
            if (!targetAssessment || targetAssessment.subjectId !== id) {
              throw new RedemptionRejectedError(
                "Target assessment not found in this subject.",
                "ERR_ASSESSMENT_NOT_FOUND",
                404
              );
            }
            if (
              reward.eligibleCategoryIds.length > 0 &&
              !reward.eligibleCategoryIds.includes(targetAssessment.categoryId)
            ) {
              throw new RedemptionRejectedError(
                "This score boost reward cannot be applied to the selected assessment category.",
                "ERR_CATEGORY_NOT_ELIGIBLE",
                400
              );
            }
            if (!resolvedTargetLabel) {
              resolvedTargetLabel = targetAssessment.title;
            }
          } else if (!resolvedTargetLabel || resolvedTargetLabel.length < 2) {
            throw new RedemptionRejectedError(
              "Specify the target exam, quiz, or activity for this score boost.",
              "ERR_TARGET_REQUIRED",
              400
            );
          }
          projectedScoreBoost = boost;
        }
        pointsCost = requestedUnits * reward.pointCostPerUnit;
      }

      // Lock enrollment row FOR UPDATE to prevent double-spending concurrent requests.
      const lockedRows = await tx.$queryRaw<LockedEnrollmentRow[]>`
        SELECT id, "availableBalance", "escrowedBalance"
        FROM "SubjectEnrollment"
        WHERE id = ${enrollment.id}::uuid
        FOR UPDATE
      `;
      const locked = lockedRows[0];
      if (!locked) {
        throw new RedemptionRejectedError(
          "Enrollment not found.",
          "ERR_ENROLLMENT_NOT_FOUND",
          404
        );
      }

      if (locked.availableBalance <= 0 || locked.availableBalance < pointsCost) {
        throw new RedemptionRejectedError(
          `Insufficient available points. Requested ${pointsCost} pts, but only ${locked.availableBalance} pts available.`,
          "ERR_INSUFFICIENT_BALANCE",
          400
        );
      }

      const nextAvailable = locked.availableBalance - pointsCost;
      const nextEscrow = locked.escrowedBalance + pointsCost;

      await tx.subjectEnrollment.update({
        where: { id: locked.id },
        data: {
          availableBalance: nextAvailable,
          escrowedBalance: nextEscrow,
        },
      });

      const targetLabel = resolvedTargetLabel;
      const studentNote = parsed.data.studentNote?.trim() || null;
      const redemptionId = randomUUID();

      const redemption = await tx.redemptionRequest.create({
        data: {
          id: redemptionId,
          subjectId: id,
          enrollmentId: locked.id,
          rewardItemId,
          isCustomRequest: Boolean(parsed.data.isCustomRequest),
          targetAssessmentId: parsed.data.targetAssessmentId ?? null,
          targetLabel,
          pointsEscrowed: pointsCost,
          requestedUnits,
          projectedScoreBoost,
          studentNote,
          status: "PENDING",
        },
        include: {
          rewardItem: {
            select: {
              id: true,
              name: true,
              rewardType: true,
              pointCostPerUnit: true,
              scoreValuePerUnit: true,
              allowExtraCredit: true,
            },
          },
        },
      });

      const noteParts = [rewardLabel];
      if (targetLabel) noteParts.push(`Target: ${targetLabel}`);
      if (studentNote) noteParts.push(studentNote);

      await tx.pointLedgerEntry.create({
        data: {
          enrollmentId: locked.id,
          subjectId: id,
          entryType: "REDEMPTION_ESCROW",
          availableDelta: -pointsCost,
          escrowDelta: pointsCost,
          availableAfter: nextAvailable,
          escrowAfter: nextEscrow,
          referenceType: "RedemptionRequest",
          referenceId: redemption.id,
          note: `Escrowed for ${noteParts.join(" — ")}`,
          actorUserId: user.id,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: user.id,
          subjectId: id,
          action: "REDEMPTION_SUBMITTED",
          targetType: "RedemptionRequest",
          targetId: redemption.id,
          beforeState: {
            availableBalance: locked.availableBalance,
            escrowedBalance: locked.escrowedBalance,
          },
          afterState: {
            availableBalance: nextAvailable,
            escrowedBalance: nextEscrow,
            pointsEscrowed: pointsCost,
            rewardItemId,
            isCustomRequest: Boolean(parsed.data.isCustomRequest),
            targetAssessmentId: parsed.data.targetAssessmentId ?? null,
            targetLabel,
            projectedScoreBoost,
          },
          ipAddress,
        },
      });

      return {
        redemption: serializeRedemption(redemption),
        wallet: {
          availableBalance: nextAvailable,
          escrowedBalance: nextEscrow,
        },
      };
    });

    await dispatchNotifications([
      {
        userId: subject.teacherId,
        subjectId: id,
        type: "REDEMPTION_SUBMITTED",
        title: `New Redemption Request (${subject.code})`,
        body: `${user.fullName} requested ${result.redemption.pointsEscrowed} pts${
          result.redemption.targetLabel
            ? ` for ${result.redemption.targetLabel}`
            : ""
        }.`,
        linkUrl: `/subjects/${id}`,
      },
    ]);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof RedemptionRejectedError) {
      return jsonError(error.message, error.status, error.code);
    }
    throw error;
  }
}
