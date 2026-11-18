import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { getPointsForAttendanceStatus } from "@/lib/attendance/session-dto";
import { jsonError, requireTeacherSessionOwner } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { dispatchNotifications } from "@/lib/notifications/dispatch";
import { overrideAttendanceSchema } from "@/lib/validations/attendance";

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const owner = await requireTeacherSessionOwner(id);
  if (!owner.ok) {
    return owner.response;
  }

  const { session, subject, user } = owner.data;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = overrideAttendanceSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid attendance override payload.",
      400,
      "ERR_VALIDATION"
    );
  }

  const enrollment = await db.subjectEnrollment.findUnique({
    where: { id: parsed.data.enrollmentId },
  });
  if (!enrollment || enrollment.subjectId !== session.subjectId) {
    return jsonError(
      "Student is not enrolled in this subject.",
      404,
      "ERR_ENROLLMENT_NOT_FOUND"
    );
  }

  const targetPoints = getPointsForAttendanceStatus(parsed.data.status, session);
  const ipAddress = getClientIp(request);

  const result = await db.$transaction(async (tx) => {
    const lockedRows = await tx.$queryRaw<
      { id: string; availableBalance: number; escrowedBalance: number }[]
    >`
      SELECT id, "availableBalance", "escrowedBalance"
      FROM "SubjectEnrollment"
      WHERE id = ${enrollment.id}::uuid
      FOR UPDATE
    `;
    const locked = lockedRows[0];
    if (!locked) {
      throw new Error("ENROLLMENT_NOT_FOUND");
    }

    const existingRecord = await tx.attendanceRecord.findUnique({
      where: {
        sessionId_enrollmentId: {
          sessionId: session.id,
          enrollmentId: enrollment.id,
        },
      },
    });

    const previousStatus = existingRecord?.status ?? "UNRECORDED";
    const previousPoints = existingRecord?.pointsAwarded ?? 0;
    const rawDelta = targetPoints - previousPoints;

    const newBalance = subject.allowNegativeBalance
      ? locked.availableBalance + rawDelta
      : Math.max(0, locked.availableBalance + rawDelta);
    const actualDelta = newBalance - locked.availableBalance;

    const record = existingRecord
      ? await tx.attendanceRecord.update({
          where: { id: existingRecord.id },
          data: {
            status: parsed.data.status,
            // Preserve QR_SCAN + deviceHash if already scanned so anti-proxy device lock holds for the session.
            checkInMethod:
              existingRecord.checkInMethod === "QR_SCAN"
                ? "QR_SCAN"
                : "TEACHER_OVERRIDE",
            pointsAwarded: targetPoints,
            overriddenByTeacherId: user.id,
            overrideReason: parsed.data.reason,
          },
        })
      : await tx.attendanceRecord.create({
          data: {
            sessionId: session.id,
            enrollmentId: enrollment.id,
            status: parsed.data.status,
            checkInMethod: "TEACHER_OVERRIDE",
            deviceHash: null,
            pointsAwarded: targetPoints,
            overriddenByTeacherId: user.id,
            overrideReason: parsed.data.reason,
          },
        });

    if (actualDelta !== 0) {
      await tx.subjectEnrollment.update({
        where: { id: enrollment.id },
        data: { availableBalance: newBalance },
      });

      await tx.pointLedgerEntry.create({
        data: {
          enrollmentId: enrollment.id,
          subjectId: session.subjectId,
          entryType: "ATTENDANCE_ADJUSTMENT",
          availableDelta: actualDelta,
          escrowDelta: 0,
          availableAfter: newBalance,
          escrowAfter: locked.escrowedBalance,
          referenceType: "AttendanceSession",
          referenceId: session.id,
          note: `Manual override (${previousStatus} -> ${parsed.data.status}): ${parsed.data.reason}`,
          actorUserId: user.id,
        },
      });
    }

    await recordAuditLog(
      {
        actorUserId: user.id,
        subjectId: session.subjectId,
        action: "ATTENDANCE_OVERRIDE",
        targetType: "AttendanceRecord",
        targetId: record.id,
        beforeState: existingRecord
          ? {
              status: existingRecord.status,
              pointsAwarded: existingRecord.pointsAwarded,
              availableBalance: locked.availableBalance,
            }
          : {
              status: null,
              pointsAwarded: 0,
              availableBalance: locked.availableBalance,
            },
        afterState: {
          status: record.status,
          pointsAwarded: record.pointsAwarded,
          availableBalance: newBalance,
          ledgerDelta: actualDelta,
          reason: parsed.data.reason,
        },
        ipAddress,
      },
      tx
    );

    return {
      record,
      availableBalance: newBalance,
      ledgerDelta: actualDelta,
    };
  });

  await dispatchNotifications([
    {
      userId: enrollment.studentId,
      subjectId: session.subjectId,
      type: "ATTENDANCE_OVERRIDE",
      title: `Attendance Updated (${subject.code})`,
      body: `Your teacher marked your attendance ${result.record.status}${
        result.ledgerDelta !== 0
          ? ` (${result.ledgerDelta > 0 ? `+${result.ledgerDelta}` : result.ledgerDelta} pts)`
          : ""
      }. Reason: ${parsed.data.reason}`,
      linkUrl: `/subjects/${session.subjectId}`,
    },
  ]);

  return NextResponse.json(result);
}
