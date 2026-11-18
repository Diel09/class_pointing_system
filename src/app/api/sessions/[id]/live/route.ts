import { NextResponse } from "next/server";
import {
  getTimeBucket,
  signAttendanceQrToken,
} from "@/lib/attendance/qr-token";
import { toPublicSessionDto } from "@/lib/attendance/session-dto";
import { requireTeacherSessionOwner } from "@/lib/auth/guards";
import { db } from "@/lib/db";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const owner = await requireTeacherSessionOwner(id);
  if (!owner.ok) {
    return owner.response;
  }

  const { session, subject } = owner.data;
  const nowMs = Date.now();
  const bucket = getTimeBucket(nowMs, session.qrRotationSeconds);
  const nextBucketAtMs = (bucket + 1) * session.qrRotationSeconds * 1000;

  const qr =
    session.status === "OPEN"
      ? {
          payload: signAttendanceQrToken(session.id, session.qrSecret, bucket),
          bucket,
          rotationSeconds: session.qrRotationSeconds,
          nextRotationAt: new Date(nextBucketAtMs).toISOString(),
          remainingMs: Math.max(0, nextBucketAtMs - nowMs),
        }
      : null;

  const [enrollments, records, anomalies] = await Promise.all([
    db.subjectEnrollment.findMany({
      where: { subjectId: session.subjectId },
      orderBy: { student: { fullName: "asc" } },
      select: {
        id: true,
        availableBalance: true,
        student: {
          select: {
            id: true,
            fullName: true,
            email: true,
            institutionalId: true,
          },
        },
      },
    }),
    db.attendanceRecord.findMany({
      where: { sessionId: session.id },
    }),
    db.auditLog.findMany({
      where: {
        subjectId: session.subjectId,
        targetId: session.id,
        action: "ATTENDANCE_PROXY_BLOCKED",
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        actorUserId: true,
        afterState: true,
        createdAt: true,
      },
    }),
  ]);

  const recordMap = new Map(records.map((r) => [r.enrollmentId, r]));

  const roster = enrollments.map((enrollment) => {
    const rec = recordMap.get(enrollment.id) ?? null;
    return {
      enrollmentId: enrollment.id,
      availableBalance: enrollment.availableBalance,
      student: enrollment.student,
      record: rec
        ? {
            id: rec.id,
            status: rec.status,
            checkInMethod: rec.checkInMethod,
            distanceMeters: rec.distanceMeters,
            studentAccuracyM: rec.studentAccuracyM,
            pointsAwarded: rec.pointsAwarded,
            overrideReason: rec.overrideReason,
            recordedAt: rec.recordedAt,
          }
        : null,
    };
  });

  return NextResponse.json({
    subject: {
      id: subject.id,
      code: subject.code,
      title: subject.title,
      section: subject.section,
    },
    session: toPublicSessionDto(session, true),
    qr,
    roster,
    anomalies,
    serverTime: new Date(nowMs).toISOString(),
  });
}
