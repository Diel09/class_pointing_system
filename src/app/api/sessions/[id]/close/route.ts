import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { toPublicSessionDto } from "@/lib/attendance/session-dto";
import { jsonError, requireTeacherSessionOwner } from "@/lib/auth/guards";
import { db } from "@/lib/db";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const owner = await requireTeacherSessionOwner(id);
  if (!owner.ok) {
    return owner.response;
  }

  const { session, user } = owner.data;
  if (session.status === "CLOSED") {
    return jsonError(
      "Attendance session is already closed.",
      409,
      "ERR_SESSION_CLOSED"
    );
  }

  const closedAt = new Date();
  const ipAddress = getClientIp(request);

  const result = await db.$transaction(async (tx) => {
    const updatedCount = await tx.attendanceSession.updateMany({
      where: { id: session.id, status: "OPEN" },
      data: { status: "CLOSED", closedAt },
    });

    if (updatedCount.count === 0) {
      return null;
    }

    const [enrollments, existingRecords] = await Promise.all([
      tx.subjectEnrollment.findMany({
        where: { subjectId: session.subjectId },
        select: { id: true },
      }),
      tx.attendanceRecord.findMany({
        where: { sessionId: session.id },
        select: { enrollmentId: true },
      }),
    ]);

    const recordedIds = new Set(existingRecords.map((r) => r.enrollmentId));
    const missingEnrollmentIds = enrollments
      .map((e) => e.id)
      .filter((eid) => !recordedIds.has(eid));

    if (missingEnrollmentIds.length > 0) {
      await tx.attendanceRecord.createMany({
        data: missingEnrollmentIds.map((enrollmentId) => ({
          sessionId: session.id,
          enrollmentId,
          status: "ABSENT",
          checkInMethod: "SYSTEM_CLOSE",
          deviceHash: null,
          pointsAwarded: 0,
          recordedAt: closedAt,
        })),
        skipDuplicates: true,
      });
    }

    const closedSession = await tx.attendanceSession.findUnique({
      where: { id: session.id },
    });

    await recordAuditLog(
      {
        actorUserId: user.id,
        subjectId: session.subjectId,
        action: "ATTENDANCE_SESSION_CLOSED",
        targetType: "AttendanceSession",
        targetId: session.id,
        afterState: {
          closedAt: closedAt.toISOString(),
          markedAbsentCount: missingEnrollmentIds.length,
        },
        ipAddress,
      },
      tx
    );

    return {
      session: closedSession ?? { ...session, status: "CLOSED" as const, closedAt },
      markedAbsentCount: missingEnrollmentIds.length,
    };
  });

  if (!result) {
    return jsonError(
      "Attendance session is already closed.",
      409,
      "ERR_SESSION_CLOSED"
    );
  }

  return NextResponse.json({
    session: toPublicSessionDto(result.session, true),
    markedAbsentCount: result.markedAbsentCount,
  });
}
