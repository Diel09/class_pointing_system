import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError, requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { updateAssessmentSchema } from "@/lib/validations/grading";

const uuidSchema = z.string().uuid();

async function requireTeacherAssessmentOwner(assessmentId: string) {
  const roleResult = await requireRole(["TEACHER"]);
  if (!roleResult.ok) {
    return roleResult;
  }

  if (!uuidSchema.safeParse(assessmentId).success) {
    return {
      ok: false as const,
      response: jsonError("Assessment not found.", 404, "ERR_NOT_FOUND"),
    };
  }

  const assessment = await db.assessment.findUnique({
    where: { id: assessmentId },
    include: { subject: true },
  });
  if (!assessment) {
    return {
      ok: false as const,
      response: jsonError("Assessment not found.", 404, "ERR_NOT_FOUND"),
    };
  }
  if (assessment.subject.teacherId !== roleResult.data.id) {
    return {
      ok: false as const,
      response: jsonError(
        "You do not own this assessment.",
        403,
        "ERR_SUBJECT_FORBIDDEN"
      ),
    };
  }

  return {
    ok: true as const,
    data: { user: roleResult.data, assessment, subject: assessment.subject },
  };
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const owner = await requireTeacherAssessmentOwner(id);
  if (!owner.ok) {
    return owner.response;
  }

  if (owner.data.subject.isArchived) {
    return jsonError(
      "Cannot edit assessments on an archived subject.",
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

  const parsed = updateAssessmentSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid assessment update.",
      400,
      "ERR_VALIDATION"
    );
  }

  if (parsed.data.categoryId) {
    const category = await db.gradeCategory.findUnique({
      where: { id: parsed.data.categoryId },
    });
    if (!category || category.subjectId !== owner.data.assessment.subjectId) {
      return jsonError(
        "Grade category not found in this subject.",
        404,
        "ERR_CATEGORY_NOT_FOUND"
      );
    }
    if (category.categoryType !== "ASSESSMENT") {
      return jsonError(
        "Assessments can only belong to Assessment-type categories.",
        400,
        "ERR_INVALID_CATEGORY_TYPE"
      );
    }
  }

  const ipAddress = getClientIp(request);
  const prev = owner.data.assessment;

  const updated = await db.$transaction(async (tx) => {
    const next = await tx.assessment.update({
      where: { id },
      data: {
        ...(parsed.data.categoryId !== undefined
          ? { categoryId: parsed.data.categoryId }
          : {}),
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description || null }
          : {}),
        ...(parsed.data.maxScore !== undefined
          ? { maxScore: parsed.data.maxScore }
          : {}),
        ...(parsed.data.assessmentDate !== undefined
          ? {
              assessmentDate: parsed.data.assessmentDate
                ? new Date(parsed.data.assessmentDate)
                : null,
            }
          : {}),
        ...(parsed.data.submissionEnabled !== undefined
          ? { submissionEnabled: parsed.data.submissionEnabled }
          : {}),
        ...(parsed.data.dueAt !== undefined
          ? {
              dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
            }
          : {}),
        ...(parsed.data.allowLateSubmissions !== undefined
          ? { allowLateSubmissions: parsed.data.allowLateSubmissions }
          : {}),
        ...(parsed.data.requirePublicLink !== undefined
          ? { requirePublicLink: parsed.data.requirePublicLink }
          : {}),
      },
      include: {
        category: {
          select: {
            id: true,
            name: true,
            termKey: true,
            categoryType: true,
          },
        },
      },
    });

    await recordAuditLog(
      {
        actorUserId: owner.data.user.id,
        subjectId: prev.subjectId,
        action: "ASSESSMENT_UPDATED",
        targetType: "Assessment",
        targetId: id,
        beforeState: {
          title: prev.title,
          categoryId: prev.categoryId,
          maxScore: Number(prev.maxScore),
          submissionEnabled: Boolean(prev.submissionEnabled),
        },
        afterState: {
          title: next.title,
          categoryId: next.categoryId,
          maxScore: Number(next.maxScore),
          submissionEnabled: Boolean(next.submissionEnabled),
        },
        ipAddress,
      },
      tx
    );

    return next;
  });

  return NextResponse.json({
    assessment: {
      id: updated.id,
      subjectId: updated.subjectId,
      categoryId: updated.categoryId,
      category: updated.category,
      title: updated.title,
      description: updated.description,
      maxScore: Number(updated.maxScore),
      assessmentDate: updated.assessmentDate,
      submissionEnabled: Boolean(updated.submissionEnabled),
      dueAt: updated.dueAt ?? null,
      allowLateSubmissions: updated.allowLateSubmissions ?? true,
      requirePublicLink: updated.requirePublicLink ?? true,
      createdAt: updated.createdAt,
    },
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const owner = await requireTeacherAssessmentOwner(id);
  if (!owner.ok) {
    return owner.response;
  }

  if (owner.data.subject.isArchived) {
    return jsonError(
      "Cannot delete assessments on an archived subject.",
      400,
      "ERR_SUBJECT_ARCHIVED"
    );
  }

  const ipAddress = getClientIp(request);

  await db.$transaction(async (tx) => {
    await tx.assessment.delete({ where: { id } });

    await recordAuditLog(
      {
        actorUserId: owner.data.user.id,
        subjectId: owner.data.assessment.subjectId,
        action: "ASSESSMENT_DELETED",
        targetType: "Assessment",
        targetId: id,
        beforeState: {
          title: owner.data.assessment.title,
          maxScore: Number(owner.data.assessment.maxScore),
        },
        ipAddress,
      },
      tx
    );
  });

  return NextResponse.json({ ok: true });
}
