import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/audit";
import { jsonError, requireTeacherSubjectOwner } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { unenrollStudentsInTransaction } from "@/lib/subjects/unenroll-students";
import { bulkUnenrollRosterSchema } from "@/lib/validations/subject";

export async function POST(
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

  const parsed = bulkUnenrollRosterSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid bulk unenroll payload.",
      400,
      "ERR_VALIDATION"
    );
  }

  const uniqueIds = Array.from(new Set(parsed.data.enrollmentIds));
  const enrollments = await db.subjectEnrollment.findMany({
    where: {
      id: { in: uniqueIds },
      subjectId: id,
    },
    select: {
      id: true,
      studentId: true,
      availableBalance: true,
      escrowedBalance: true,
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

  if (enrollments.length !== uniqueIds.length) {
    return jsonError(
      "One or more selected enrollments were not found in this subject.",
      404,
      "ERR_NOT_FOUND"
    );
  }

  const ipAddress = getClientIp(request);

  const result = await db.$transaction((tx) =>
    unenrollStudentsInTransaction(tx, {
      subjectId: id,
      enrollments,
      actorUserId: owner.data.user.id,
      ipAddress,
    })
  );

  return NextResponse.json({
    ok: true,
    ...result,
  });
}
