import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import {
  jsonError,
  requireSubjectMember,
  requireTeacherSubjectOwner,
} from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { DEFAULT_PH_GRADE_SCALE } from "@/lib/grading/default-scale";
import { updateGradeScaleSchema } from "@/lib/validations/grading";

function serializeRule(rule: {
  id?: string;
  minPct: unknown;
  maxPct: unknown;
  gradeEquivalent: string;
  label: string;
  isPassing: boolean;
  sortOrder?: number;
}) {
  return {
    ...(rule.id ? { id: rule.id } : {}),
    minPct: Number(rule.minPct),
    maxPct: Number(rule.maxPct),
    gradeEquivalent: rule.gradeEquivalent,
    label: rule.label,
    isPassing: rule.isPassing,
    sortOrder: rule.sortOrder ?? 0,
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

  const rules = await db.gradeScaleRule.findMany({
    where: { subjectId: id },
    orderBy: [{ sortOrder: "asc" }, { minPct: "desc" }],
  });

  const isDefaultTemplate = rules.length === 0;
  return NextResponse.json({
    isDefaultTemplate,
    requireGapFree: member.data.subject.requireGapFreeGradeScale ?? true,
    rules: isDefaultTemplate
      ? DEFAULT_PH_GRADE_SCALE
      : rules.map(serializeRule),
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
      "Cannot modify grade scale on an archived subject.",
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

  const parsed = updateGradeScaleSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid grade scale rules.",
      400,
      "ERR_VALIDATION"
    );
  }

  const { requireGapFree } = parsed.data;
  const sortedForDisplay = [...parsed.data.rules].sort(
    (a, b) => b.minPct - a.minPct
  );
  const ipAddress = getClientIp(request);

  const saved = await db.$transaction(async (tx) => {
    await tx.subject.update({
      where: { id },
      data: { requireGapFreeGradeScale: requireGapFree },
    });

    await tx.gradeScaleRule.deleteMany({ where: { subjectId: id } });

    await tx.gradeScaleRule.createMany({
      data: sortedForDisplay.map((rule, index) => ({
        subjectId: id,
        minPct: rule.minPct,
        maxPct: rule.maxPct,
        gradeEquivalent: rule.gradeEquivalent,
        label: rule.label,
        isPassing: rule.isPassing,
        sortOrder: index,
      })),
    });

    const created = await tx.gradeScaleRule.findMany({
      where: { subjectId: id },
      orderBy: [{ sortOrder: "asc" }],
    });

    await recordAuditLog(
      {
        actorUserId: owner.data.user.id,
        subjectId: id,
        action: "GRADE_SCALE_UPDATED",
        targetType: "Subject",
        targetId: id,
        afterState: {
          ruleCount: created.length,
          requireGapFree,
        },
        ipAddress,
      },
      tx
    );

    return created;
  });

  return NextResponse.json({
    isDefaultTemplate: false,
    requireGapFree,
    rules: saved.map(serializeRule),
  });
}
