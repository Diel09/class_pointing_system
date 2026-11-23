import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { generateSessionQrSecret } from "@/lib/attendance/qr-token";
import { toPublicSessionDto } from "@/lib/attendance/session-dto";
import {
  jsonError,
  requireSubjectInstructor,
  requireSubjectMember,
} from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { createSessionSchema } from "@/lib/validations/attendance";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const member = await requireSubjectMember(id);
  if (!member.ok) {
    return member.response;
  }

  const isStudent = member.data.user.role === "STUDENT";

  if (isStudent) {
    const sessions = await db.attendanceSession.findMany({
      where: { subjectId: id },
      orderBy: { startedAt: "desc" },
      take: 30,
      include: {
        records: {
          where: { enrollmentId: member.data.enrollment?.id ?? "" },
          take: 1,
        },
      },
    });

    const formatted = sessions.map((session) => {
      const record = session.records[0] ?? null;
      return {
        ...toPublicSessionDto(session, false),
        myRecord: record
          ? {
              id: record.id,
              status: record.status,
              checkInMethod: record.checkInMethod,
              distanceMeters: record.distanceMeters,
              pointsAwarded: record.pointsAwarded,
              overrideReason: record.overrideReason,
              recordedAt: record.recordedAt,
            }
          : null,
      };
    });

    return NextResponse.json({
      pointsEnabled: member.data.subject.pointsEnabled,
      sessions: formatted,
      openSessionId:
        sessions.find((session) => session.status === "OPEN")?.id ?? null,
    });
  }

  const sessions = await db.attendanceSession.findMany({
    where: { subjectId: id },
    orderBy: { startedAt: "desc" },
    take: 30,
    include: {
      records: {
        select: { status: true },
      },
    },
  });

  const formatted = sessions.map((session) => {
    const counts = { PRESENT: 0, LATE: 0, EXCUSED: 0, ABSENT: 0 };
    for (const r of session.records) {
      counts[r.status] += 1;
    }
    return {
      ...toPublicSessionDto(session, true),
      counts,
    };
  });

  return NextResponse.json({
    pointsEnabled: member.data.subject.pointsEnabled,
    sessions: formatted,
    openSessionId:
      sessions.find((session) => session.status === "OPEN")?.id ?? null,
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const owner = await requireSubjectInstructor(id);
  if (!owner.ok) {
    return owner.response;
  }

  if (owner.data.subject.isArchived) {
    return jsonError(
      "Cannot start an attendance session on an archived subject.",
      400,
      "ERR_SUBJECT_ARCHIVED"
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = createSessionSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid attendance session payload.",
      400,
      "ERR_VALIDATION"
    );
  }

  const existingOpen = await db.attendanceSession.findFirst({
    where: { subjectId: id, status: "OPEN" },
    select: { id: true },
  });
  if (existingOpen) {
    return jsonError(
      "An attendance session is already open for this subject. Close it before starting a new one.",
      409,
      "ERR_SESSION_ALREADY_OPEN"
    );
  }

  const now = new Date();
  const presentCutoffAt = new Date(
    now.getTime() + parsed.data.presentWindowMinutes * 60_000
  );
  const lateCutoffAt = new Date(
    presentCutoffAt.getTime() + parsed.data.lateWindowMinutes * 60_000
  );
  const qrSecret = generateSessionQrSecret();
  const ipAddress = getClientIp(request);
  const pointsEnabled = owner.data.subject.pointsEnabled !== false;
  const presentPoints = pointsEnabled ? parsed.data.presentPoints : 0;
  const latePoints = pointsEnabled ? parsed.data.latePoints : 0;

  const session = await db.$transaction(async (tx) => {
    const created = await tx.attendanceSession.create({
      data: {
        subjectId: id,
        teacherId: owner.data.user.id,
        status: "OPEN",
        teacherLat: parsed.data.teacherLat,
        teacherLng: parsed.data.teacherLng,
        teacherAccuracyM: parsed.data.teacherAccuracyM,
        radiusMeters: parsed.data.radiusMeters,
        qrSecret,
        qrRotationSeconds: parsed.data.qrRotationSeconds,
        startedAt: now,
        presentCutoffAt,
        lateCutoffAt,
        presentPoints,
        latePoints,
      },
    });

    await recordAuditLog(
      {
        actorUserId: owner.data.user.id,
        subjectId: id,
        action: "ATTENDANCE_SESSION_STARTED",
        targetType: "AttendanceSession",
        targetId: created.id,
        afterState: {
          radiusMeters: created.radiusMeters,
          qrRotationSeconds: created.qrRotationSeconds,
          presentPoints: created.presentPoints,
          latePoints: created.latePoints,
          presentCutoffAt: created.presentCutoffAt.toISOString(),
          lateCutoffAt: created.lateCutoffAt.toISOString(),
        },
        ipAddress,
      },
      tx
    );

    return created;
  });

  return NextResponse.json(
    { session: toPublicSessionDto(session, true) },
    { status: 201 }
  );
}
