import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateSessionQrSecret,
  getTimeBucket,
  signAttendanceQrToken,
} from "@/lib/attendance/qr-token";

const getCurrentUserMock = vi.fn();
const ensureDeviceCookieMock = vi.fn();

const subjectFindUniqueMock = vi.fn();
const subjectEnrollmentFindUniqueMock = vi.fn();
const subjectEnrollmentFindManyMock = vi.fn();
const subjectEnrollmentUpdateMock = vi.fn();
const attendanceSessionFindUniqueMock = vi.fn();
const attendanceSessionFindFirstMock = vi.fn();
const attendanceSessionCreateMock = vi.fn();
const attendanceSessionUpdateManyMock = vi.fn();
const attendanceRecordFindUniqueMock = vi.fn();
const attendanceRecordFindFirstMock = vi.fn();
const attendanceRecordFindManyMock = vi.fn();
const attendanceRecordCreateMock = vi.fn();
const attendanceRecordCreateManyMock = vi.fn();
const attendanceRecordUpdateMock = vi.fn();
const pointLedgerCreateMock = vi.fn();
const auditLogCreateMock = vi.fn();
const auditLogFindManyMock = vi.fn();
const queryRawMock = vi.fn();

const txClient = {
  $queryRaw: queryRawMock,
  attendanceSession: {
    create: attendanceSessionCreateMock,
    updateMany: attendanceSessionUpdateManyMock,
    findUnique: attendanceSessionFindUniqueMock,
  },
  attendanceRecord: {
    findUnique: attendanceRecordFindUniqueMock,
    findFirst: attendanceRecordFindFirstMock,
    findMany: attendanceRecordFindManyMock,
    create: attendanceRecordCreateMock,
    createMany: attendanceRecordCreateManyMock,
    update: attendanceRecordUpdateMock,
  },
  subjectEnrollment: {
    findMany: subjectEnrollmentFindManyMock,
    update: subjectEnrollmentUpdateMock,
  },
  pointLedgerEntry: {
    create: pointLedgerCreateMock,
  },
  auditLog: {
    create: auditLogCreateMock,
  },
};

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock("@/lib/device/token", async () => {
  const actual = await vi.importActual<typeof import("@/lib/device/token")>(
    "@/lib/device/token"
  );
  return {
    ...actual,
    ensureDeviceCookie: ensureDeviceCookieMock,
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    subject: { findUnique: subjectFindUniqueMock },
    subjectEnrollment: {
      findUnique: subjectEnrollmentFindUniqueMock,
      findMany: subjectEnrollmentFindManyMock,
    },
    attendanceSession: {
      findUnique: attendanceSessionFindUniqueMock,
      findFirst: attendanceSessionFindFirstMock,
    },
    attendanceRecord: {
      findMany: attendanceRecordFindManyMock,
    },
    auditLog: {
      create: auditLogCreateMock,
      findMany: auditLogFindManyMock,
    },
    $transaction: async (cb: (tx: typeof txClient) => Promise<unknown>) =>
      cb(txClient),
  },
}));

const SUBJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const ENROLL_1_ID = "33333333-3333-4333-8333-333333333333";
const ENROLL_2_ID = "44444444-4444-4444-8444-444444444444";

describe("Phase 2 Attendance RBAC, Anti-Proxy Device Lock & Manual Override", () => {
  const qrSecret = generateSessionQrSecret();

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.AUTH_SECRET = "a".repeat(32);
    process.env.DEVICE_PEPPER = "b".repeat(32);
    process.env.P2P_QR_SECRET = "c".repeat(32);

    ensureDeviceCookieMock.mockResolvedValue({
      token: "55555555-5555-4555-8555-555555555555.sig",
      deviceId: "55555555-5555-4555-8555-555555555555",
    });
  });

  function buildOpenSession(overrides?: Record<string, unknown>) {
    const now = Date.now();
    return {
      id: SESSION_ID,
      subjectId: SUBJECT_ID,
      teacherId: "teacher-1",
      status: "OPEN",
      teacherLat: 14.5995,
      teacherLng: 120.9842,
      teacherAccuracyM: 10,
      radiusMeters: 50,
      qrSecret,
      qrRotationSeconds: 12,
      startedAt: new Date(now - 60_000),
      presentCutoffAt: new Date(now + 10 * 60_000),
      lateCutoffAt: new Date(now + 30 * 60_000),
      closedAt: null,
      presentPoints: 10,
      latePoints: 5,
      subject: {
        id: SUBJECT_ID,
        teacherId: "teacher-1",
        code: "CS 101",
        title: "Intro to Computing",
        section: "BSCS-1A",
        isArchived: false,
        allowNegativeBalance: false,
      },
      ...overrides,
    };
  }

  it("blocks STUDENT and non-owning TEACHER from teacher session endpoints", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: "student-1",
      email: "s1@classpulse.local",
      institutionalId: "2026-0001",
      fullName: "Student One",
      role: "STUDENT",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    const { POST: startSession } = await import(
      "@/app/api/subjects/[id]/sessions/route"
    );
    const startRes = await startSession(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherLat: 14.5995,
          teacherLng: 120.9842,
          teacherAccuracyM: 10,
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(startRes.status).toBe(403);

    const { GET: getLive } = await import(
      "@/app/api/sessions/[id]/live/route"
    );
    const liveRes = await getLive(
      new Request(`http://localhost/api/sessions/${SESSION_ID}/live`),
      { params: Promise.resolve({ id: SESSION_ID }) }
    );
    expect(liveRes.status).toBe(403);

    // Non-owning Teacher B
    getCurrentUserMock.mockResolvedValue({
      id: "teacher-2",
      email: "t2@classpulse.local",
      institutionalId: "EMP-2",
      fullName: "Teacher Two",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    attendanceSessionFindUniqueMock.mockResolvedValue(buildOpenSession());

    const { PATCH: overrideAttendance } = await import(
      "@/app/api/sessions/[id]/override/route"
    );
    const overrideRes = await overrideAttendance(
      new Request(`http://localhost/api/sessions/${SESSION_ID}/override`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollmentId: ENROLL_1_ID,
          status: "PRESENT",
          reason: "Test",
        }),
      }),
      { params: Promise.resolve({ id: SESSION_ID }) }
    );
    expect(overrideRes.status).toBe(403);
  });

  it("checks in an enrolled student within geofence, awards points, and creates a PointLedgerEntry", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: "student-1",
      email: "s1@classpulse.local",
      institutionalId: "2026-0001",
      fullName: "Student One",
      role: "STUDENT",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    const session = buildOpenSession();
    attendanceSessionFindUniqueMock.mockResolvedValue(session);
    subjectEnrollmentFindUniqueMock.mockResolvedValue({
      id: ENROLL_1_ID,
      subjectId: SUBJECT_ID,
      studentId: "student-1",
      availableBalance: 0,
      escrowedBalance: 0,
    });
    queryRawMock.mockResolvedValue([
      { id: ENROLL_1_ID, availableBalance: 0, escrowedBalance: 0 },
    ]);
    attendanceRecordFindUniqueMock.mockResolvedValue(null);
    attendanceRecordFindFirstMock.mockResolvedValue(null);
    attendanceRecordCreateMock.mockResolvedValue({
      id: "rec-1",
      sessionId: SESSION_ID,
      enrollmentId: ENROLL_1_ID,
      status: "PRESENT",
      checkInMethod: "QR_SCAN",
      distanceMeters: 0,
      pointsAwarded: 10,
      recordedAt: new Date(),
    });

    const bucket = getTimeBucket(Date.now(), session.qrRotationSeconds);
    const qrPayload = signAttendanceQrToken(SESSION_ID, qrSecret, bucket);

    const { POST: checkIn } = await import(
      "@/app/api/attendance/check-in/route"
    );
    const res = await checkIn(
      new Request("http://localhost/api/attendance/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qrPayload,
          studentLat: 14.5995,
          studentLng: 120.9842,
          studentAccuracyM: 12,
        }),
      })
    );

    expect(res.status).toBe(201);
    const json = (await res.json()) as {
      pointsAwarded: number;
      availableBalance: number;
      record: { status: string };
    };
    expect(json.record.status).toBe("PRESENT");
    expect(json.pointsAwarded).toBe(10);
    expect(json.availableBalance).toBe(10);

    expect(subjectEnrollmentUpdateMock).toHaveBeenCalledWith({
      where: { id: ENROLL_1_ID },
      data: { availableBalance: 10 },
    });
    expect(pointLedgerCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        enrollmentId: ENROLL_1_ID,
        subjectId: SUBJECT_ID,
        entryType: "ATTENDANCE",
        availableDelta: 10,
        availableAfter: 10,
      }),
    });
  });

  it("blocks a second student account scanning from the same deviceHash and persists an AuditLog anomaly", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: "student-2",
      email: "s2@classpulse.local",
      institutionalId: "2026-0002",
      fullName: "Student Two",
      role: "STUDENT",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    const session = buildOpenSession();
    attendanceSessionFindUniqueMock.mockResolvedValue(session);
    subjectEnrollmentFindUniqueMock.mockResolvedValue({
      id: ENROLL_2_ID,
      subjectId: SUBJECT_ID,
      studentId: "student-2",
      availableBalance: 0,
      escrowedBalance: 0,
    });
    queryRawMock.mockResolvedValue([
      { id: ENROLL_2_ID, availableBalance: 0, escrowedBalance: 0 },
    ]);
    attendanceRecordFindUniqueMock.mockResolvedValue(null);
    attendanceRecordFindFirstMock.mockResolvedValue({
      id: "rec-1",
      enrollmentId: ENROLL_1_ID,
    });

    const bucket = getTimeBucket(Date.now(), session.qrRotationSeconds);
    const qrPayload = signAttendanceQrToken(SESSION_ID, qrSecret, bucket);

    const { POST: checkIn } = await import(
      "@/app/api/attendance/check-in/route"
    );
    const res = await checkIn(
      new Request("http://localhost/api/attendance/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qrPayload,
          studentLat: 14.5995,
          studentLng: 120.9842,
          studentAccuracyM: 12,
        }),
      })
    );

    expect(res.status).toBe(409);
    const json = (await res.json()) as { code: string };
    expect(json.code).toBe("ERR_PROXY_DEVICE_CONFLICT");
    expect(attendanceRecordCreateMock).not.toHaveBeenCalled();
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorUserId: "student-2",
        subjectId: SUBJECT_ID,
        action: "ATTENDANCE_PROXY_BLOCKED",
        targetId: SESSION_ID,
      }),
    });
  });

  it("credits and reverses availableBalance and PointLedgerEntry on manual teacher overrides", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: "teacher-1",
      email: "t1@classpulse.local",
      institutionalId: "EMP-1",
      fullName: "Teacher One",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    const session = buildOpenSession();
    attendanceSessionFindUniqueMock.mockResolvedValue(session);
    subjectEnrollmentFindUniqueMock.mockResolvedValue({
      id: ENROLL_1_ID,
      subjectId: SUBJECT_ID,
      studentId: "student-1",
      availableBalance: 0,
      escrowedBalance: 0,
    });

    // Override 1: ABSENT (0) -> PRESENT (+10)
    queryRawMock.mockResolvedValueOnce([
      { id: ENROLL_1_ID, availableBalance: 0, escrowedBalance: 0 },
    ]);
    attendanceRecordFindUniqueMock.mockResolvedValueOnce({
      id: "rec-1",
      sessionId: SESSION_ID,
      enrollmentId: ENROLL_1_ID,
      status: "ABSENT",
      checkInMethod: "SYSTEM_CLOSE",
      pointsAwarded: 0,
    });
    attendanceRecordUpdateMock.mockResolvedValueOnce({
      id: "rec-1",
      status: "PRESENT",
      pointsAwarded: 10,
    });

    const { PATCH: overrideAttendance } = await import(
      "@/app/api/sessions/[id]/override/route"
    );

    const creditRes = await overrideAttendance(
      new Request(`http://localhost/api/sessions/${SESSION_ID}/override`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollmentId: ENROLL_1_ID,
          status: "PRESENT",
          reason: "Dead phone battery",
        }),
      }),
      { params: Promise.resolve({ id: SESSION_ID }) }
    );

    expect(creditRes.status).toBe(200);
    const creditJson = (await creditRes.json()) as {
      availableBalance: number;
      ledgerDelta: number;
    };
    expect(creditJson.availableBalance).toBe(10);
    expect(creditJson.ledgerDelta).toBe(10);

    // Override 2: Reverse PRESENT (+10) -> ABSENT (0)
    queryRawMock.mockResolvedValueOnce([
      { id: ENROLL_1_ID, availableBalance: 10, escrowedBalance: 0 },
    ]);
    attendanceRecordFindUniqueMock.mockResolvedValueOnce({
      id: "rec-1",
      sessionId: SESSION_ID,
      enrollmentId: ENROLL_1_ID,
      status: "PRESENT",
      checkInMethod: "QR_SCAN",
      pointsAwarded: 10,
    });
    attendanceRecordUpdateMock.mockResolvedValueOnce({
      id: "rec-1",
      status: "ABSENT",
      pointsAwarded: 0,
    });

    const reverseRes = await overrideAttendance(
      new Request(`http://localhost/api/sessions/${SESSION_ID}/override`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollmentId: ENROLL_1_ID,
          status: "ABSENT",
          reason: "Left class immediately after scan",
        }),
      }),
      { params: Promise.resolve({ id: SESSION_ID }) }
    );

    expect(reverseRes.status).toBe(200);
    const reverseJson = (await reverseRes.json()) as {
      availableBalance: number;
      ledgerDelta: number;
    };
    expect(reverseJson.availableBalance).toBe(0);
    expect(reverseJson.ledgerDelta).toBe(-10);

    expect(pointLedgerCreateMock).toHaveBeenLastCalledWith({
      data: expect.objectContaining({
        entryType: "ATTENDANCE_ADJUSTMENT",
        availableDelta: -10,
        availableAfter: 0,
      }),
    });
  });

  it("marks unchecked enrolled students ABSENT when closing an attendance session", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: "teacher-1",
      email: "t1@classpulse.local",
      institutionalId: "EMP-1",
      fullName: "Teacher One",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    const session = buildOpenSession();
    attendanceSessionFindUniqueMock
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce({ ...session, status: "CLOSED", closedAt: new Date() });
    attendanceSessionUpdateManyMock.mockResolvedValue({ count: 1 });
    subjectEnrollmentFindManyMock.mockResolvedValue([
      { id: ENROLL_1_ID },
      { id: ENROLL_2_ID },
    ]);
    attendanceRecordFindManyMock.mockResolvedValue([
      { enrollmentId: ENROLL_1_ID },
    ]);

    const { POST: closeSession } = await import(
      "@/app/api/sessions/[id]/close/route"
    );
    const res = await closeSession(
      new Request(`http://localhost/api/sessions/${SESSION_ID}/close`, {
        method: "POST",
      }),
      { params: Promise.resolve({ id: SESSION_ID }) }
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as { markedAbsentCount: number };
    expect(json.markedAbsentCount).toBe(1);
    expect(attendanceRecordCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          sessionId: SESSION_ID,
          enrollmentId: ENROLL_2_ID,
          status: "ABSENT",
          checkInMethod: "SYSTEM_CLOSE",
          deviceHash: null,
          pointsAwarded: 0,
        }),
      ],
      skipDuplicates: true,
    });
  });
});
