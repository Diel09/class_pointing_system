import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  generateSessionQrSecret,
  getTimeBucket,
  signAttendanceQrToken,
} from "@/lib/attendance/qr-token";
import { signP2pQrPayload } from "@/lib/points/p2p-qr";

const getCurrentUserMock = vi.fn();
const ensureDeviceCookieMock = vi.fn();

const subjectFindUniqueMock = vi.fn();
const subjectUpdateMock = vi.fn();
const subjectEnrollmentFindUniqueMock = vi.fn();
const subjectEnrollmentFindManyMock = vi.fn();
const subjectEnrollmentUpdateMock = vi.fn();
const academicTermFindUniqueMock = vi.fn();
const attendanceSessionFindUniqueMock = vi.fn();
const attendanceSessionFindFirstMock = vi.fn();
const attendanceSessionCreateMock = vi.fn();
const attendanceRecordFindUniqueMock = vi.fn();
const attendanceRecordFindFirstMock = vi.fn();
const attendanceRecordFindManyMock = vi.fn();
const attendanceRecordCreateMock = vi.fn();
const attendanceRecordUpdateMock = vi.fn();
const meritPresetFindUniqueMock = vi.fn();
const meritPresetCreateMock = vi.fn();
const meritPresetUpdateMock = vi.fn();
const rewardItemFindUniqueMock = vi.fn();
const rewardItemCreateMock = vi.fn();
const rewardItemUpdateMock = vi.fn();
const redemptionUpdateMock = vi.fn();
const gradeCategoryFindManyMock = vi.fn();
const gradeScaleRuleFindManyMock = vi.fn();
const assessmentFindManyMock = vi.fn();
const assessmentScoreFindManyMock = vi.fn();
const pointLedgerCountMock = vi.fn();
const pointLedgerGroupByMock = vi.fn();
const pointLedgerCreateMock = vi.fn();
const auditLogCreateMock = vi.fn();
const queryRawMock = vi.fn();

const txClient = {
  $queryRaw: queryRawMock,
  subject: {
    findUnique: subjectFindUniqueMock,
    update: subjectUpdateMock,
  },
  subjectEnrollment: {
    update: subjectEnrollmentUpdateMock,
  },
  attendanceSession: {
    create: attendanceSessionCreateMock,
  },
  attendanceRecord: {
    findUnique: attendanceRecordFindUniqueMock,
    findFirst: attendanceRecordFindFirstMock,
    create: attendanceRecordCreateMock,
    update: attendanceRecordUpdateMock,
  },
  meritPreset: {
    create: meritPresetCreateMock,
    update: meritPresetUpdateMock,
  },
  rewardItem: {
    findUnique: rewardItemFindUniqueMock,
    create: rewardItemCreateMock,
    update: rewardItemUpdateMock,
  },
  redemptionRequest: {
    update: redemptionUpdateMock,
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
    academicTerm: { findUnique: academicTermFindUniqueMock },
    attendanceSession: {
      findUnique: attendanceSessionFindUniqueMock,
      findFirst: attendanceSessionFindFirstMock,
    },
    attendanceRecord: {
      findMany: attendanceRecordFindManyMock,
    },
    meritPreset: { findUnique: meritPresetFindUniqueMock },
    rewardItem: { findUnique: rewardItemFindUniqueMock },
    gradeCategory: { findMany: gradeCategoryFindManyMock },
    gradeScaleRule: { findMany: gradeScaleRuleFindManyMock },
    assessment: { findMany: assessmentFindManyMock },
    assessmentScore: { findMany: assessmentScoreFindManyMock },
    pointLedgerEntry: {
      count: pointLedgerCountMock,
      groupBy: pointLedgerGroupByMock,
    },
    auditLog: { create: auditLogCreateMock },
    $transaction: async (cb: (tx: typeof txClient) => Promise<unknown>) =>
      cb(txClient),
  },
}));

const SUBJECT_ID = "11111111-1111-4111-8111-111111111111";
const SESSION_ID = "22222222-2222-4222-8222-222222222222";
const ENROLL_1 = "33333333-3333-4333-8333-333333333331";
const ENROLL_2 = "33333333-3333-4333-8333-333333333332";
const PRESET_ID = "44444444-4444-4444-8444-444444444444";
const REWARD_ID = "55555555-5555-4555-8555-555555555555";
const REDEMPTION_ID = "66666666-6666-4666-8666-666666666666";
const CAT_ASSESS_ID = "77777777-7777-4777-8777-777777777771";
const CAT_POINTS_ID = "77777777-7777-4777-8777-777777777772";

function teacherUser() {
  return {
    id: "teacher-1",
    email: "t1@classpulse.local",
    institutionalId: "EMP-1",
    fullName: "Teacher One",
    role: "TEACHER" as const,
    status: "ACTIVE" as const,
    sessionVersion: 1,
  };
}

function studentUser() {
  return {
    id: "student-1",
    email: "s1@classpulse.local",
    institutionalId: "2026-0001",
    fullName: "Student One",
    role: "STUDENT" as const,
    status: "ACTIVE" as const,
    sessionVersion: 1,
  };
}

function buildSubject(overrides?: Record<string, unknown>) {
  return {
    id: SUBJECT_ID,
    teacherId: "teacher-1",
    termId: "term-1",
    code: "CS 101",
    title: "Introduction to Computing",
    section: "BSCS-1A",
    startDate: null,
    endDate: null,
    inviteCode: "CS101SEC",
    isArchived: false,
    pointsEnabled: false,
    allowNegativeBalance: false,
    allowP2pTransfers: true,
    p2pMaxPerTransfer: null,
    p2pMaxPerDay: null,
    p2pMaxPerTerm: null,
    allowOpenRedemptions: true,
    standingVisible: true,
    requireGapFreeGradeScale: true,
    lateAttendanceCreditPct: 50,
    termSplitConfig: null,
    ...overrides,
  };
}

describe("Per-section Points & Economy toggle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.AUTH_SECRET = "a".repeat(32);
    process.env.DEVICE_PEPPER = "b".repeat(32);
    process.env.P2P_QR_SECRET = "c".repeat(32);
    ensureDeviceCookieMock.mockResolvedValue({
      token: "88888888-8888-4888-8888-888888888888.sig",
      deviceId: "88888888-8888-4888-8888-888888888888",
    });
  });

  it("allows the owning teacher to toggle pointsEnabled via PATCH /api/subjects/[id] with audit logging", async () => {
    getCurrentUserMock.mockResolvedValue(teacherUser());
    subjectFindUniqueMock.mockResolvedValue(buildSubject({ pointsEnabled: true }));
    subjectUpdateMock.mockResolvedValue({
      ...buildSubject({ pointsEnabled: false }),
      term: { id: "term-1", name: "1st Sem", isActive: true },
      _count: { enrollments: 5 },
    });

    const { PATCH: updateSubject } = await import(
      "@/app/api/subjects/[id]/route"
    );
    const res = await updateSubject(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pointsEnabled: false }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );

    expect(res.status).toBe(200);
    expect(subjectUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: SUBJECT_ID },
        data: expect.objectContaining({ pointsEnabled: false }),
      })
    );
    expect(auditLogCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: "SUBJECT_UPDATED",
        beforeState: expect.objectContaining({ pointsEnabled: true }),
        afterState: expect.objectContaining({ pointsEnabled: false }),
      }),
    });
  });

  it("blocks merits, presets, rewards, redemptions, and P2P endpoints with ERR_POINTS_DISABLED when pointsEnabled is false", async () => {
    getCurrentUserMock.mockResolvedValue(teacherUser());
    subjectFindUniqueMock.mockResolvedValue(buildSubject({ pointsEnabled: false }));
    meritPresetFindUniqueMock.mockResolvedValue({
      id: PRESET_ID,
      subjectId: SUBJECT_ID,
      name: "Recitation",
      type: "MERIT",
      pointsDelta: 5,
      description: null,
      isArchived: false,
    });
    rewardItemFindUniqueMock.mockResolvedValue({
      id: REWARD_ID,
      subjectId: SUBJECT_ID,
      name: "Quiz Boost",
      rewardType: "SCORE_BOOST",
      pointCostPerUnit: 10,
      scoreValuePerUnit: 1,
      eligibleCategoryIds: [],
      allowExtraCredit: false,
      maxBoostPerAssessment: null,
      isActive: true,
    });

    const { POST: awardMerit } = await import(
      "@/app/api/subjects/[id]/merits/route"
    );
    const { POST: createPreset } = await import(
      "@/app/api/subjects/[id]/presets/route"
    );
    const { PATCH: updatePreset } = await import(
      "@/app/api/subjects/[id]/presets/[presetId]/route"
    );
    const { POST: createReward } = await import(
      "@/app/api/subjects/[id]/rewards/route"
    );
    const { PATCH: updateReward } = await import(
      "@/app/api/subjects/[id]/rewards/[rewardId]/route"
    );

    for (const resPromise of [
      awardMerit(
        new Request(`http://localhost/api/subjects/${SUBJECT_ID}/merits`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            enrollmentIds: [ENROLL_1],
            pointsDelta: 5,
            note: "Recitation",
          }),
        }),
        { params: Promise.resolve({ id: SUBJECT_ID }) }
      ),
      createPreset(
        new Request(`http://localhost/api/subjects/${SUBJECT_ID}/presets`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Recitation",
            type: "MERIT",
            pointsDelta: 5,
          }),
        }),
        { params: Promise.resolve({ id: SUBJECT_ID }) }
      ),
      updatePreset(
        new Request(
          `http://localhost/api/subjects/${SUBJECT_ID}/presets/${PRESET_ID}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: "Updated" }),
          }
        ),
        { params: Promise.resolve({ id: SUBJECT_ID, presetId: PRESET_ID }) }
      ),
      createReward(
        new Request(`http://localhost/api/subjects/${SUBJECT_ID}/rewards`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: "Quiz Boost",
            rewardType: "SCORE_BOOST",
            pointCostPerUnit: 10,
            scoreValuePerUnit: 1,
          }),
        }),
        { params: Promise.resolve({ id: SUBJECT_ID }) }
      ),
      updateReward(
        new Request(
          `http://localhost/api/subjects/${SUBJECT_ID}/rewards/${REWARD_ID}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ isActive: false }),
          }
        ),
        { params: Promise.resolve({ id: SUBJECT_ID, rewardId: REWARD_ID }) }
      ),
    ]) {
      const res = await resPromise;
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "ERR_POINTS_DISABLED" });
    }

    getCurrentUserMock.mockResolvedValue(studentUser());
    subjectEnrollmentFindUniqueMock.mockResolvedValue({
      id: ENROLL_1,
      subjectId: SUBJECT_ID,
      studentId: "student-1",
      availableBalance: 100,
      escrowedBalance: 0,
    });
    const qrPayload = signP2pQrPayload({
      subjectId: SUBJECT_ID,
      receiverEnrollmentId: ENROLL_2,
    });

    const { POST: submitRedemption } = await import(
      "@/app/api/subjects/[id]/redemptions/route"
    );
    const { GET: getP2pQr } = await import(
      "@/app/api/subjects/[id]/p2p-qr/route"
    );
    const { POST: inspectP2pQr } = await import(
      "@/app/api/subjects/[id]/p2p-qr/inspect/route"
    );
    const { POST: transferPoints } = await import(
      "@/app/api/subjects/[id]/transfers/route"
    );

    for (const resPromise of [
      submitRedemption(
        new Request(`http://localhost/api/subjects/${SUBJECT_ID}/redemptions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isCustomRequest: true,
            customPointsCost: 10,
            targetLabel: "Lab pass",
          }),
        }),
        { params: Promise.resolve({ id: SUBJECT_ID }) }
      ),
      getP2pQr(
        new Request(`http://localhost/api/subjects/${SUBJECT_ID}/p2p-qr`),
        { params: Promise.resolve({ id: SUBJECT_ID }) }
      ),
      inspectP2pQr(
        new Request(
          `http://localhost/api/subjects/${SUBJECT_ID}/p2p-qr/inspect`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ qrPayload }),
          }
        ),
        { params: Promise.resolve({ id: SUBJECT_ID }) }
      ),
      transferPoints(
        new Request(`http://localhost/api/subjects/${SUBJECT_ID}/transfers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ qrPayload, amount: 5 }),
        }),
        { params: Promise.resolve({ id: SUBJECT_ID }) }
      ),
    ]) {
      const res = await resPromise;
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: "ERR_POINTS_DISABLED" });
    }
  });

  it("still allows cancelling and reviewing pre-existing PENDING redemptions when pointsEnabled is false", async () => {
    getCurrentUserMock.mockResolvedValue(studentUser());
    queryRawMock
      .mockResolvedValueOnce([
        {
          id: REDEMPTION_ID,
          subjectId: SUBJECT_ID,
          enrollmentId: ENROLL_1,
          pointsEscrowed: 15,
          status: "PENDING",
          targetLabel: "Midterm",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: ENROLL_1,
          studentId: "student-1",
          availableBalance: 20,
          escrowedBalance: 15,
        },
      ]);
    redemptionUpdateMock.mockResolvedValue({
      id: REDEMPTION_ID,
      status: "CANCELLED",
      pointsEscrowed: 15,
    });

    const { DELETE: cancelRedemption } = await import(
      "@/app/api/redemptions/[id]/route"
    );
    const cancelRes = await cancelRedemption(
      new Request(`http://localhost/api/redemptions/${REDEMPTION_ID}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: REDEMPTION_ID }) }
    );
    expect(cancelRes.status).toBe(200);

    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue(teacherUser());
    subjectFindUniqueMock.mockResolvedValue(buildSubject({ pointsEnabled: false }));
    queryRawMock
      .mockResolvedValueOnce([
        {
          id: REDEMPTION_ID,
          subjectId: SUBJECT_ID,
          enrollmentId: ENROLL_1,
          rewardItemId: null,
          targetAssessmentId: null,
          targetLabel: "Perk",
          pointsEscrowed: 15,
          projectedScoreBoost: null,
          status: "PENDING",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: ENROLL_1,
          studentId: "student-1",
          availableBalance: 20,
          escrowedBalance: 15,
        },
      ]);
    redemptionUpdateMock.mockResolvedValue({
      id: REDEMPTION_ID,
      status: "REJECTED",
      pointsEscrowed: 15,
      projectedScoreBoost: null,
      teacherNote: "Refunded",
      reviewedAt: new Date(),
    });

    const { POST: reviewRedemption } = await import(
      "@/app/api/redemptions/[id]/review/route"
    );
    const reviewRes = await reviewRedemption(
      new Request(`http://localhost/api/redemptions/${REDEMPTION_ID}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "REJECT", teacherNote: "Refunded" }),
      }),
      { params: Promise.resolve({ id: REDEMPTION_ID }) }
    );
    expect(reviewRes.status).toBe(200);
  });

  it("forces attendance session points to 0 and skips balance/ledger writes on check-in and override when pointsEnabled is false", async () => {
    getCurrentUserMock.mockResolvedValue(teacherUser());
    subjectFindUniqueMock.mockResolvedValue(buildSubject({ pointsEnabled: false }));
    attendanceSessionFindFirstMock.mockResolvedValue(null);
    attendanceSessionCreateMock.mockImplementation(
      ({ data }: { data: Record<string, unknown> }) => ({
        id: SESSION_ID,
        ...data,
        closedAt: null,
      })
    );

    const { POST: createSession } = await import(
      "@/app/api/subjects/[id]/sessions/route"
    );
    const sessionRes = await createSession(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          teacherLat: 14.5995,
          teacherLng: 120.9842,
          teacherAccuracyM: 10,
          presentPoints: 10,
          latePoints: 5,
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(sessionRes.status).toBe(201);
    expect(attendanceSessionCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          presentPoints: 0,
          latePoints: 0,
        }),
      })
    );

    // Even if an open session had non-zero points before disabling, check-in awards 0 and writes no ledger entry.
    vi.clearAllMocks();
    const qrSecret = generateSessionQrSecret();
    const now = Date.now();
    getCurrentUserMock.mockResolvedValue(studentUser());
    attendanceSessionFindUniqueMock.mockResolvedValue({
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
      presentPoints: 10,
      latePoints: 5,
      subject: {
        id: SUBJECT_ID,
        code: "CS 101",
        title: "Introduction to Computing",
        isArchived: false,
        pointsEnabled: false,
      },
    });
    subjectEnrollmentFindUniqueMock.mockResolvedValue({
      id: ENROLL_1,
      subjectId: SUBJECT_ID,
      studentId: "student-1",
      availableBalance: 25,
      escrowedBalance: 0,
    });
    queryRawMock.mockResolvedValue([
      { id: ENROLL_1, availableBalance: 25, escrowedBalance: 0 },
    ]);
    attendanceRecordFindUniqueMock.mockResolvedValue(null);
    attendanceRecordFindFirstMock.mockResolvedValue(null);
    attendanceRecordCreateMock.mockResolvedValue({
      id: "rec-1",
      sessionId: SESSION_ID,
      status: "PRESENT",
      checkInMethod: "QR_SCAN",
      distanceMeters: 5,
      pointsAwarded: 0,
      recordedAt: new Date(now),
    });

    const { POST: checkIn } = await import("@/app/api/attendance/check-in/route");
    const bucket = getTimeBucket(now, 12);
    const qrPayload = signAttendanceQrToken(SESSION_ID, qrSecret, bucket);
    const checkInRes = await checkIn(
      new Request("http://localhost/api/attendance/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          qrPayload,
          studentLat: 14.5995,
          studentLng: 120.9842,
          studentAccuracyM: 10,
        }),
      })
    );
    expect(checkInRes.status).toBe(201);
    const checkInJson = (await checkInRes.json()) as {
      pointsAwarded: number;
      availableBalance: number;
      pointsEnabled: boolean;
    };
    expect(checkInJson.pointsAwarded).toBe(0);
    expect(checkInJson.availableBalance).toBe(25);
    expect(checkInJson.pointsEnabled).toBe(false);
    expect(subjectEnrollmentUpdateMock).not.toHaveBeenCalled();
    expect(pointLedgerCreateMock).not.toHaveBeenCalled();

    // Teacher override also awards 0 pts and skips balance/ledger writes
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue(teacherUser());
    attendanceSessionFindUniqueMock.mockResolvedValue({
      id: SESSION_ID,
      subjectId: SUBJECT_ID,
      teacherId: "teacher-1",
      status: "OPEN",
      presentPoints: 10,
      latePoints: 5,
      subject: buildSubject({ pointsEnabled: false }),
    });
    subjectEnrollmentFindUniqueMock.mockResolvedValue({
      id: ENROLL_1,
      subjectId: SUBJECT_ID,
      studentId: "student-1",
    });
    queryRawMock.mockResolvedValue([
      { id: ENROLL_1, availableBalance: 25, escrowedBalance: 0 },
    ]);
    attendanceRecordFindUniqueMock.mockResolvedValue(null);
    attendanceRecordCreateMock.mockResolvedValue({
      id: "rec-2",
      status: "PRESENT",
      pointsAwarded: 0,
    });

    const { PATCH: overrideAttendance } = await import(
      "@/app/api/sessions/[id]/override/route"
    );
    const overrideRes = await overrideAttendance(
      new Request(`http://localhost/api/sessions/${SESSION_ID}/override`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollmentId: ENROLL_1,
          status: "PRESENT",
          reason: "Indoor GPS",
        }),
      }),
      { params: Promise.resolve({ id: SESSION_ID }) }
    );
    expect(overrideRes.status).toBe(200);
    const overrideJson = (await overrideRes.json()) as {
      availableBalance: number;
      ledgerDelta: number;
    };
    expect(overrideJson.availableBalance).toBe(25);
    expect(overrideJson.ledgerDelta).toBe(0);
    expect(subjectEnrollmentUpdateMock).not.toHaveBeenCalled();
    expect(pointLedgerCreateMock).not.toHaveBeenCalled();
  });

  it("treats POINTS_PARTICIPATION as inactive in computeSubjectStandings and blocks adding new ones when pointsEnabled is false", async () => {
    subjectFindUniqueMock.mockResolvedValue({
      id: SUBJECT_ID,
      pointsEnabled: false,
      lateAttendanceCreditPct: 50,
      termSplitConfig: null,
    });
    gradeCategoryFindManyMock.mockResolvedValue([
      {
        id: CAT_ASSESS_ID,
        termKey: "DEFAULT",
        name: "Quizzes",
        categoryType: "ASSESSMENT",
        weightPct: 80,
        aggregationMethod: "TOTAL_POINTS",
        targetPointsCap: null,
        sortOrder: 0,
      },
      {
        id: CAT_POINTS_ID,
        termKey: "DEFAULT",
        name: "Participation",
        categoryType: "POINTS_PARTICIPATION",
        weightPct: 20,
        aggregationMethod: "TOTAL_POINTS",
        targetPointsCap: 100,
        sortOrder: 1,
      },
    ]);
    assessmentFindManyMock.mockResolvedValue([
      {
        id: "assess-1",
        categoryId: CAT_ASSESS_ID,
        title: "Quiz 1",
        maxScore: 100,
      },
    ]);
    gradeScaleRuleFindManyMock.mockResolvedValue([]);
    subjectEnrollmentFindManyMock.mockResolvedValue([
      {
        id: ENROLL_1,
        manualStandingOverride: "NONE",
        student: {
          id: "student-1",
          fullName: "Student One",
          email: "s1@classpulse.local",
          institutionalId: "2026-0001",
        },
      },
    ]);
    // Even if historical point ledger entries exist, pointsEnabled = false deactivates POINTS_PARTICIPATION
    pointLedgerCountMock.mockResolvedValue(3);
    assessmentScoreFindManyMock.mockResolvedValue([
      {
        enrollmentId: ENROLL_1,
        assessmentId: "assess-1",
        status: "GRADED",
        rawScore: 90,
        bonusPoints: 0,
        allowExtraCredit: false,
        remarks: null,
      },
    ]);
    attendanceRecordFindManyMock.mockResolvedValue([]);
    pointLedgerGroupByMock.mockResolvedValue([
      { enrollmentId: ENROLL_1, _sum: { availableDelta: 100 } },
    ]);

    const { computeSubjectStandings } = await import(
      "@/lib/grading/standing-service"
    );
    const standingRes = await computeSubjectStandings({ subjectId: SUBJECT_ID });
    expect(standingRes.standings[0]?.standing.overallPct).toBe(90);
    const participationCat = standingRes.standings[0]?.standing.categories.find(
      (c) => c.categoryType === "POINTS_PARTICIPATION"
    );
    expect(participationCat?.isActive).toBe(false);

    // Block adding new POINTS_PARTICIPATION category in PUT /computation while disabled
    getCurrentUserMock.mockResolvedValue(teacherUser());
    subjectFindUniqueMock.mockResolvedValue(buildSubject({ pointsEnabled: false }));
    gradeCategoryFindManyMock.mockResolvedValue([
      {
        id: CAT_ASSESS_ID,
        subjectId: SUBJECT_ID,
        termKey: "DEFAULT",
        name: "Quizzes",
        categoryType: "ASSESSMENT",
        weightPct: 80,
        aggregationMethod: "TOTAL_POINTS",
        targetPointsCap: null,
        sortOrder: 0,
        _count: { assessments: 1 },
      },
    ]);

    const { PUT: updateComputation } = await import(
      "@/app/api/subjects/[id]/computation/route"
    );
    const compRes = await updateComputation(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/computation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lateAttendanceCreditPct: 50,
          termSplitConfig: null,
          categories: [
            {
              id: CAT_ASSESS_ID,
              termKey: "DEFAULT",
              name: "Quizzes",
              categoryType: "ASSESSMENT",
              weightPct: 80,
              aggregationMethod: "TOTAL_POINTS",
              targetPointsCap: null,
            },
            {
              termKey: "DEFAULT",
              name: "Participation",
              categoryType: "POINTS_PARTICIPATION",
              weightPct: 20,
              aggregationMethod: "TOTAL_POINTS",
              targetPointsCap: 100,
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(compRes.status).toBe(400);
    expect(await compRes.json()).toMatchObject({ code: "ERR_POINTS_DISABLED" });
  });
});
