import type { AttendanceSession, AttendanceStatus } from "@prisma/client";

export interface PublicAttendanceSessionDto {
  id: string;
  subjectId: string;
  teacherId: string;
  status: AttendanceSession["status"];
  radiusMeters: number;
  qrRotationSeconds: number;
  startedAt: Date;
  presentCutoffAt: Date;
  lateCutoffAt: Date;
  closedAt: Date | null;
  presentPoints: number;
  latePoints: number;
  teacherLat?: number;
  teacherLng?: number;
  teacherAccuracyM?: number;
}

/**
 * Strips the server-only qrSecret before serializing an AttendanceSession to any client.
 */
export function toPublicSessionDto(
  session: AttendanceSession,
  includeTeacherLocation: boolean
): PublicAttendanceSessionDto {
  return {
    id: session.id,
    subjectId: session.subjectId,
    teacherId: session.teacherId,
    status: session.status,
    radiusMeters: session.radiusMeters,
    qrRotationSeconds: session.qrRotationSeconds,
    startedAt: session.startedAt,
    presentCutoffAt: session.presentCutoffAt,
    lateCutoffAt: session.lateCutoffAt,
    closedAt: session.closedAt,
    presentPoints: session.presentPoints,
    latePoints: session.latePoints,
    ...(includeTeacherLocation
      ? {
          teacherLat: Number(session.teacherLat),
          teacherLng: Number(session.teacherLng),
          teacherAccuracyM: session.teacherAccuracyM,
        }
      : {}),
  };
}

/**
 * Maps an attendance status to the configured point award for a session.
 */
export function getPointsForAttendanceStatus(
  status: AttendanceStatus,
  session: Pick<AttendanceSession, "presentPoints" | "latePoints">
): number {
  if (status === "PRESENT") return session.presentPoints;
  if (status === "LATE") return session.latePoints;
  return 0;
}
