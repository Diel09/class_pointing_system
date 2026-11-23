import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import {
  jsonError,
  requireSubjectMember,
  requireTeacherSubjectOwner,
} from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { DEFAULT_SINGLE_TERM_CATEGORIES } from "@/lib/grading/default-scale";
import { parseTermSplitConfig } from "@/lib/grading/standing-service";
import { updateComputationSchema } from "@/lib/validations/grading";

function serializeCategory(cat: {
  id: string;
  subjectId: string;
  termKey: string;
  name: string;
  categoryType: "ASSESSMENT" | "ATTENDANCE" | "POINTS_PARTICIPATION";
  weightPct: unknown;
  aggregationMethod: "TOTAL_POINTS" | "EQUAL_AVERAGE";
  targetPointsCap: number | null;
  sortOrder: number;
  _count?: { assessments: number };
}) {
  return {
    id: cat.id,
    subjectId: cat.subjectId,
    termKey: cat.termKey,
    name: cat.name,
    categoryType: cat.categoryType,
    weightPct: Number(cat.weightPct),
    aggregationMethod: cat.aggregationMethod,
    targetPointsCap: cat.targetPointsCap,
    sortOrder: cat.sortOrder,
    assessmentCount: cat._count?.assessments ?? 0,
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const member = await requireSubjectMember(id);
  if (!member.ok) {
    return member.response;
  }

  const { subject } = member.data;
  const categories = await db.gradeCategory.findMany({
    where: { subjectId: id },
    orderBy: [{ termKey: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
    include: {
      _count: { select: { assessments: true } },
    },
  });

  return NextResponse.json({
    pointsEnabled: subject.pointsEnabled,
    standingVisible: subject.standingVisible,
    lateAttendanceCreditPct: Number(subject.lateAttendanceCreditPct),
    termSplitConfig: parseTermSplitConfig(subject.termSplitConfig),
    categories: categories.map(serializeCategory),
    defaultTemplate: DEFAULT_SINGLE_TERM_CATEGORIES,
  });
}

export async function PUT(
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
      "Cannot modify computation rules on an archived subject.",
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

  const parsed = updateComputationSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid computation configuration.",
      400,
      "ERR_VALIDATION"
    );
  }

  const existingCategories = await db.gradeCategory.findMany({
    where: { subjectId: id },
    include: {
      _count: { select: { assessments: true } },
    },
  });

  const existingById = new Map(existingCategories.map((c) => [c.id, c]));
  const incomingIds = new Set(
    parsed.data.categories.map((c) => c.id).filter((v): v is string => Boolean(v))
  );

  // Verify every incoming ID actually belongs to this subject
  for (const incomingId of incomingIds) {
    if (!existingById.has(incomingId)) {
      return jsonError(
        "One or more grade categories do not belong to this subject.",
        400,
        "ERR_VALIDATION"
      );
    }
  }

  // Block removing or changing non-ASSESSMENT type of categories that already have assessments
  for (const existing of existingCategories) {
    if (!incomingIds.has(existing.id) && existing._count.assessments > 0) {
      return jsonError(
        `Cannot delete category "${existing.name}" because it has ${existing._count.assessments} assessment(s). Delete or reassign those assessments first.`,
        409,
        "ERR_CATEGORY_HAS_ASSESSMENTS"
      );
    }
  }

  for (const cat of parsed.data.categories) {
    if (cat.id) {
      const existing = existingById.get(cat.id);
      if (
        existing &&
        existing._count.assessments > 0 &&
        cat.categoryType !== "ASSESSMENT"
      ) {
        return jsonError(
          `Cannot change "${existing.name}" away from Assessment type while it contains assessments.`,
          409,
          "ERR_CATEGORY_HAS_ASSESSMENTS"
        );
      }
    }
    if (owner.data.subject.pointsEnabled === false && cat.categoryType === "POINTS_PARTICIPATION") {
      const existing = cat.id ? existingById.get(cat.id) : null;
      if (!existing || existing.categoryType !== "POINTS_PARTICIPATION") {
        return jsonError(
          "Enable Points & Economy before adding a Points Participation grade category.",
          400,
          "ERR_POINTS_DISABLED"
        );
      }
    }
  }

  const ipAddress = getClientIp(request);
  const termSplitJson = parsed.data.termSplitConfig
    ? (parsed.data.termSplitConfig as unknown as Prisma.InputJsonValue)
    : Prisma.DbNull;

  const saved = await db.$transaction(async (tx) => {
    await tx.subject.update({
      where: { id },
      data: {
        lateAttendanceCreditPct: parsed.data.lateAttendanceCreditPct,
        termSplitConfig: termSplitJson,
      },
    });

    const idsToDelete = existingCategories
      .filter((c) => !incomingIds.has(c.id))
      .map((c) => c.id);

    if (idsToDelete.length > 0) {
      await tx.gradeCategory.deleteMany({
        where: { id: { in: idsToDelete }, subjectId: id },
      });
    }

    for (let i = 0; i < parsed.data.categories.length; i += 1) {
      const cat = parsed.data.categories[i]!;
      const sortOrder = cat.sortOrder ?? i;
      const targetPointsCap =
        cat.categoryType === "POINTS_PARTICIPATION"
          ? (cat.targetPointsCap ?? 100)
          : null;

      if (cat.id) {
        await tx.gradeCategory.update({
          where: { id: cat.id },
          data: {
            termKey: cat.termKey,
            name: cat.name,
            categoryType: cat.categoryType,
            weightPct: cat.weightPct,
            aggregationMethod: cat.aggregationMethod,
            targetPointsCap,
            sortOrder,
          },
        });
      } else {
        await tx.gradeCategory.create({
          data: {
            subjectId: id,
            termKey: cat.termKey,
            name: cat.name,
            categoryType: cat.categoryType,
            weightPct: cat.weightPct,
            aggregationMethod: cat.aggregationMethod,
            targetPointsCap,
            sortOrder,
          },
        });
      }
    }

    const updatedCategories = await tx.gradeCategory.findMany({
      where: { subjectId: id },
      orderBy: [{ termKey: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      include: { _count: { select: { assessments: true } } },
    });

    await recordAuditLog(
      {
        actorUserId: owner.data.user.id,
        subjectId: id,
        action: "COMPUTATION_UPDATED",
        targetType: "Subject",
        targetId: id,
        beforeState: {
          lateAttendanceCreditPct: Number(
            owner.data.subject.lateAttendanceCreditPct
          ),
          categoryCount: existingCategories.length,
        },
        afterState: {
          lateAttendanceCreditPct: parsed.data.lateAttendanceCreditPct,
          termSplitConfig: parsed.data.termSplitConfig ?? null,
          categoryCount: updatedCategories.length,
        },
        ipAddress,
      },
      tx
    );

    return updatedCategories;
  });

  return NextResponse.json({
    lateAttendanceCreditPct: parsed.data.lateAttendanceCreditPct,
    termSplitConfig: parsed.data.termSplitConfig ?? null,
    categories: saved.map(serializeCategory),
  });
}
