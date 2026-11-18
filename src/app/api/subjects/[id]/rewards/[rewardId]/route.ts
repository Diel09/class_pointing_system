import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError, requireTeacherSubjectOwner } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { updateRewardItemSchema } from "@/lib/validations/points";

const uuidSchema = z.string().uuid();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; rewardId: string }> }
) {
  const { id, rewardId } = await context.params;
  const owner = await requireTeacherSubjectOwner(id);
  if (!owner.ok) {
    return owner.response;
  }

  if (!uuidSchema.safeParse(rewardId).success) {
    return jsonError("Reward item not found.", 404, "ERR_NOT_FOUND");
  }

  const existing = await db.rewardItem.findUnique({
    where: { id: rewardId },
  });
  if (!existing || existing.subjectId !== id) {
    return jsonError("Reward item not found.", 404, "ERR_NOT_FOUND");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = updateRewardItemSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid reward update.",
      400,
      "ERR_VALIDATION"
    );
  }

  const nextScorePerUnit =
    parsed.data.scoreValuePerUnit ?? Number(existing.scoreValuePerUnit);
  const nextMaxBoost =
    parsed.data.maxBoostPerAssessment !== undefined
      ? parsed.data.maxBoostPerAssessment
      : existing.maxBoostPerAssessment !== null
      ? Number(existing.maxBoostPerAssessment)
      : null;

  if (
    existing.rewardType === "SCORE_BOOST" &&
    nextMaxBoost !== null &&
    nextMaxBoost < nextScorePerUnit
  ) {
    return jsonError(
      "Max boost per assessment cannot be less than one unit's boost value.",
      400,
      "ERR_VALIDATION"
    );
  }

  const ipAddress = getClientIp(request);

  const updated = await db.$transaction(async (tx) => {
    const reward = await tx.rewardItem.update({
      where: { id: rewardId },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description || null }
          : {}),
        ...(parsed.data.pointCostPerUnit !== undefined
          ? { pointCostPerUnit: parsed.data.pointCostPerUnit }
          : {}),
        ...(parsed.data.scoreValuePerUnit !== undefined &&
        existing.rewardType === "SCORE_BOOST"
          ? { scoreValuePerUnit: parsed.data.scoreValuePerUnit }
          : {}),
        ...(parsed.data.eligibleCategoryIds !== undefined &&
        existing.rewardType === "SCORE_BOOST"
          ? { eligibleCategoryIds: parsed.data.eligibleCategoryIds }
          : {}),
        ...(parsed.data.allowExtraCredit !== undefined &&
        existing.rewardType === "SCORE_BOOST"
          ? { allowExtraCredit: parsed.data.allowExtraCredit }
          : {}),
        ...(parsed.data.maxBoostPerAssessment !== undefined &&
        existing.rewardType === "SCORE_BOOST"
          ? { maxBoostPerAssessment: parsed.data.maxBoostPerAssessment }
          : {}),
        ...(parsed.data.isActive !== undefined
          ? { isActive: parsed.data.isActive }
          : {}),
      },
    });

    await recordAuditLog(
      {
        actorUserId: owner.data.user.id,
        subjectId: id,
        action: "REWARD_ITEM_UPDATED",
        targetType: "RewardItem",
        targetId: reward.id,
        beforeState: {
          name: existing.name,
          pointCostPerUnit: existing.pointCostPerUnit,
          scoreValuePerUnit: Number(existing.scoreValuePerUnit),
          allowExtraCredit: existing.allowExtraCredit,
          maxBoostPerAssessment:
            existing.maxBoostPerAssessment !== null
              ? Number(existing.maxBoostPerAssessment)
              : null,
          isActive: existing.isActive,
        },
        afterState: {
          name: reward.name,
          pointCostPerUnit: reward.pointCostPerUnit,
          scoreValuePerUnit: Number(reward.scoreValuePerUnit),
          allowExtraCredit: reward.allowExtraCredit,
          maxBoostPerAssessment:
            reward.maxBoostPerAssessment !== null
              ? Number(reward.maxBoostPerAssessment)
              : null,
          isActive: reward.isActive,
        },
        ipAddress,
      },
      tx
    );

    return reward;
  });

  return NextResponse.json({
    reward: {
      ...updated,
      scoreValuePerUnit: Number(updated.scoreValuePerUnit),
      maxBoostPerAssessment:
        updated.maxBoostPerAssessment !== null
          ? Number(updated.maxBoostPerAssessment)
          : null,
    },
  });
}
