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
      groupSet: {
        select: { id: true, name: true },
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
    const isCoTeacher =
      typeof db.subjectCoTeacher?.findUnique === "function" &&
      Boolean(
        await db.subjectCoTeacher.findUnique({
          where: {
            subjectId_teacherId: {
              subjectId: assessment.subjectId,
              teacherId: roleResult.data.id,
            },
          },
          select: { id: true },
        })
      );
    if (!isCoTeacher) {
      return {
        ok: false as const,
        response: jsonError(
          "You do not own this assessment.",
          403,
          "ERR_SUBJECT_FORBIDDEN"
        ),
      };
    }
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
      isGroupOverride: Boolean(
        (score as { isGroupOverride?: boolean } | undefined)?.isGroupOverride
      ),
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

  const isGroupMode = Boolean((assessment as { isGroupMode?: boolean }).isGroupMode);
  const groupSetId =
    (assessment as { groupSetId?: string | null }).groupSetId ?? null;
  const groupSet =
    (assessment as { groupSet?: { id: string; name: string } | null }).groupSet ??
    null;

  let groupRows: {
    groupId: string;
    groupName: string;
    sortOrder: number;
    status: "PENDING" | "GRADED" | "MISSING" | "EXCUSED";
    rawScore: number | null;
    remarks: string | null;
    updatedAt: Date | null;
    submission: {
      id: string;
      normalizedUrl: string;
      status: "SUBMITTED" | "LATE";
      accessStatus: "PUBLIC_VERIFIED" | "UNVERIFIED" | "PRIVATE_OR_RESTRICTED";
      studentNote: string | null;
      submittedAt: Date;
      updatedAt: Date;
      submittedByName: string | null;
    } | null;
    members: typeof rows;
  }[] = [];
  let ungroupedRows: typeof rows = [];

  if (
    isGroupMode &&
    groupSetId &&
    typeof db.studentGroup?.findMany === "function"
  ) {
    const [groups, groupScores, groupSubmissions] = await Promise.all([
      db.studentGroup.findMany({
        where: { groupSetId },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        include: {
          memberships: {
            select: { enrollmentId: true },
          },
        },
      }),
      typeof db.groupAssessmentScore?.findMany === "function"
        ? db.groupAssessmentScore.findMany({ where: { assessmentId: id } })
        : Promise.resolve([]),
      typeof db.groupAssessmentSubmission?.findMany === "function"
        ? db.groupAssessmentSubmission.findMany({
            where: { assessmentId: id },
            include: {
              submittedByEnrollment: {
                select: {
                  student: { select: { fullName: true } },
                },
              },
            },
          })
        : Promise.resolve([]),
    ]);

    const rowByEnrollment = new Map(rows.map((r) => [r.enrollmentId, r]));
    const groupScoreByGroup = new Map(
      groupScores.map((gs) => [gs.groupId, gs])
    );
    const groupSubByGroup = new Map(
      groupSubmissions.map((sub) => [sub.groupId, sub])
    );
    const assignedEnrollmentIds = new Set<string>();

    groupRows = groups.map((g) => {
      const gs = groupScoreByGroup.get(g.id);
      const sub = groupSubByGroup.get(g.id);
      const members = g.memberships
        .map((m) => {
          assignedEnrollmentIds.add(m.enrollmentId);
          return rowByEnrollment.get(m.enrollmentId);
        })
        .filter((r): r is NonNullable<typeof r> => Boolean(r))
        .sort((a, b) => a.student.fullName.localeCompare(b.student.fullName));

      return {
        groupId: g.id,
        groupName: g.name,
        sortOrder: g.sortOrder,
        status: gs?.status ?? "PENDING",
        rawScore:
          gs && gs.rawScore !== null && gs.rawScore !== undefined
            ? Number(gs.rawScore)
            : null,
        remarks: gs?.remarks ?? null,
        updatedAt: gs?.updatedAt ?? null,
        submission: sub
          ? {
              id: sub.id,
              normalizedUrl: sub.normalizedUrl,
              status: sub.status,
              accessStatus: sub.accessStatus,
              studentNote: sub.studentNote,
              submittedAt: sub.submittedAt,
              updatedAt: sub.updatedAt,
              submittedByName:
                sub.submittedByEnrollment?.student.fullName ?? null,
            }
          : null,
        members,
      };
    });

    ungroupedRows = rows.filter((r) => !assignedEnrollmentIds.has(r.enrollmentId));
  }

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
      isGroupMode,
      groupSetId,
      groupSet,
    },
    rows,
    ...(isGroupMode ? { groupRows, ungroupedRows } : {}),
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
  const ipAddress = getClientIp(request);

  if (
    (assessment as { isGroupMode?: boolean }).isGroupMode &&
    (parsed.data.groupScores || parsed.data.memberScores)
  ) {
    const groupScores = parsed.data.groupScores ?? [];
    const memberScores = parsed.data.memberScores ?? [];

    for (const item of groupScores) {
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

    for (const item of memberScores) {
      if (
        item.isGroupOverride &&
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

    const groupSetId = (assessment as { groupSetId?: string | null }).groupSetId;
    const uniqueGroupIds = Array.from(new Set(groupScores.map((g) => g.groupId)));
    const groups =
      uniqueGroupIds.length > 0 && groupSetId
        ? await db.studentGroup.findMany({
            where: {
              groupSetId,
              id: { in: uniqueGroupIds },
            },
            include: {
              memberships: {
                select: { enrollmentId: true },
              },
            },
          })
        : [];

    if (groups.length !== uniqueGroupIds.length) {
      return jsonError(
        "One or more groups do not belong to this assessment's group set.",
        400,
        "ERR_GROUP_NOT_FOUND"
      );
    }

    const uniqueMemberEnrollmentIds = Array.from(
      new Set([
        ...groups.flatMap((g) => g.memberships.map((m) => m.enrollmentId)),
        ...memberScores.map((m) => m.enrollmentId),
      ])
    );

    const validEnrollments =
      uniqueMemberEnrollmentIds.length > 0
        ? await db.subjectEnrollment.findMany({
            where: {
              subjectId: assessment.subjectId,
              id: { in: uniqueMemberEnrollmentIds },
            },
            select: { id: true, studentId: true },
          })
        : [];

    if (validEnrollments.length !== uniqueMemberEnrollmentIds.length) {
      return jsonError(
        "One or more students are not enrolled in this subject.",
        400,
        "ERR_NOT_ENROLLED"
      );
    }

    const membersByGroup = new Map(
      groups.map((g) => [g.id, g.memberships.map((m) => m.enrollmentId)])
    );
    const overrideByEnrollment = new Map(
      memberScores.map((m) => [m.enrollmentId, m])
    );

    const finalMemberUpdates: {
      enrollmentId: string;
      status: "PENDING" | "GRADED" | "MISSING" | "EXCUSED";
      rawScore: number | null;
      remarks: string | null;
      isGroupOverride: boolean;
    }[] = [];
    const handledEnrollments = new Set<string>();

    for (const gEntry of groupScores) {
      const memberIds = membersByGroup.get(gEntry.groupId) ?? [];
      for (const enrollmentId of memberIds) {
        handledEnrollments.add(enrollmentId);
        const override = overrideByEnrollment.get(enrollmentId);
        if (override && override.isGroupOverride) {
          finalMemberUpdates.push({
            enrollmentId,
            status: override.status,
            rawScore:
              override.status === "GRADED" ? (override.rawScore ?? 0) : null,
            remarks: override.remarks?.trim() || null,
            isGroupOverride: true,
          });
        } else {
          finalMemberUpdates.push({
            enrollmentId,
            status: gEntry.status,
            rawScore:
              gEntry.status === "GRADED" ? (gEntry.rawScore ?? 0) : null,
            remarks: gEntry.remarks?.trim() || null,
            isGroupOverride: false,
          });
        }
      }
    }

    for (const mEntry of memberScores) {
      if (handledEnrollments.has(mEntry.enrollmentId)) continue;
      handledEnrollments.add(mEntry.enrollmentId);
      finalMemberUpdates.push({
        enrollmentId: mEntry.enrollmentId,
        status: mEntry.status,
        rawScore: mEntry.status === "GRADED" ? (mEntry.rawScore ?? 0) : null,
        remarks: mEntry.remarks?.trim() || null,
        isGroupOverride: Boolean(mEntry.isGroupOverride),
      });
    }

    try {
      await db.$transaction(
        async (tx) => {
          for (const gEntry of groupScores) {
            const normalizedRawScore =
              gEntry.status === "GRADED" ? (gEntry.rawScore ?? 0) : null;
            const remarks = gEntry.remarks?.trim() || null;

            await tx.groupAssessmentScore.upsert({
              where: {
                assessmentId_groupId: {
                  assessmentId: id,
                  groupId: gEntry.groupId,
                },
              },
              update: {
                status: gEntry.status,
                rawScore: normalizedRawScore,
                remarks,
                updatedByTeacherId: user.id,
              },
              create: {
                assessmentId: id,
                groupId: gEntry.groupId,
                status: gEntry.status,
                rawScore: normalizedRawScore,
                remarks,
                updatedByTeacherId: user.id,
              },
            });
          }

          for (const entry of finalMemberUpdates) {
            await tx.assessmentScore.upsert({
              where: {
                assessmentId_enrollmentId: {
                  assessmentId: id,
                  enrollmentId: entry.enrollmentId,
                },
              },
              update: {
                status: entry.status,
                rawScore: entry.rawScore,
                remarks: entry.remarks,
                isGroupOverride: entry.isGroupOverride,
                updatedByTeacherId: user.id,
              },
              create: {
                assessmentId: id,
                enrollmentId: entry.enrollmentId,
                status: entry.status,
                rawScore: entry.rawScore,
                bonusPoints: 0,
                allowExtraCredit: false,
                isGroupOverride: entry.isGroupOverride,
                remarks: entry.remarks,
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
                isGroupMode: true,
                updatedGroupsCount: groupScores.length,
                updatedCount: finalMemberUpdates.length,
              },
              ipAddress,
            },
            tx
          );
        },
        { timeout: 15000 }
      );
    } catch (error) {
      console.error("Update group assessment scores error:", error);
      return jsonError(
        "Failed to save group assessment scores.",
        500,
        "ERR_INTERNAL"
      );
    }

    const studentIdByEnrollment = new Map(
      validEnrollments
        .filter((e): e is { id: string; studentId: string } =>
          Boolean(e.studentId)
        )
        .map((e) => [e.id, e.studentId])
    );

    const notificationItems = finalMemberUpdates
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
      updatedGroupsCount: groupScores.length,
      updatedCount: finalMemberUpdates.length,
    });
  }

  const scoreEntries = parsed.data.scores ?? [];
  if (scoreEntries.length === 0) {
    return jsonError(
      "Provide at least one score update.",
      400,
      "ERR_VALIDATION"
    );
  }

  for (const item of scoreEntries) {
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
    new Set(scoreEntries.map((s) => s.enrollmentId))
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

  try {
    await db.$transaction(
      async (tx) => {
        for (const entry of scoreEntries) {
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
              updatedCount: scoreEntries.length,
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

  const notificationItems = scoreEntries
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
    updatedCount: scoreEntries.length,
  });
}
