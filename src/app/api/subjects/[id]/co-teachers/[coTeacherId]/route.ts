import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError, requireTeacherSubjectOwner } from "@/lib/auth/guards";
import { db } from "@/lib/db";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; coTeacherId: string }> }
) {
  const { id, coTeacherId } = await context.params;
  const owner = await requireTeacherSubjectOwner(id);
  if (!owner.ok) {
    return owner.response;
  }

  if (!UUID_REGEX.test(coTeacherId)) {
    return jsonError("Co-teacher assignment not found.", 404, "ERR_NOT_FOUND");
  }

  const assignment = await db.subjectCoTeacher.findUnique({
    where: { id: coTeacherId },
    include: {
      teacher: {
        select: {
          id: true,
          fullName: true,
          email: true,
          institutionalId: true,
        },
      },
    },
  });

  if (!assignment || assignment.subjectId !== id) {
    return jsonError("Co-teacher assignment not found.", 404, "ERR_NOT_FOUND");
  }

  const ipAddress = getClientIp(request);

  await db.$transaction(async (tx) => {
    await tx.subjectCoTeacher.delete({
      where: { id: coTeacherId },
    });

    await recordAuditLog(
      {
        actorUserId: owner.data.user.id,
        subjectId: id,
        action: "CO_TEACHER_REMOVED",
        targetType: "SubjectCoTeacher",
        targetId: coTeacherId,
        beforeState: {
          teacherId: assignment.teacher.id,
          fullName: assignment.teacher.fullName,
          email: assignment.teacher.email,
        },
        ipAddress,
      },
      tx
    );
  });

  return NextResponse.json({ ok: true });
}
