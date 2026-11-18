import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import {
  jsonError,
  requireSubjectMember,
  requireSubjectOwnerOrAdmin,
  requireTeacherSubjectOwner,
} from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { deleteSubjectsInTransaction } from "@/lib/subjects/delete-subjects";
import {
  generateInviteCode,
  hasValidSubjectDateRange,
  updateSubjectSchema,
} from "@/lib/validations/subject";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const member = await requireSubjectMember(id);
  if (!member.ok) {
    return member.response;
  }

  const subject = await db.subject.findUnique({
    where: { id },
    include: {
      teacher: { select: { id: true, fullName: true, email: true } },
      term: { select: { id: true, name: true, isActive: true } },
      _count: { select: { enrollments: true } },
    },
  });

  if (!subject) {
    return jsonError("Subject not found.", 404, "ERR_NOT_FOUND");
  }

  // Only expose teacher-only inviteCode management details to teacher owner / admin.
  const isStudent = member.data.user.role === "STUDENT";
  return NextResponse.json({
    subject: {
      id: subject.id,
      code: subject.code,
      title: subject.title,
      section: subject.section,
      startDate: subject.startDate,
      endDate: subject.endDate,
      isArchived: subject.isArchived,
      standingVisible: subject.standingVisible,
      allowNegativeBalance: subject.allowNegativeBalance,
      allowP2pTransfers: subject.allowP2pTransfers,
      p2pMaxPerTransfer: subject.p2pMaxPerTransfer,
      p2pMaxPerDay: subject.p2pMaxPerDay,
      p2pMaxPerTerm: subject.p2pMaxPerTerm,
      allowOpenRedemptions: subject.allowOpenRedemptions,
      teacher: subject.teacher,
      term: subject.term,
      enrollmentCount: subject._count.enrollments,
      ...(isStudent ? {} : { inviteCode: subject.inviteCode }),
    },
    enrollment: member.data.enrollment
      ? {
          id: member.data.enrollment.id,
          availableBalance: member.data.enrollment.availableBalance,
          escrowedBalance: member.data.enrollment.escrowedBalance,
          manualStandingOverride: member.data.enrollment.manualStandingOverride,
          enrolledAt: member.data.enrollment.enrolledAt,
        }
      : null,
  });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const owner = await requireTeacherSubjectOwner(id);
  if (!owner.ok) {
    return owner.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = updateSubjectSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid subject update.",
      400,
      "ERR_VALIDATION"
    );
  }

  if (parsed.data.termId) {
    const term = await db.academicTerm.findUnique({
      where: { id: parsed.data.termId },
      select: { id: true },
    });
    if (!term) {
      return jsonError("Academic term not found.", 404, "ERR_TERM_NOT_FOUND");
    }
  }

  let nextInviteCode: string | undefined;
  if (parsed.data.regenerateInviteCode) {
    nextInviteCode = generateInviteCode(8);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const clash = await db.subject.findUnique({
        where: { inviteCode: nextInviteCode },
        select: { id: true },
      });
      if (!clash) break;
      nextInviteCode = generateInviteCode(8);
    }
  }

  const prev = owner.data.subject;
  const effectiveStartDate =
    parsed.data.startDate !== undefined ? parsed.data.startDate : prev.startDate;
  const effectiveEndDate =
    parsed.data.endDate !== undefined ? parsed.data.endDate : prev.endDate;

  if (!hasValidSubjectDateRange(effectiveStartDate, effectiveEndDate)) {
    return jsonError(
      "End date must be on or after start date.",
      400,
      "ERR_INVALID_DATES"
    );
  }

  const ipAddress = getClientIp(request);

  const updated = await db.$transaction(async (tx) => {
    const subject = await tx.subject.update({
      where: { id },
      data: {
        ...(parsed.data.code !== undefined ? { code: parsed.data.code } : {}),
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(parsed.data.section !== undefined ? { section: parsed.data.section } : {}),
        ...(parsed.data.termId !== undefined ? { termId: parsed.data.termId } : {}),
        ...(parsed.data.startDate !== undefined
          ? { startDate: parsed.data.startDate }
          : {}),
        ...(parsed.data.endDate !== undefined
          ? { endDate: parsed.data.endDate }
          : {}),
        ...(parsed.data.isArchived !== undefined
          ? { isArchived: parsed.data.isArchived }
          : {}),
        ...(parsed.data.allowNegativeBalance !== undefined
          ? { allowNegativeBalance: parsed.data.allowNegativeBalance }
          : {}),
        ...(parsed.data.allowP2pTransfers !== undefined
          ? { allowP2pTransfers: parsed.data.allowP2pTransfers }
          : {}),
        ...(parsed.data.p2pMaxPerTransfer !== undefined
          ? { p2pMaxPerTransfer: parsed.data.p2pMaxPerTransfer }
          : {}),
        ...(parsed.data.p2pMaxPerDay !== undefined
          ? { p2pMaxPerDay: parsed.data.p2pMaxPerDay }
          : {}),
        ...(parsed.data.p2pMaxPerTerm !== undefined
          ? { p2pMaxPerTerm: parsed.data.p2pMaxPerTerm }
          : {}),
        ...(parsed.data.allowOpenRedemptions !== undefined
          ? { allowOpenRedemptions: parsed.data.allowOpenRedemptions }
          : {}),
        ...(parsed.data.standingVisible !== undefined
          ? { standingVisible: parsed.data.standingVisible }
          : {}),
        ...(nextInviteCode ? { inviteCode: nextInviteCode } : {}),
      },
      include: {
        term: { select: { id: true, name: true, isActive: true } },
        _count: { select: { enrollments: true } },
      },
    });

    await recordAuditLog(
      {
        actorUserId: owner.data.user.id,
        subjectId: id,
        action: "SUBJECT_UPDATED",
        targetType: "Subject",
        targetId: id,
        beforeState: {
          code: prev.code,
          title: prev.title,
          section: prev.section,
          startDate: prev.startDate?.toISOString() ?? null,
          endDate: prev.endDate?.toISOString() ?? null,
          isArchived: prev.isArchived,
          allowNegativeBalance: prev.allowNegativeBalance,
          allowP2pTransfers: prev.allowP2pTransfers,
          p2pMaxPerTransfer: prev.p2pMaxPerTransfer,
          p2pMaxPerDay: prev.p2pMaxPerDay,
          p2pMaxPerTerm: prev.p2pMaxPerTerm,
          allowOpenRedemptions: prev.allowOpenRedemptions,
          standingVisible: prev.standingVisible,
          inviteCode: prev.inviteCode,
        },
        afterState: {
          code: subject.code,
          title: subject.title,
          section: subject.section,
          startDate: subject.startDate?.toISOString() ?? null,
          endDate: subject.endDate?.toISOString() ?? null,
          isArchived: subject.isArchived,
          allowNegativeBalance: subject.allowNegativeBalance,
          allowP2pTransfers: subject.allowP2pTransfers,
          p2pMaxPerTransfer: subject.p2pMaxPerTransfer,
          p2pMaxPerDay: subject.p2pMaxPerDay,
          p2pMaxPerTerm: subject.p2pMaxPerTerm,
          allowOpenRedemptions: subject.allowOpenRedemptions,
          standingVisible: subject.standingVisible,
          inviteCode: subject.inviteCode,
        },
        ipAddress,
      },
      tx
    );

    return subject;
  });

  return NextResponse.json({ subject: updated });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const auth = await requireSubjectOwnerOrAdmin(id);
  if (!auth.ok) {
    return auth.response;
  }

  const enrollments = await db.subjectEnrollment.findMany({
    where: { subjectId: id },
    select: {
      id: true,
      studentId: true,
      availableBalance: true,
      escrowedBalance: true,
    },
  });

  const prev = auth.data.subject;
  const ipAddress = getClientIp(request);

  const result = await db.$transaction((tx) =>
    deleteSubjectsInTransaction(tx, {
      subjects: [
        {
          id: prev.id,
          code: prev.code,
          title: prev.title,
          section: prev.section,
          termId: prev.termId,
          isArchived: prev.isArchived,
          startDate: prev.startDate,
          endDate: prev.endDate,
          enrollments,
        },
      ],
      actorUserId: auth.data.user.id,
      ipAddress,
    })
  );

  return NextResponse.json({
    ok: true,
    unenrolledCount: result.unenrolledCount,
    clearedPointsTotal: result.clearedPointsTotal,
    notificationsDeleted: result.notificationsDeleted,
  });
}
