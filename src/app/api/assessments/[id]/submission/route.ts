import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError, requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { dispatchNotifications } from "@/lib/notifications/dispatch";
import {
  parseGoogleDriveUrl,
  verifyGoogleDriveLinkAccess,
} from "@/lib/submissions/google-drive-link";
import { submitDriveLinkSchema } from "@/lib/validations/grading";

const uuidSchema = z.string().uuid();

async function requireStudentSubmissionContext(assessmentId: string) {
  const roleResult = await requireRole(["STUDENT"]);
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
    },
  });

  if (!assessment) {
    return {
      ok: false as const,
      response: jsonError("Assessment not found.", 404, "ERR_NOT_FOUND"),
    };
  }

  const enrollment = await db.subjectEnrollment.findUnique({
    where: {
      subjectId_studentId: {
        subjectId: assessment.subjectId,
        studentId: roleResult.data.id,
      },
    },
  });

  if (!enrollment) {
    return {
      ok: false as const,
      response: jsonError(
        "You are not enrolled in this subject.",
        403,
        "ERR_SUBJECT_FORBIDDEN"
      ),
    };
  }

  if (assessment.subject.isArchived) {
    return {
      ok: false as const,
      response: jsonError(
        "Cannot modify submissions on an archived subject.",
        400,
        "ERR_SUBJECT_ARCHIVED"
      ),
    };
  }

  if (!assessment.submissionEnabled) {
    return {
      ok: false as const,
      response: jsonError(
        "Submissions are not enabled for this assessment.",
        403,
        "ERR_SUBMISSIONS_DISABLED"
      ),
    };
  }

  const existingScore = await db.assessmentScore.findUnique({
    where: {
      assessmentId_enrollmentId: {
        assessmentId,
        enrollmentId: enrollment.id,
      },
    },
    select: { status: true },
  });

  if (
    existingScore &&
    (existingScore.status === "GRADED" || existingScore.status === "EXCUSED")
  ) {
    return {
      ok: false as const,
      response: jsonError(
        "Your submission is locked because this assessment has already been graded.",
        409,
        "ERR_SUBMISSION_LOCKED"
      ),
    };
  }

  return {
    ok: true as const,
    data: {
      user: roleResult.data,
      assessment,
      subject: assessment.subject,
      enrollment,
    },
  };
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const ctx = await requireStudentSubmissionContext(id);
  if (!ctx.ok) {
    return ctx.response;
  }

  const { user, assessment, subject, enrollment } = ctx.data;
  const now = new Date();
  const isPastDue = Boolean(assessment.dueAt && now > assessment.dueAt);

  if (isPastDue && !assessment.allowLateSubmissions) {
    return jsonError(
      "The submission deadline has passed and late submissions are closed.",
      400,
      "ERR_SUBMISSION_PAST_DUE"
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = submitDriveLinkSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid Google Drive submission.",
      400,
      "ERR_VALIDATION"
    );
  }

  const linkParsed = parseGoogleDriveUrl(parsed.data.driveUrl);
  if (!linkParsed.ok) {
    return jsonError(linkParsed.error, 400, "ERR_VALIDATION");
  }

  const accessResult = await verifyGoogleDriveLinkAccess(
    linkParsed.data.normalizedUrl
  );

  if (accessResult.accessStatus === "NOT_FOUND") {
    return jsonError(
      accessResult.reason ?? "Google Drive item was not found (404).",
      422,
      "ERR_DRIVE_LINK_NOT_FOUND"
    );
  }

  if (
    accessResult.accessStatus === "PRIVATE_OR_RESTRICTED" &&
    assessment.requirePublicLink
  ) {
    return jsonError(
      accessResult.reason ??
        "This Google Drive link is private/restricted. Set sharing to 'Anyone with the link'.",
      422,
      "ERR_DRIVE_LINK_RESTRICTED"
    );
  }

  const persistedAccessStatus =
    accessResult.accessStatus === "PRIVATE_OR_RESTRICTED"
      ? "PRIVATE_OR_RESTRICTED"
      : accessResult.accessStatus === "PUBLIC_VERIFIED"
      ? "PUBLIC_VERIFIED"
      : "UNVERIFIED";

  const submissionStatus = isPastDue ? "LATE" : "SUBMITTED";
  const studentNote = parsed.data.studentNote?.trim() || null;
  const ipAddress = getClientIp(request);

  const saved = await db.$transaction(async (tx) => {
    const existing = await tx.assessmentSubmission.findUnique({
      where: {
        assessmentId_enrollmentId: {
          assessmentId: id,
          enrollmentId: enrollment.id,
        },
      },
      select: { id: true, submittedAt: true },
    });

    const submission = await tx.assessmentSubmission.upsert({
      where: {
        assessmentId_enrollmentId: {
          assessmentId: id,
          enrollmentId: enrollment.id,
        },
      },
      update: {
        driveUrl: linkParsed.data.originalUrl,
        normalizedUrl: linkParsed.data.normalizedUrl,
        driveResourceId: linkParsed.data.resourceId,
        status: submissionStatus,
        accessStatus: persistedAccessStatus,
        accessCheckedAt: accessResult.checkedAt,
        studentNote,
      },
      create: {
        assessmentId: id,
        enrollmentId: enrollment.id,
        driveUrl: linkParsed.data.originalUrl,
        normalizedUrl: linkParsed.data.normalizedUrl,
        driveResourceId: linkParsed.data.resourceId,
        status: submissionStatus,
        accessStatus: persistedAccessStatus,
        accessCheckedAt: accessResult.checkedAt,
        studentNote,
        submittedAt: now,
      },
    });

    await recordAuditLog(
      {
        actorUserId: user.id,
        subjectId: subject.id,
        action: existing
          ? "ASSESSMENT_SUBMISSION_UPDATED"
          : "ASSESSMENT_SUBMISSION_CREATED",
        targetType: "AssessmentSubmission",
        targetId: submission.id,
        afterState: {
          assessmentId: id,
          normalizedUrl: submission.normalizedUrl,
          status: submission.status,
          accessStatus: submission.accessStatus,
        },
        ipAddress,
      },
      tx
    );

    return submission;
  });

  await dispatchNotifications([
    {
      userId: subject.teacherId,
      subjectId: subject.id,
      type: "SUBMISSION_RECEIVED",
      title: `Activity Submission (${subject.code})`,
      body: `${user.fullName} submitted a Google Drive link for "${assessment.title}"${
        submissionStatus === "LATE" ? " (Late)" : ""
      }.`,
      linkUrl: `/subjects/${subject.id}/assessments/${assessment.id}`,
    },
  ]);

  return NextResponse.json({
    submission: {
      id: saved.id,
      driveUrl: saved.driveUrl,
      normalizedUrl: saved.normalizedUrl,
      driveResourceId: saved.driveResourceId,
      status: saved.status,
      accessStatus: saved.accessStatus,
      accessCheckedAt: saved.accessCheckedAt,
      studentNote: saved.studentNote,
      submittedAt: saved.submittedAt,
      updatedAt: saved.updatedAt,
    },
    accessWarning:
      persistedAccessStatus === "UNVERIFIED"
        ? accessResult.reason ??
          "Could not automatically verify public access; double-check your Drive sharing settings."
        : null,
  });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const ctx = await requireStudentSubmissionContext(id);
  if (!ctx.ok) {
    return ctx.response;
  }

  const { user, assessment, subject, enrollment } = ctx.data;
  if (
    assessment.dueAt &&
    new Date() > assessment.dueAt &&
    !assessment.allowLateSubmissions
  ) {
    return jsonError(
      "Cannot withdraw a submission after the deadline has closed.",
      400,
      "ERR_SUBMISSION_PAST_DUE"
    );
  }

  const existing = await db.assessmentSubmission.findUnique({
    where: {
      assessmentId_enrollmentId: {
        assessmentId: id,
        enrollmentId: enrollment.id,
      },
    },
    select: { id: true, normalizedUrl: true },
  });

  if (!existing) {
    return jsonError("No submission found to withdraw.", 404, "ERR_NOT_FOUND");
  }

  const ipAddress = getClientIp(request);

  await db.$transaction(async (tx) => {
    await tx.assessmentSubmission.delete({
      where: { id: existing.id },
    });

    await recordAuditLog(
      {
        actorUserId: user.id,
        subjectId: subject.id,
        action: "ASSESSMENT_SUBMISSION_WITHDRAWN",
        targetType: "AssessmentSubmission",
        targetId: existing.id,
        beforeState: {
          assessmentId: id,
          normalizedUrl: existing.normalizedUrl,
        },
        ipAddress,
      },
      tx
    );
  });

  return NextResponse.json({ ok: true });
}
