import { NextResponse } from "next/server";
import { getClientIp } from "@/lib/audit";
import { deleteStudentsInTransaction } from "@/lib/admin/delete-students";
import { jsonError, requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const roleCheck = await requireRole(["ADMIN"]);
  if (!roleCheck.ok) {
    return roleCheck.response;
  }

  const { id } = await context.params;
  if (!UUID_REGEX.test(id)) {
    return jsonError("Student account not found.", 404, "ERR_NOT_FOUND");
  }

  const student = await db.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      institutionalId: true,
      fullName: true,
      role: true,
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

  if (!student || student.role !== "STUDENT") {
    return jsonError("Student account not found.", 404, "ERR_NOT_FOUND");
  }

  const ipAddress = getClientIp(request);

  const result = await db.$transaction((tx) =>
    deleteStudentsInTransaction(tx, {
      students: [student],
      actorUserId: roleCheck.data.id,
      ipAddress,
    })
  );

  return NextResponse.json({
    ok: true,
    ...result,
  });
}
