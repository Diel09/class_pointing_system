import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError, requireTeacherSubjectOwner } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { unenrollStudentsInTransaction } from "@/lib/subjects/unenroll-students";
import { updateStandingOverrideSchema } from "@/lib/validations/grading";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; enrollmentId: string }> }
) {
  const { id, enrollmentId } = await context.params;
  const owner = await requireTeacherSubjectOwner(id);
  if (!owner.ok) {
    return owner.response;
  }

  if (!UUID_REGEX.test(enrollmentId)) {
    return jsonError("Enrollment not found.", 404, "ERR_NOT_FOUND");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = updateStandingOverrideSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid standing override.",
      400,
      "ERR_VALIDATION"
    );
  }

  const enrollment = await db.subjectEnrollment.findUnique({
    where: { id: enrollmentId },
  });
  if (!enrollment || enrollment.subjectId !== id) {
    return jsonError("Enrollment not found.", 404, "ERR_NOT_FOUND");
  }

  const ipAddress = getClientIp(request);

  const updated = await db.$transaction(async (tx) => {
    const next = await tx.subjectEnrollment.update({
      where: { id: enrollmentId },
      data: { manualStandingOverride: parsed.data.manualStandingOverride },
      select: {
        id: true,
        manualStandingOverride: true,
      },
    });

    await recordAuditLog(
      {
        actorUserId: owner.data.user.id,
        subjectId: id,
        action: "ENROLLMENT_STANDING_OVERRIDE",
        targetType: "SubjectEnrollment",
        targetId: enrollmentId,
        beforeState: {
          manualStandingOverride: enrollment.manualStandingOverride,
        },
        afterState: {
          manualStandingOverride: next.manualStandingOverride,
        },
        ipAddress,
      },
      tx
    );

    return next;
  });

  return NextResponse.json({ enrollment: updated });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; enrollmentId: string }> }
) {
  const { id, enrollmentId } = await context.params;
  const owner = await requireTeacherSubjectOwner(id);
  if (!owner.ok) {
    return owner.response;
  }

  if (!UUID_REGEX.test(enrollmentId)) {
    return jsonError("Enrollment not found.", 404, "ERR_NOT_FOUND");
  }

  const enrollment = await db.subjectEnrollment.findUnique({
    where: { id: enrollmentId },
    include: {
      student: {
        select: {
          id: true,
          fullName: true,
          email: true,
          institutionalId: true,
        },
      },
    },
  });

  if (!enrollment || enrollment.subjectId !== id) {
    return jsonError("Enrollment not found.", 404, "ERR_NOT_FOUND");
  }

  const ipAddress = getClientIp(request);

  const result = await db.$transaction((tx) =>
    unenrollStudentsInTransaction(tx, {
      subjectId: id,
      enrollments: [enrollment],
      actorUserId: owner.data.user.id,
      ipAddress,
    })
  );

  return NextResponse.json({
    ok: true,
    ...result,
  });
}
