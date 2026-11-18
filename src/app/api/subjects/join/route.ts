import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError, requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { dispatchNotifications } from "@/lib/notifications/dispatch";
import { joinSubjectSchema } from "@/lib/validations/subject";

export async function POST(request: Request) {
  const roleCheck = await requireRole(["STUDENT"]);
  if (!roleCheck.ok) {
    return roleCheck.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = joinSubjectSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid invite code.",
      400,
      "ERR_VALIDATION"
    );
  }

  const subject = await db.subject.findUnique({
    where: { inviteCode: parsed.data.inviteCode },
    include: {
      teacher: { select: { fullName: true } },
      term: { select: { name: true } },
    },
  });

  if (!subject) {
    return jsonError(
      "No class matches that invite code.",
      404,
      "ERR_INVALID_CLASS_CODE"
    );
  }

  if (subject.isArchived) {
    return jsonError(
      "This class is archived and no longer accepting new students.",
      400,
      "ERR_SUBJECT_ARCHIVED"
    );
  }

  const existing = await db.subjectEnrollment.findUnique({
    where: {
      subjectId_studentId: {
        subjectId: subject.id,
        studentId: roleCheck.data.id,
      },
    },
    select: { id: true },
  });

  if (existing) {
    return jsonError(
      "You are already enrolled in this class.",
      409,
      "ERR_ALREADY_ENROLLED"
    );
  }

  const ipAddress = getClientIp(request);

  try {
    const enrollment = await db.$transaction(async (tx) => {
      const created = await tx.subjectEnrollment.create({
        data: {
          subjectId: subject.id,
          studentId: roleCheck.data.id,
          availableBalance: 0,
          escrowedBalance: 0,
        },
      });

      await recordAuditLog(
        {
          actorUserId: roleCheck.data.id,
          subjectId: subject.id,
          action: "STUDENT_JOINED_SUBJECT",
          targetType: "SubjectEnrollment",
          targetId: created.id,
          afterState: {
            availableBalance: created.availableBalance,
            escrowedBalance: created.escrowedBalance,
          },
          ipAddress,
        },
        tx
      );

      return created;
    });

    await dispatchNotifications([
      {
        userId: subject.teacherId,
        subjectId: subject.id,
        type: "STUDENT_JOINED",
        title: `Student Joined (${subject.code})`,
        body: `${roleCheck.data.fullName} joined ${subject.code} (${subject.section}).`,
        linkUrl: `/subjects/${subject.id}`,
      },
    ]);

    return NextResponse.json(
      {
        enrollment,
        subject: {
          id: subject.id,
          code: subject.code,
          title: subject.title,
          section: subject.section,
          teacherName: subject.teacher.fullName,
          termName: subject.term.name,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError(
        "You are already enrolled in this class.",
        409,
        "ERR_ALREADY_ENROLLED"
      );
    }
    console.error("Join subject error:", error);
    return jsonError("Failed to join class.", 500, "ERR_INTERNAL");
  }
}
