import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import {
  jsonError,
  requireSubjectInstructor,
  requireSubjectMember,
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
      groupSet: {
        select: {
          id: true,
          name: true,
          _count: {
            select: { groups: true },
          },
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
      submittedByName?: string | null;
    }
  >();

  interface StudentGroupSummary {
    id: string;
    name: string;
    members: { enrollmentId: string; fullName: string; isMe: boolean }[];
  }
  const myGroupBySetId = new Map<string, StudentGroupSummary>();

  const teacherSubmissionSummaryByAssessment = new Map<
    string,
    { totalSubmitted: number; lateCount: number }
  >();

  if (
    assessmentIds.length > 0 &&
    typeof db.assessmentSubmission?.findMany === "function"
  ) {
    if (user.role === "STUDENT" && enrollment) {
      const groupSetIds = Array.from(
        new Set(
          assessments
            .filter((a) => Boolean((a as { isGroupMode?: boolean }).isGroupMode))
            .map((a) => (a as { groupSetId?: string | null }).groupSetId)
            .filter((gsId): gsId is string => Boolean(gsId))
        )
      );

      if (
        groupSetIds.length > 0 &&
        typeof db.studentGroupMembership?.findMany === "function"
      ) {
        const memberships = await db.studentGroupMembership.findMany({
          where: {
            enrollmentId: enrollment.id,
            groupSetId: { in: groupSetIds },
          },
          include: {
            group: {
              include: {
                memberships: {
                  include: {
                    enrollment: {
                      select: {
                        id: true,
                        student: { select: { fullName: true } },
                      },
                    },
                  },
                },
              },
            },
          },
        });

        for (const m of memberships) {
          myGroupBySetId.set(m.groupSetId, {
            id: m.group.id,
            name: m.group.name,
            members: m.group.memberships
              .map((gm) => ({
                enrollmentId: gm.enrollment.id,
                fullName: gm.enrollment.student.fullName,
                isMe: gm.enrollment.id === enrollment.id,
              }))
              .sort((a, b) => a.fullName.localeCompare(b.fullName)),
          });
        }
      }

      const individualAssessmentIds = assessments
        .filter((a) => !((a as { isGroupMode?: boolean }).isGroupMode))
        .map((a) => a.id);

      if (individualAssessmentIds.length > 0) {
        const mySubmissions = await db.assessmentSubmission.findMany({
          where: {
            enrollmentId: enrollment.id,
            assessmentId: { in: individualAssessmentIds },
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
      }

      const groupAssessmentsWithGroup = assessments.filter((a) => {
        const typed = a as { isGroupMode?: boolean; groupSetId?: string | null };
        return (
          Boolean(typed.isGroupMode) &&
          Boolean(typed.groupSetId) &&
          myGroupBySetId.has(typed.groupSetId!)
        );
      });

      if (
        groupAssessmentsWithGroup.length > 0 &&
        typeof db.groupAssessmentSubmission?.findMany === "function"
      ) {
        const groupIds = Array.from(
          new Set(
            groupAssessmentsWithGroup.map(
              (a) =>
                myGroupBySetId.get(
                  (a as { groupSetId?: string | null }).groupSetId!
                )!.id
            )
          )
        );
        const groupSubs = await db.groupAssessmentSubmission.findMany({
          where: {
            assessmentId: { in: groupAssessmentsWithGroup.map((a) => a.id) },
            groupId: { in: groupIds },
          },
          include: {
            submittedByEnrollment: {
              select: {
                student: { select: { fullName: true } },
              },
            },
          },
        });

        const groupIdByAssessment = new Map(
          groupAssessmentsWithGroup.map((a) => [
            a.id,
            myGroupBySetId.get(
              (a as { groupSetId?: string | null }).groupSetId!
            )!.id,
          ])
        );

        for (const sub of groupSubs) {
          if (groupIdByAssessment.get(sub.assessmentId) !== sub.groupId) {
            continue;
          }
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
            submittedByName:
              sub.submittedByEnrollment?.student.fullName ?? null,
          });
        }
      }
    } else if (user.role !== "STUDENT") {
      const individualAssessmentIds = assessments
        .filter((a) => !((a as { isGroupMode?: boolean }).isGroupMode))
        .map((a) => a.id);
      const groupAssessmentIds = assessments
        .filter((a) => Boolean((a as { isGroupMode?: boolean }).isGroupMode))
        .map((a) => a.id);

      if (individualAssessmentIds.length > 0) {
        const allSubmissions = await db.assessmentSubmission.findMany({
          where: {
            assessmentId: { in: individualAssessmentIds },
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

      if (
        groupAssessmentIds.length > 0 &&
        typeof db.groupAssessmentSubmission?.findMany === "function"
      ) {
        const groupSubmissions = await db.groupAssessmentSubmission.findMany({
          where: {
            assessmentId: { in: groupAssessmentIds },
          },
          select: {
            assessmentId: true,
            status: true,
          },
        });
        for (const sub of groupSubmissions) {
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
  }

  return NextResponse.json({
    assessments: assessments.map((a) => {
      const maxScore = Number(a.maxScore);
      const isGroupMode = Boolean((a as { isGroupMode?: boolean }).isGroupMode);
      const groupSetId =
        (a as { groupSetId?: string | null }).groupSetId ?? null;
      const rawGroupSet = (
        a as {
          groupSet?: {
            id: string;
            name: string;
            _count?: { groups: number };
          } | null;
        }
      ).groupSet;
      const groupSet = rawGroupSet
        ? {
            id: rawGroupSet.id,
            name: rawGroupSet.name,
            groupCount: rawGroupSet._count?.groups ?? 0,
          }
        : null;
      const submissionConfig = {
        submissionEnabled: Boolean(a.submissionEnabled),
        dueAt: a.dueAt ?? null,
        allowLateSubmissions: a.allowLateSubmissions ?? true,
        requirePublicLink: a.requirePublicLink ?? true,
        isGroupMode,
        groupSetId,
        groupSet,
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
          myGroup:
            isGroupMode && groupSetId
              ? myGroupBySetId.get(groupSetId) ?? null
              : null,
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
      const hasRecordedWork =
        gradedCount + missingCount + excusedCount > 0 ||
        subSummary.totalSubmitted > 0;

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
        hasRecordedWork,
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
          totalGroups: groupSet?.groupCount ?? 0,
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
  const owner = await requireSubjectInstructor(id);
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

  const isGroupMode = Boolean(parsed.data.isGroupMode);
  const groupSetId = isGroupMode ? parsed.data.groupSetId ?? null : null;

  if (isGroupMode) {
    if (!groupSetId) {
      return jsonError(
        "Select a group set when Group Mode is enabled.",
        400,
        "ERR_VALIDATION"
      );
    }
    const groupSet = await db.groupSet.findUnique({
      where: { id: groupSetId },
      select: { id: true, subjectId: true },
    });
    if (!groupSet || groupSet.subjectId !== id) {
      return jsonError(
        "Group set not found in this subject.",
        404,
        "ERR_GROUP_SET_NOT_FOUND"
      );
    }
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
        isGroupMode,
        groupSetId,
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
        ...(isGroupMode
          ? {
              groupSet: {
                select: {
                  id: true,
                  name: true,
                },
              },
            }
          : {}),
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
          isGroupMode,
          groupSetId,
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
        isGroupMode: Boolean((created as { isGroupMode?: boolean }).isGroupMode),
        groupSetId:
          (created as { groupSetId?: string | null }).groupSetId ?? null,
        groupSet:
          (created as { groupSet?: { id: string; name: string } | null })
            .groupSet ?? null,
        createdAt: created.createdAt,
      },
    },
    { status: 201 }
  );
}
