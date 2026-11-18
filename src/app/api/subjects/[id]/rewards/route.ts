import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import {
  jsonError,
  requireSubjectMember,
  requireTeacherSubjectOwner,
} from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { createRewardItemSchema } from "@/lib/validations/points";

function serializeRewardItem(item: {
  id: string;
  subjectId: string;
  name: string;
  description: string | null;
  rewardType: "SCORE_BOOST" | "FIXED_PERK";
  pointCostPerUnit: number;
  scoreValuePerUnit: unknown;
  eligibleCategoryIds: string[];
  allowExtraCredit: boolean;
  maxBoostPerAssessment: unknown;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: item.id,
    subjectId: item.subjectId,
    name: item.name,
    description: item.description,
    rewardType: item.rewardType,
    pointCostPerUnit: item.pointCostPerUnit,
    scoreValuePerUnit: Number(item.scoreValuePerUnit),
    eligibleCategoryIds: item.eligibleCategoryIds,
    allowExtraCredit: item.allowExtraCredit,
    maxBoostPerAssessment:
      item.maxBoostPerAssessment !== null
        ? Number(item.maxBoostPerAssessment)
        : null,
    isActive: item.isActive,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
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

  const { user, subject } = member.data;
  const { searchParams } = new URL(request.url);
  const includeInactive =
    user.role !== "STUDENT" && searchParams.get("includeInactive") === "true";

  const rewards = await db.rewardItem.findMany({
    where: {
      subjectId: id,
      ...(includeInactive ? {} : { isActive: true }),
    },
    orderBy: [{ isActive: "desc" }, { pointCostPerUnit: "asc" }, { createdAt: "asc" }],
  });

  return NextResponse.json({
    allowOpenRedemptions: subject.allowOpenRedemptions,
    rewards: rewards.map(serializeRewardItem),
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const owner = await requireTeacherSubjectOwner(id);
  if (!owner.ok) {
    return owner.response;
  }

  if (owner.data.subject.isArchived) {
    return jsonError(
      "Cannot create rewards on an archived subject.",
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

  const parsed = createRewardItemSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid reward item payload.",
      400,
      "ERR_VALIDATION"
    );
  }

  const ipAddress = getClientIp(request);

  const reward = await db.$transaction(async (tx) => {
    const created = await tx.rewardItem.create({
      data: {
        subjectId: id,
        name: parsed.data.name,
        description: parsed.data.description || null,
        rewardType: parsed.data.rewardType,
        pointCostPerUnit: parsed.data.pointCostPerUnit,
        scoreValuePerUnit:
          parsed.data.rewardType === "SCORE_BOOST"
            ? parsed.data.scoreValuePerUnit
            : 1,
        eligibleCategoryIds:
          parsed.data.rewardType === "SCORE_BOOST"
            ? parsed.data.eligibleCategoryIds
            : [],
        allowExtraCredit:
          parsed.data.rewardType === "SCORE_BOOST"
            ? parsed.data.allowExtraCredit
            : false,
        maxBoostPerAssessment:
          parsed.data.rewardType === "SCORE_BOOST"
            ? (parsed.data.maxBoostPerAssessment ?? null)
            : null,
      },
    });

    await recordAuditLog(
      {
        actorUserId: owner.data.user.id,
        subjectId: id,
        action: "REWARD_ITEM_CREATED",
        targetType: "RewardItem",
        targetId: created.id,
        afterState: {
          name: created.name,
          rewardType: created.rewardType,
          pointCostPerUnit: created.pointCostPerUnit,
          scoreValuePerUnit: Number(created.scoreValuePerUnit),
          allowExtraCredit: created.allowExtraCredit,
          maxBoostPerAssessment:
            created.maxBoostPerAssessment !== null
              ? Number(created.maxBoostPerAssessment)
              : null,
        },
        ipAddress,
      },
      tx
    );

    return created;
  });

  return NextResponse.json(
    { reward: serializeRewardItem(reward) },
    { status: 201 }
  );
}
