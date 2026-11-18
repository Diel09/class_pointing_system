import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/audit";
import { jsonError, requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { deleteSubjectsInTransaction } from "@/lib/subjects/delete-subjects";
import { bulkDeleteSubjectsSchema } from "@/lib/validations/subject";

export async function POST(request: Request) {
  const roleCheck = await requireRole(["TEACHER", "ADMIN"]);
  if (!roleCheck.ok) {
    return roleCheck.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = bulkDeleteSubjectsSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid bulk delete payload.",
      400,
      "ERR_VALIDATION"
    );
  }

  const uniqueIds = Array.from(new Set(parsed.data.subjectIds));
  const subjects = await db.subject.findMany({
    where: { id: { in: uniqueIds } },
    select: {
      id: true,
      teacherId: true,
      code: true,
      title: true,
      section: true,
      termId: true,
      isArchived: true,
      startDate: true,
      endDate: true,
      enrollments: {
        select: {
          id: true,
          studentId: true,
          availableBalance: true,
          escrowedBalance: true,
        },
      },
    },
  });

  if (subjects.length !== uniqueIds.length) {
    return jsonError(
      "One or more selected sections were not found.",
      404,
      "ERR_NOT_FOUND"
    );
  }

  if (roleCheck.data.role === "TEACHER") {
    const unauthorized = subjects.some(
      (s) => s.teacherId !== roleCheck.data.id
    );
    if (unauthorized) {
      return jsonError(
        "You can only delete sections you own.",
        403,
        "ERR_SUBJECT_FORBIDDEN"
      );
    }
  }

  const ipAddress = getClientIp(request);

  const result = await db.$transaction((tx) =>
    deleteSubjectsInTransaction(tx, {
      subjects,
      actorUserId: roleCheck.data.id,
      ipAddress,
    })
  );

  return NextResponse.json({
    ok: true,
    ...result,
  });
}
