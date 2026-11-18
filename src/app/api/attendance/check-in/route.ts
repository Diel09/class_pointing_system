import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { evaluateGeofence } from "@/lib/attendance/geofence";
import {
  parseAttendanceQrPayload,
  verifyAttendanceQrToken,
} from "@/lib/attendance/qr-token";
import { getPointsForAttendanceStatus } from "@/lib/attendance/session-dto";
import { jsonError, requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { computeDeviceHash, ensureDeviceCookie } from "@/lib/device/token";
import { getServerEnv } from "@/lib/env";
import { dispatchNotifications } from "@/lib/notifications/dispatch";
import { checkInSchema } from "@/lib/validations/attendance";

function isUniqueViolationOnField(
  error: unknown,
  fieldName: string
): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) {
    return false;
  }
  if (error.code !== "P2002") {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.includes(fieldName);
  }
  return typeof target === "string" && target.includes(fieldName);
}

export async function POST(request: Request) {
  const roleResult = await requireRole(["STUDENT"]);
  if (!roleResult.ok) {
    return roleResult.response;
  }
  const student = roleResult.data;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = checkInSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid check-in request.",
      400,
      "ERR_VALIDATION"
    );
  }

  const parsedQr = parseAttendanceQrPayload(parsed.data.qrPayload);
  if (!parsedQr) {
    return jsonError(
      "Invalid attendance QR code format.",
      400,
      "ERR_INVALID_QR"
    );
  }

  const session = await db.attendanceSession.findUnique({
    where: { id: parsedQr.sessionId },
    include: {
      subject: {
        select: { id: true, code: true, title: true, isArchived: true },
      },
    },
  });

  if (!session) {
    return jsonError(
      "Attendance session not found.",
      404,
      "ERR_SESSION_NOT_FOUND"
    );
  }

  if (session.status !== "OPEN") {
    return jsonError(
      "This attendance session has already closed.",
      409,
      "ERR_SESSION_CLOSED"
    );
  }

  const enrollment = await db.subjectEnrollment.findUnique({
    where: {
      subjectId_studentId: {
        subjectId: session.subjectId,
        studentId: student.id,
      },
    },
  });

  if (!enrollment) {
    return jsonError(
      "You are not enrolled in this subject.",
      403,
      "ERR_NOT_ENROLLED"
    );
  }

  const now = new Date();
  const qrCheck = verifyAttendanceQrToken({
    payload: parsed.data.qrPayload,
    sessionId: session.id,
    qrSecret: session.qrSecret,
    rotationSeconds: session.qrRotationSeconds,
    nowMs: now.getTime(),
  });

  if (!qrCheck.valid) {
    return jsonError(
      "QR code expired or invalid. Scan the live QR code on your teacher's screen.",
      401,
      "ERR_QR_EXPIRED_OR_INVALID"
    );
  }

  const geofence = evaluateGeofence({
    teacherLat: Number(session.teacherLat),
    teacherLng: Number(session.teacherLng),
    studentLat: parsed.data.studentLat,
    studentLng: parsed.data.studentLng,
    studentAccuracyM: parsed.data.studentAccuracyM,
    radiusMeters: session.radiusMeters,
  });

  if (!geofence.allowed) {
    return NextResponse.json(
      {
        error: geofence.message,
        code: geofence.code,
        distanceMeters: geofence.distanceMeters,
        effectiveRadiusMeters: geofence.effectiveRadiusMeters,
      },
      { status: geofence.code === "ERR_LOW_GPS_ACCURACY" ? 400 : 403 }
    );
  }

  if (now > session.lateCutoffAt) {
    return jsonError(
      "The late check-in window for this session has ended. Ask your teacher for a manual override.",
      409,
      "ERR_LATE_CUTOFF_PASSED"
    );
  }

  const attendanceStatus =
    now <= session.presentCutoffAt ? ("PRESENT" as const) : ("LATE" as const);
  const pointsAwarded = getPointsForAttendanceStatus(attendanceStatus, session);

  const env = getServerEnv();
  const { deviceId, token: deviceMirrorToken } = await ensureDeviceCookie(
    parsed.data.mirrorToken
  );
  const deviceHash = computeDeviceHash(deviceId, env.DEVICE_PEPPER);
  const ipAddress = getClientIp(request);

  type CheckInOutcome =
    | { ok: true; record: Record<string, unknown>; availableBalance: number }
    | { ok: false; reason: "ALREADY_CHECKED_IN" }
    | { ok: false; reason: "PROXY_DEVICE_CONFLICT"; existingEnrollmentId: string | null };

  let outcome: CheckInOutcome;

  try {
    outcome = await db.$transaction(async (tx): Promise<CheckInOutcome> => {
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

      const existingOwn = await tx.attendanceRecord.findUnique({
        where: {
          sessionId_enrollmentId: {
            sessionId: session.id,
            enrollmentId: enrollment.id,
          },
        },
        select: { id: true },
      });
      if (existingOwn) {
        return { ok: false, reason: "ALREADY_CHECKED_IN" };
      }

      const existingDevice = await tx.attendanceRecord.findFirst({
        where: {
          sessionId: session.id,
          deviceHash,
        },
        select: { id: true, enrollmentId: true },
      });
      if (existingDevice) {
        return {
          ok: false,
          reason: "PROXY_DEVICE_CONFLICT",
          existingEnrollmentId: existingDevice.enrollmentId,
        };
      }

      const newBalance = locked.availableBalance + pointsAwarded;

      const createdRecord = await tx.attendanceRecord.create({
        data: {
          sessionId: session.id,
          enrollmentId: enrollment.id,
          status: attendanceStatus,
          checkInMethod: "QR_SCAN",
          studentLat: parsed.data.studentLat,
          studentLng: parsed.data.studentLng,
          studentAccuracyM: parsed.data.studentAccuracyM,
          distanceMeters: geofence.distanceMeters,
          deviceHash,
          pointsAwarded,
          recordedAt: now,
        },
      });

      if (pointsAwarded !== 0) {
        await tx.subjectEnrollment.update({
          where: { id: enrollment.id },
          data: { availableBalance: newBalance },
        });
      }

      await tx.pointLedgerEntry.create({
        data: {
          enrollmentId: enrollment.id,
          subjectId: session.subjectId,
          entryType: "ATTENDANCE",
          availableDelta: pointsAwarded,
          escrowDelta: 0,
          availableAfter: newBalance,
          escrowAfter: locked.escrowedBalance,
          referenceType: "AttendanceSession",
          referenceId: session.id,
          note: `${attendanceStatus} check-in (${Math.round(geofence.distanceMeters)}m from anchor)`,
          actorUserId: student.id,
        },
      });

      await recordAuditLog(
        {
          actorUserId: student.id,
          subjectId: session.subjectId,
          action: "ATTENDANCE_CHECK_IN",
          targetType: "AttendanceRecord",
          targetId: createdRecord.id,
          afterState: {
            sessionId: session.id,
            status: attendanceStatus,
            pointsAwarded,
            distanceMeters: geofence.distanceMeters,
            availableBalance: newBalance,
          },
          ipAddress,
        },
        tx
      );

      return {
        ok: true,
        record: {
          id: createdRecord.id,
          sessionId: createdRecord.sessionId,
          status: createdRecord.status,
          checkInMethod: createdRecord.checkInMethod,
          distanceMeters: createdRecord.distanceMeters,
          pointsAwarded: createdRecord.pointsAwarded,
          recordedAt: createdRecord.recordedAt,
        },
        availableBalance: newBalance,
      };
    });
  } catch (error) {
    if (isUniqueViolationOnField(error, "deviceHash")) {
      outcome = {
        ok: false,
        reason: "PROXY_DEVICE_CONFLICT",
        existingEnrollmentId: null,
      };
    } else if (isUniqueViolationOnField(error, "enrollmentId")) {
      outcome = { ok: false, reason: "ALREADY_CHECKED_IN" };
    } else {
      throw error;
    }
  }

  if (!outcome.ok) {
    if (outcome.reason === "ALREADY_CHECKED_IN") {
      return jsonError(
        "You have already checked in for this attendance session.",
        409,
        "ERR_ALREADY_CHECKED_IN"
      );
    }

    // Persist anomaly audit log outside any rolled-back transaction.
    await recordAuditLog({
      actorUserId: student.id,
      subjectId: session.subjectId,
      action: "ATTENDANCE_PROXY_BLOCKED",
      targetType: "AttendanceSession",
      targetId: session.id,
      afterState: {
        attemptedStudentId: student.id,
        attemptedStudentName: student.fullName,
        existingEnrollmentId: outcome.existingEnrollmentId,
        distanceMeters: geofence.distanceMeters,
      },
      ipAddress,
    });

    return jsonError(
      "This device has already been used to check in another student for this session. Ask your teacher for a manual override if needed.",
      409,
      "ERR_PROXY_DEVICE_CONFLICT"
    );
  }

  await dispatchNotifications([
    {
      userId: student.id,
      subjectId: session.subjectId,
      type: "ATTENDANCE_CHECKIN",
      title: `Attendance Recorded (${session.subject.code})`,
      body: `Marked ${outcome.record.status} (+${pointsAwarded} pts).`,
      linkUrl: `/subjects/${session.subjectId}`,
    },
  ]);

  return NextResponse.json(
    {
      record: outcome.record,
      availableBalance: outcome.availableBalance,
      pointsAwarded,
      mirrorToken: deviceMirrorToken,
      subject: {
        id: session.subject.id,
        code: session.subject.code,
        title: session.subject.title,
      },
    },
    { status: 201 }
  );
}
