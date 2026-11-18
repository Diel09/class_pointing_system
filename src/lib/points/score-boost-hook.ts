import type { Prisma } from "@prisma/client";

export interface ScoreBoostHookInput {
  redemptionId: string;
  subjectId: string;
  enrollmentId: string;
  targetAssessmentId: string | null;
  targetLabel: string | null;
  projectedScoreBoost: number | null;
  allowExtraCredit: boolean;
}

export interface ScoreBoostHookResult {
  appliedToAssessment: boolean;
  targetAssessmentId: string | null;
  projectedScoreBoost: number | null;
  allowExtraCredit: boolean;
  newBonusPoints?: number;
}

interface LockedAssessmentScoreRow {
  id: string;
  bonusPoints: unknown;
  allowExtraCredit: boolean;
}

/**
 * Atomically increments `AssessmentScore.bonusPoints` inside the redemption approval
 * transaction when the redemption targets a valid assessment in the same subject.
 */
export async function applyApprovedScoreBoostHook(
  tx: Prisma.TransactionClient,
  input: ScoreBoostHookInput
): Promise<ScoreBoostHookResult> {
  if (
    !input.targetAssessmentId ||
    input.projectedScoreBoost === null ||
    input.projectedScoreBoost <= 0
  ) {
    return {
      appliedToAssessment: false,
      targetAssessmentId: input.targetAssessmentId,
      projectedScoreBoost: input.projectedScoreBoost,
      allowExtraCredit: input.allowExtraCredit,
    };
  }

  const assessment = await tx.assessment.findUnique({
    where: { id: input.targetAssessmentId },
    select: { id: true, subjectId: true },
  });

  if (!assessment || assessment.subjectId !== input.subjectId) {
    return {
      appliedToAssessment: false,
      targetAssessmentId: input.targetAssessmentId,
      projectedScoreBoost: input.projectedScoreBoost,
      allowExtraCredit: input.allowExtraCredit,
    };
  }

  const lockedScores = await tx.$queryRaw<LockedAssessmentScoreRow[]>`
    SELECT id, "bonusPoints", "allowExtraCredit"
    FROM "AssessmentScore"
    WHERE "assessmentId" = ${assessment.id}::uuid
      AND "enrollmentId" = ${input.enrollmentId}::uuid
    FOR UPDATE
  `;

  const existing = lockedScores[0];
  let newBonusPoints = input.projectedScoreBoost;
  let effectiveAllowExtraCredit = input.allowExtraCredit;

  if (existing) {
    newBonusPoints = Number(
      (Number(existing.bonusPoints) + input.projectedScoreBoost).toFixed(2)
    );
    effectiveAllowExtraCredit =
      existing.allowExtraCredit || input.allowExtraCredit;

    await tx.assessmentScore.update({
      where: { id: existing.id },
      data: {
        bonusPoints: newBonusPoints,
        allowExtraCredit: effectiveAllowExtraCredit,
      },
    });
  } else {
    await tx.assessmentScore.create({
      data: {
        assessmentId: assessment.id,
        enrollmentId: input.enrollmentId,
        status: "PENDING",
        rawScore: null,
        bonusPoints: newBonusPoints,
        allowExtraCredit: effectiveAllowExtraCredit,
      },
    });
  }

  return {
    appliedToAssessment: true,
    targetAssessmentId: assessment.id,
    projectedScoreBoost: input.projectedScoreBoost,
    allowExtraCredit: effectiveAllowExtraCredit,
    newBonusPoints,
  };
}
