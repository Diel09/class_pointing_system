import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import {
  jsonError,
  requireSubjectMember,
  requireTeacherSubjectOwner,
} from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { round2 } from "@/lib/grading/computeStanding";
import { dispatchNotifications } from "@/lib/notifications/dispatch";
import { createAssessmentSchema } from "@/lib/validations/grading";

function computeEffectiveScore(
  status: "PENDING" | "GRADED" | "MISSING" | "EXCUSED",
  rawScore: number | null,
  bonusPoints: number,
  allowExtraCredit: boolean,
  maxScore: number
): number | null {
  if (status === "PENDING" || status === "EXCUSED") return null;
  if (status === "MISSING") return 0;
  const combined = (rawScore ?? 0) + bonusPoints;
  return round2(allowExtraCredit ? combined : Math.min(maxScore, combined));
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

  const { user, enrollment } = member.data;

  const assessments = await db.assessment.findMany({
    where: { subjectId: id },
    orderBy: [{ assessmentDate: "desc" }, { createdAt: "desc" }],
    include: {
      category: {
        select: {
          id: true,
          name: true,
          termKey: true,
          categoryType: true,
        },
      },
      ...(user.role === "STUDENT" && enrollment
        ? {
            scores: {
              where: { enrollmentId: enrollment.id },
              take: 1,
            },
          }
        : {
            scores: {
              select: { status: true },
            },
          }),
    },
  });

  const enrollmentCount =
    user.role === "STUDENT"
      ? undefined
      : await db.subjectEnrollment.count({ where: { subjectId: id } });

  const pendingBoostByAssessment = new Map<
    string,
    { count: number; totalBoost: number; totalPointsEscrowed: number }
  >();

  if (
    user.role === "STUDENT" &&
    enrollment &&
    typeof db.redemptionRequest?.findMany === "function"
  ) {
    const pendingBoosts = await db.redemptionRequest.findMany({
      where: {
        subjectId: id,
        enrollmentId: enrollment.id,
        status: "PENDING",
        targetAssessmentId: { not: null },
        projectedScoreBoost: { not: null },
      },
      select: {
        targetAssessmentId: true,
        projectedScoreBoost: true,
        pointsEscrowed: true,
      },
    });

    for (const req of pendingBoosts) {
      if (!req.targetAssessmentId || req.projectedScoreBoost === null) continue;
      const prev = pendingBoostByAssessment.get(req.targetAssessmentId) ?? {
        count: 0,
        totalBoost: 0,
        totalPointsEscrowed: 0,
      };
      pendingBoostByAssessment.set(req.targetAssessmentId, {
        count: prev.count + 1,
        totalBoost: round2(prev.totalBoost + Number(req.projectedScoreBoost)),
        totalPointsEscrowed: prev.totalPointsEscrowed + req.pointsEscrowed,
      });
    }
  }

  const assessmentIds = assessments.map((a) => a.id);

  const studentSubmissionsByAssessment = new Map<
    string,
    {
      id: string;
      driveUrl: string;
      normalizedUrl: string;
      driveResourceId: string | null;
      status: "SUBMITTED" | "LATE";
      accessStatus: "PUBLIC_VERIFIED" | "UNVERIFIED" | "PRIVATE_OR_RESTRICTED";
      accessCheckedAt: Date | null;
      studentNote: string | null;
      submittedAt: Date;
      updatedAt: Date;
    }
  >();

  const teacherSubmissionSummaryByAssessment = new Map<
    string,
    { totalSubmitted: number; lateCount: number }
  >();

  if (
    assessmentIds.length > 0 &&
    typeof db.assessmentSubmission?.findMany === "function"
  ) {
    if (user.role === "STUDENT" && enrollment) {
      const mySubmissions = await db.assessmentSubmission.findMany({
        where: {
          enrollmentId: enrollment.id,
          assessmentId: { in: assessmentIds },
        },
      });
      for (const sub of mySubmissions) {
        studentSubmissionsByAssessment.set(sub.assessmentId, {
          id: sub.id,
          driveUrl: sub.driveUrl,
          normalizedUrl: sub.normalizedUrl,
          driveResourceId: sub.driveResourceId,
          status: sub.status,
          accessStatus: sub.accessStatus,
          accessCheckedAt: sub.accessCheckedAt,
          studentNote: sub.studentNote,
          submittedAt: sub.submittedAt,
          updatedAt: sub.updatedAt,
        });
      }
    } else if (user.role !== "STUDENT") {
      const allSubmissions = await db.assessmentSubmission.findMany({
        where: {
          assessmentId: { in: assessmentIds },
        },
        select: {
          assessmentId: true,
          status: true,
        },
      });
      for (const sub of allSubmissions) {
        const prev = teacherSubmissionSummaryByAssessment.get(
          sub.assessmentId
        ) ?? { totalSubmitted: 0, lateCount: 0 };
        teacherSubmissionSummaryByAssessment.set(sub.assessmentId, {
          totalSubmitted: prev.totalSubmitted + 1,
          lateCount: prev.lateCount + (sub.status === "LATE" ? 1 : 0),
        });
      }
    }
  }

  return NextResponse.json({
    assessments: assessments.map((a) => {
      const maxScore = Number(a.maxScore);
      const submissionConfig = {
        submissionEnabled: Boolean(a.submissionEnabled),
        dueAt: a.dueAt ?? null,
        allowLateSubmissions: a.allowLateSubmissions ?? true,
        requirePublicLink: a.requirePublicLink ?? true,
      };
      if (user.role === "STUDENT") {
        const s = a.scores[0] as
          | {
              status: "PENDING" | "GRADED" | "MISSING" | "EXCUSED";
              rawScore: unknown;
              bonusPoints: unknown;
              allowExtraCredit: boolean;
              remarks?: string | null;
              updatedAt?: Date;
            }
          | undefined;
        const status = s?.status ?? "PENDING";
        const rawScore =
          s && s.rawScore !== null && s.rawScore !== undefined
            ? Number(s.rawScore)
            : null;
        const bonusPoints = s ? Number(s.bonusPoints) : 0;
        const allowExtraCredit = s?.allowExtraCredit ?? false;
        const pendingBoost = pendingBoostByAssessment.get(a.id) ?? {
          count: 0,
          totalBoost: 0,
          totalPointsEscrowed: 0,
        };

        return {
          id: a.id,
          subjectId: a.subjectId,
          categoryId: a.categoryId,
          category: a.category,
          title: a.title,
          description: a.description,
          maxScore,
          assessmentDate: a.assessmentDate,
          ...submissionConfig,
          createdAt: a.createdAt,
          mySubmission: studentSubmissionsByAssessment.get(a.id) ?? null,
          pendingBoost,
          myScore: {
            status,
            rawScore,
            bonusPoints,
            allowExtraCredit,
            effectiveScore: computeEffectiveScore(
              status,
              rawScore,
              bonusPoints,
              allowExtraCredit,
              maxScore
            ),
            remarks: s?.remarks ?? null,
            updatedAt: s?.updatedAt ?? null,
          },
        };
      }

      let gradedCount = 0;
      let missingCount = 0;
      let excusedCount = 0;
      for (const s of a.scores) {
        if (s.status === "GRADED") gradedCount += 1;
        else if (s.status === "MISSING") missingCount += 1;
        else if (s.status === "EXCUSED") excusedCount += 1;
      }
      const totalStudents = enrollmentCount ?? 0;
      const pendingCount = Math.max(
        0,
        totalStudents - gradedCount - missingCount - excusedCount
      );
      const subSummary = teacherSubmissionSummaryByAssessment.get(a.id) ?? {
        totalSubmitted: 0,
        lateCount: 0,
      };

      return {
        id: a.id,
        subjectId: a.subjectId,
        categoryId: a.categoryId,
        category: a.category,
        title: a.title,
        description: a.description,
        maxScore,
        assessmentDate: a.assessmentDate,
        ...submissionConfig,
        createdAt: a.createdAt,
        scoreSummary: {
          gradedCount,
          missingCount,
          excusedCount,
          pendingCount,
          totalStudents,
        },
        submissionSummary: {
          totalSubmitted: subSummary.totalSubmitted,
          lateCount: subSummary.lateCount,
          totalStudents,
        },
      };
    }),
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
      "Cannot create assessments on an archived subject.",
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

  const parsed = createAssessmentSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid assessment payload.",
      400,
      "ERR_VALIDATION"
    );
  }

  const category = await db.gradeCategory.findUnique({
    where: { id: parsed.data.categoryId },
  });
  if (!category || category.subjectId !== id) {
    return jsonError(
      "Grade category not found in this subject.",
      404,
      "ERR_CATEGORY_NOT_FOUND"
    );
  }
  if (category.categoryType !== "ASSESSMENT") {
    return jsonError(
      "Assessments can only be added to Assessment-type categories.",
      400,
      "ERR_INVALID_CATEGORY_TYPE"
    );
  }

  const ipAddress = getClientIp(request);

  const created = await db.$transaction(async (tx) => {
    const assessment = await tx.assessment.create({
      data: {
        subjectId: id,
        categoryId: category.id,
        title: parsed.data.title,
        description: parsed.data.description || null,
        maxScore: parsed.data.maxScore,
        assessmentDate: parsed.data.assessmentDate
          ? new Date(parsed.data.assessmentDate)
          : null,
        submissionEnabled: parsed.data.submissionEnabled ?? false,
        dueAt: parsed.data.dueAt ? new Date(parsed.data.dueAt) : null,
        allowLateSubmissions: parsed.data.allowLateSubmissions ?? true,
        requirePublicLink: parsed.data.requirePublicLink ?? true,
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
        subjectId: id,
        action: "ASSESSMENT_CREATED",
        targetType: "Assessment",
        targetId: assessment.id,
        afterState: {
          title: assessment.title,
          categoryId: assessment.categoryId,
          maxScore: Number(assessment.maxScore),
          submissionEnabled: Boolean(assessment.submissionEnabled),
        },
        ipAddress,
      },
      tx
    );

    return assessment;
  });

  const enrollments =
    typeof db.subjectEnrollment?.findMany === "function"
      ? await db.subjectEnrollment.findMany({
          where: { subjectId: id },
          select: { studentId: true },
        })
      : [];

  if (enrollments.length > 0) {
    await dispatchNotifications(
      enrollments.map((enr) => ({
        userId: enr.studentId,
        subjectId: id,
        type: "ASSESSMENT_POSTED",
        title: `New Assessment (${owner.data.subject.code})`,
        body: `${created.title} (${created.category.name}, max ${Number(
          created.maxScore
        )} pts) was posted.`,
        linkUrl: `/subjects/${id}`,
      }))
    );
  }

  return NextResponse.json(
    {
      assessment: {
        id: created.id,
        subjectId: created.subjectId,
        categoryId: created.categoryId,
        category: created.category,
        title: created.title,
        description: created.description,
        maxScore: Number(created.maxScore),
        assessmentDate: created.assessmentDate,
        submissionEnabled: Boolean(created.submissionEnabled),
        dueAt: created.dueAt ?? null,
        allowLateSubmissions: created.allowLateSubmissions ?? true,
        requirePublicLink: created.requirePublicLink ?? true,
        createdAt: created.createdAt,
      },
    },
    { status: 201 }
  );
}
