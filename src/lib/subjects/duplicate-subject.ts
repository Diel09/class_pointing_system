import { randomUUID } from "crypto";
import { Prisma } from "@prisma/client";
import { recordAuditLog } from "@/lib/audit";
import { db } from "@/lib/db";
import { generateInviteCode } from "@/lib/validations/subject";

export type DuplicateSubjectCopiedCounts = {
  gradeCategories: number;
  gradeScaleRules: number;
  meritPresets: number;
  rewardItems: number;
};

const DUPLICATE_SOURCE_INCLUDE = {
  gradeCategories: {
    orderBy: [{ termKey: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  },
  gradeScaleRules: {
    orderBy: [{ sortOrder: "asc" }, { minPct: "desc" }],
  },
  meritPresets: {
    orderBy: [{ isArchived: "asc" }, { type: "asc" }, { createdAt: "asc" }],
  },
  rewardItems: {
    orderBy: [{ createdAt: "asc" }],
  },
} satisfies Prisma.SubjectInclude;

export type DuplicateSubjectSource = Prisma.SubjectGetPayload<{
  include: typeof DUPLICATE_SOURCE_INCLUDE;
}>;

/**
 * Fetches a subject and its cloneable configuration relations for duplication.
 */
export async function fetchDuplicateSubjectSource(
  sourceSubjectId: string,
  client: Prisma.TransactionClient | typeof db = db
): Promise<DuplicateSubjectSource | null> {
  return client.subject.findUnique({
    where: { id: sourceSubjectId },
    include: DUPLICATE_SOURCE_INCLUDE,
  });
}

async function generateUniqueInviteCode(
  tx: Prisma.TransactionClient
): Promise<string> {
  let inviteCode = generateInviteCode(8);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const clash = await tx.subject.findUnique({
      where: { inviteCode },
      select: { id: true },
    });
    if (!clash) {
      return inviteCode;
    }
    inviteCode = generateInviteCode(8);
  }
  return generateInviteCode(10);
}

/**
 * Duplicates a teacher's subject and all of its configuration modifications
 * (settings/policies, grade categories, grade scale rules, merit presets, and reward items)
 * into a new active section inside an existing Prisma transaction.
 * Assessments, enrollments, attendance, ledgers, and redemptions are not copied.
 */
export async function duplicateSubjectInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    sourceSubjectId: string;
    newSection: string;
    actorUserId: string;
    ipAddress: string | null;
    prefetchedSource?: DuplicateSubjectSource;
  }
) {
  const {
    sourceSubjectId,
    newSection,
    actorUserId,
    ipAddress,
    prefetchedSource,
  } = params;

  const source =
    prefetchedSource ??
    (await tx.subject.findUniqueOrThrow({
      where: { id: sourceSubjectId },
      include: DUPLICATE_SOURCE_INCLUDE,
    }));

  const inviteCode = await generateUniqueInviteCode(tx);

  const created = await tx.subject.create({
    data: {
      teacherId: source.teacherId,
      termId: source.termId,
      code: source.code,
      title: source.title,
      section: newSection,
      startDate: source.startDate,
      endDate: source.endDate,
      inviteCode,
      isArchived: false,
      pointsEnabled: source.pointsEnabled,
      allowNegativeBalance: source.allowNegativeBalance,
      allowP2pTransfers: source.allowP2pTransfers,
      p2pMaxPerTransfer: source.p2pMaxPerTransfer,
      p2pMaxPerDay: source.p2pMaxPerDay,
      p2pMaxPerTerm: source.p2pMaxPerTerm,
      allowOpenRedemptions: source.allowOpenRedemptions,
      standingVisible: source.standingVisible,
      requireGapFreeGradeScale: source.requireGapFreeGradeScale,
      lateAttendanceCreditPct: source.lateAttendanceCreditPct,
      termSplitConfig:
        source.termSplitConfig === null
          ? Prisma.DbNull
          : (source.termSplitConfig as Prisma.InputJsonValue),
    },
    include: {
      term: { select: { id: true, name: true, isActive: true } },
      _count: { select: { enrollments: true } },
    },
  });

  const categoryIdMap = new Map<string, string>();
  const categoryRows = source.gradeCategories.map((category) => {
    const newId = randomUUID();
    categoryIdMap.set(category.id, newId);
    return {
      id: newId,
      subjectId: created.id,
      termKey: category.termKey,
      name: category.name,
      categoryType: category.categoryType,
      weightPct: category.weightPct,
      aggregationMethod: category.aggregationMethod,
      targetPointsCap: category.targetPointsCap,
      sortOrder: category.sortOrder,
    };
  });

  if (categoryRows.length > 0) {
    await tx.gradeCategory.createMany({
      data: categoryRows,
    });
  }

  if (source.gradeScaleRules.length > 0) {
    await tx.gradeScaleRule.createMany({
      data: source.gradeScaleRules.map((rule) => ({
        subjectId: created.id,
        minPct: rule.minPct,
        maxPct: rule.maxPct,
        gradeEquivalent: rule.gradeEquivalent,
        label: rule.label,
        isPassing: rule.isPassing,
        sortOrder: rule.sortOrder,
      })),
    });
  }

  if (source.meritPresets.length > 0) {
    await tx.meritPreset.createMany({
      data: source.meritPresets.map((preset) => ({
        subjectId: created.id,
        name: preset.name,
        type: preset.type,
        pointsDelta: preset.pointsDelta,
        description: preset.description,
        isArchived: preset.isArchived,
      })),
    });
  }

  if (source.rewardItems.length > 0) {
    await tx.rewardItem.createMany({
      data: source.rewardItems.map((reward) => ({
        subjectId: created.id,
        name: reward.name,
        description: reward.description,
        rewardType: reward.rewardType,
        pointCostPerUnit: reward.pointCostPerUnit,
        scoreValuePerUnit: reward.scoreValuePerUnit,
        eligibleCategoryIds: reward.eligibleCategoryIds
          .map((oldId) => categoryIdMap.get(oldId))
          .filter((newId): newId is string => Boolean(newId)),
        allowExtraCredit: reward.allowExtraCredit,
        maxBoostPerAssessment: reward.maxBoostPerAssessment,
        isActive: reward.isActive,
      })),
    });
  }

  const copied: DuplicateSubjectCopiedCounts = {
    gradeCategories: source.gradeCategories.length,
    gradeScaleRules: source.gradeScaleRules.length,
    meritPresets: source.meritPresets.length,
    rewardItems: source.rewardItems.length,
  };

  await recordAuditLog(
    {
      actorUserId,
      subjectId: created.id,
      action: "SUBJECT_DUPLICATED",
      targetType: "Subject",
      targetId: created.id,
      beforeState: {
        sourceSubjectId: source.id,
        sourceCode: source.code,
        sourceTitle: source.title,
        sourceSection: source.section,
      },
      afterState: {
        code: created.code,
        title: created.title,
        section: created.section,
        termId: created.termId,
        startDate: created.startDate?.toISOString() ?? null,
        endDate: created.endDate?.toISOString() ?? null,
        inviteCode: created.inviteCode,
        copied,
      },
      ipAddress,
    },
    tx
  );

  return { subject: created, copied };
}
