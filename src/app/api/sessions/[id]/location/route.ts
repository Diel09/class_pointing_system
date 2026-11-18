import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { toPublicSessionDto } from "@/lib/attendance/session-dto";
import { jsonError, requireTeacherSessionOwner } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { updateSessionLocationSchema } from "@/lib/validations/attendance";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const owner = await requireTeacherSessionOwner(id);
  if (!owner.ok) {
    return owner.response;
  }

  const { session, user } = owner.data;
  if (session.status !== "OPEN") {
    return jsonError(
      "Cannot refresh location on a closed attendance session.",
      409,
      "ERR_SESSION_CLOSED"
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = updateSessionLocationSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid GPS coordinates.",
      400,
      "ERR_VALIDATION"
    );
  }

  const ipAddress = getClientIp(request);

  const updated = await db.$transaction(async (tx) => {
    const next = await tx.attendanceSession.update({
      where: { id: session.id },
      data: {
        teacherLat: parsed.data.teacherLat,
        teacherLng: parsed.data.teacherLng,
        teacherAccuracyM: parsed.data.teacherAccuracyM,
      },
    });

    await recordAuditLog(
      {
        actorUserId: user.id,
        subjectId: session.subjectId,
        action: "ATTENDANCE_LOCATION_REFRESHED",
        targetType: "AttendanceSession",
        targetId: session.id,
        beforeState: {
          teacherLat: Number(session.teacherLat),
          teacherLng: Number(session.teacherLng),
          teacherAccuracyM: session.teacherAccuracyM,
        },
        afterState: {
          teacherLat: parsed.data.teacherLat,
          teacherLng: parsed.data.teacherLng,
          teacherAccuracyM: parsed.data.teacherAccuracyM,
        },
        ipAddress,
      },
      tx
    );

    return next;
  });

  return NextResponse.json({ session: toPublicSessionDto(updated, true) });
}
