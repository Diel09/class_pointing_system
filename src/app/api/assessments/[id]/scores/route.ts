import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError, requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { round2 } from "@/lib/grading/computeStanding";
import { dispatchNotifications } from "@/lib/notifications/dispatch";
import { upsertAssessmentScoresSchema } from "@/lib/validations/grading";

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
    include: {
      subject: true,
      category: {
        select: { id: true, name: true, termKey: true },
      },
    },
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

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const owner = await requireTeacherAssessmentOwner(id);
  if (!owner.ok) {
    return owner.response;
  }

  const { assessment } = owner.data;
  const maxScore = Number(assessment.maxScore);

  const [enrollments, existingScores, existingSubmissions] = await Promise.all([
    db.subjectEnrollment.findMany({
      where: { subjectId: assessment.subjectId },
      orderBy: { student: { fullName: "asc" } },
      select: {
        id: true,
        manualStandingOverride: true,
        student: {
          select: {
            id: true,
            fullName: true,
            email: true,
            institutionalId: true,
          },
        },
      },
    }),
    db.assessmentScore.findMany({
      where: { assessmentId: id },
    }),
    typeof db.assessmentSubmission?.findMany === "function"
      ? db.assessmentSubmission.findMany({
          where: { assessmentId: id },
        })
      : Promise.resolve([]),
  ]);

  const scoreByEnrollment = new Map(
    existingScores.map((s) => [s.enrollmentId, s])
  );
  const submissionByEnrollment = new Map(
    existingSubmissions.map((sub) => [sub.enrollmentId, sub])
  );

  const rows = enrollments.map((enrollment) => {
    const score = scoreByEnrollment.get(enrollment.id);
    const submission = submissionByEnrollment.get(enrollment.id);
    const status = score?.status ?? "PENDING";
    const rawScore =
      score && score.rawScore !== null ? Number(score.rawScore) : null;
    const bonusPoints = score ? Number(score.bonusPoints) : 0;
    const allowExtraCredit = score?.allowExtraCredit ?? false;

    let effectiveScore: number | null = null;
    if (status === "MISSING") {
      effectiveScore = 0;
    } else if (status === "GRADED") {
      const combined = (rawScore ?? 0) + bonusPoints;
      effectiveScore = round2(
        allowExtraCredit ? combined : Math.min(maxScore, combined)
      );
    }

    return {
      enrollmentId: enrollment.id,
      manualStandingOverride: enrollment.manualStandingOverride,
      student: enrollment.student,
      status,
      rawScore,
      bonusPoints,
      allowExtraCredit,
      effectiveScore,
      remarks: score?.remarks ?? null,
      updatedAt: score?.updatedAt ?? null,
      submission: submission
        ? {
            id: submission.id,
            normalizedUrl: submission.normalizedUrl,
            status: submission.status,
            accessStatus: submission.accessStatus,
            studentNote: submission.studentNote,
            submittedAt: submission.submittedAt,
            updatedAt: submission.updatedAt,
          }
        : null,
    };
  });

  return NextResponse.json({
    assessment: {
      id: assessment.id,
      subjectId: assessment.subjectId,
      categoryId: assessment.categoryId,
      category: assessment.category,
      title: assessment.title,
      description: assessment.description,
      maxScore,
      assessmentDate: assessment.assessmentDate,
      submissionEnabled: Boolean(assessment.submissionEnabled),
      dueAt: assessment.dueAt ?? null,
      allowLateSubmissions: assessment.allowLateSubmissions ?? true,
      requirePublicLink: assessment.requirePublicLink ?? true,
    },
    rows,
  });
}

export async function PUT(
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
      "Cannot modify scores on an archived subject.",
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

  const parsed = upsertAssessmentScoresSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid scores payload.",
      400,
      "ERR_VALIDATION"
    );
  }

  const { assessment, user } = owner.data;
  const maxScore = Number(assessment.maxScore);

  for (const item of parsed.data.scores) {
    if (
      item.status === "GRADED" &&
      item.rawScore !== null &&
      item.rawScore !== undefined &&
      item.rawScore > maxScore
    ) {
      return jsonError(
        `Raw score (${item.rawScore}) cannot exceed assessment max score (${maxScore}). Point boosts add bonus points separately.`,
        400,
        "ERR_SCORE_EXCEEDS_MAX"
      );
    }
  }

  const uniqueEnrollmentIds = Array.from(
    new Set(parsed.data.scores.map((s) => s.enrollmentId))
  );
  const validEnrollments = await db.subjectEnrollment.findMany({
    where: {
      subjectId: assessment.subjectId,
      id: { in: uniqueEnrollmentIds },
    },
    select: { id: true, studentId: true },
  });

  if (validEnrollments.length !== uniqueEnrollmentIds.length) {
    return jsonError(
      "One or more students are not enrolled in this subject.",
      400,
      "ERR_NOT_ENROLLED"
    );
  }

  const ipAddress = getClientIp(request);

  try {
    await db.$transaction(
      async (tx) => {
        for (const entry of parsed.data.scores) {
          const normalizedRawScore =
            entry.status === "GRADED" ? (entry.rawScore ?? 0) : null;
          const remarks = entry.remarks?.trim() || null;

          await tx.assessmentScore.upsert({
            where: {
              assessmentId_enrollmentId: {
                assessmentId: id,
                enrollmentId: entry.enrollmentId,
              },
            },
            update: {
              status: entry.status,
              rawScore: normalizedRawScore,
              remarks,
              updatedByTeacherId: user.id,
            },
            create: {
              assessmentId: id,
              enrollmentId: entry.enrollmentId,
              status: entry.status,
              rawScore: normalizedRawScore,
              bonusPoints: 0,
              allowExtraCredit: false,
              remarks,
              updatedByTeacherId: user.id,
            },
          });
        }

        await recordAuditLog(
          {
            actorUserId: user.id,
            subjectId: assessment.subjectId,
            action: "ASSESSMENT_SCORES_UPDATED",
            targetType: "Assessment",
            targetId: id,
            afterState: {
              updatedCount: parsed.data.scores.length,
            },
            ipAddress,
          },
          tx
        );
      },
      { timeout: 15000 }
    );
  } catch (error) {
    console.error("Update assessment scores error:", error);
    return jsonError(
      "Failed to save assessment scores.",
      500,
      "ERR_INTERNAL"
    );
  }

  const studentIdByEnrollment = new Map(
    validEnrollments
      .filter((e): e is { id: string; studentId: string } => Boolean(e.studentId))
      .map((e) => [e.id, e.studentId])
  );

  const notificationItems = parsed.data.scores
    .filter((entry) => entry.status !== "PENDING")
    .map((entry) => {
      const studentUserId = studentIdByEnrollment.get(entry.enrollmentId);
      if (!studentUserId) return null;
      const summaryText =
        entry.status === "GRADED"
          ? `Score recorded: ${entry.rawScore ?? 0}/${maxScore}`
          : `Status updated: ${entry.status}`;
      return {
        userId: studentUserId,
        subjectId: assessment.subjectId,
        type: "SCORE_UPDATED" as const,
        title: `Score Updated (${owner.data.subject.code})`,
        body: `${assessment.title}: ${summaryText}.`,
        linkUrl: `/subjects/${assessment.subjectId}`,
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  if (notificationItems.length > 0) {
    await dispatchNotifications(notificationItems);
  }

  return NextResponse.json({
    ok: true,
    updatedCount: parsed.data.scores.length,
  });
}
