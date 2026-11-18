import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/audit";
import { deleteStudentsInTransaction } from "@/lib/admin/delete-students";
import { jsonError, requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { bulkDeleteStudentsSchema } from "@/lib/validations/auth";

export async function POST(request: Request) {
  const roleCheck = await requireRole(["ADMIN"]);
  if (!roleCheck.ok) {
    return roleCheck.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = bulkDeleteStudentsSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid bulk delete payload.",
      400,
      "ERR_VALIDATION"
    );
  }

  const uniqueIds = Array.from(new Set(parsed.data.studentIds));
  const students = await db.user.findMany({
    where: { id: { in: uniqueIds }, role: "STUDENT" },
    select: {
      id: true,
      email: true,
      institutionalId: true,
      fullName: true,
      status: true,
      enrollments: {
        select: {
          id: true,
          subjectId: true,
          availableBalance: true,
          escrowedBalance: true,
        },
      },
    },
  });

  if (students.length !== uniqueIds.length) {
    return jsonError(
      "One or more selected student accounts were not found.",
      404,
      "ERR_NOT_FOUND"
    );
  }

  const ipAddress = getClientIp(request);

  const result = await db.$transaction((tx) =>
    deleteStudentsInTransaction(tx, {
      students,
      actorUserId: roleCheck.data.id,
      ipAddress,
    })
  );

  return NextResponse.json({
    ok: true,
    ...result,
  });
}
