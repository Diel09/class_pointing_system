import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.fn();

const subjectFindUniqueMock = vi.fn();
const subjectUpdateMock = vi.fn();
const subjectEnrollmentFindUniqueMock = vi.fn();
const subjectEnrollmentUpdateMock = vi.fn();
const subjectEnrollmentAggregateMock = vi.fn();
const meritPresetFindUniqueMock = vi.fn();
const meritPresetFindManyMock = vi.fn();
const meritPresetCreateMock = vi.fn();
const meritPresetUpdateMock = vi.fn();
const pointLedgerFindManyMock = vi.fn();
const pointLedgerCountMock = vi.fn();
const pointLedgerCreateManyMock = vi.fn();
const auditLogCreateMock = vi.fn();
const auditLogCreateManyMock = vi.fn();
const queryRawMock = vi.fn();

const txClient = {
  $queryRaw: queryRawMock,
  subject: {
    update: subjectUpdateMock,
  },
  subjectEnrollment: {
    update: subjectEnrollmentUpdateMock,
  },
  meritPreset: {
    create: meritPresetCreateMock,
    update: meritPresetUpdateMock,
  },
  pointLedgerEntry: {
    createMany: pointLedgerCreateManyMock,
  },
  auditLog: {
    create: auditLogCreateMock,
    createMany: auditLogCreateManyMock,
  },
};

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    subject: {
      findUnique: subjectFindUniqueMock,
    },
    subjectEnrollment: {
      findUnique: subjectEnrollmentFindUniqueMock,
      aggregate: subjectEnrollmentAggregateMock,
    },
    meritPreset: {
      findUnique: meritPresetFindUniqueMock,
      findMany: meritPresetFindManyMock,
    },
    pointLedgerEntry: {
      findMany: pointLedgerFindManyMock,
      count: pointLedgerCountMock,
    },
    auditLog: {
      create: auditLogCreateMock,
    },
    $transaction: async (cb: (tx: typeof txClient) => Promise<unknown>) =>
      cb(txClient),
  },
}));

const SUBJECT_ID = "11111111-1111-4111-8111-111111111111";
const PRESET_ID = "22222222-2222-4222-8222-222222222222";
const ENROLL_IDS = [
  "33333333-3333-4333-8333-333333333331",
  "33333333-3333-4333-8333-333333333332",
  "33333333-3333-4333-8333-333333333333",
  "33333333-3333-4333-8333-333333333334",
  "33333333-3333-4333-8333-333333333335",
];

function buildSubject(overrides?: Record<string, unknown>) {
  return {
    id: SUBJECT_ID,
    teacherId: "teacher-1",
    termId: "term-1",
    code: "CS 101",
    title: "Introduction to Computing",
    section: "BSCS-1A",
    inviteCode: "CS101SEC",
    isArchived: false,
    allowNegativeBalance: false,
    allowP2pTransfers: true,
    standingVisible: true,
    ...overrides,
  };
}

describe("Phase 3 Merit/Demerit Pointing & Immutable Ledger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.AUTH_SECRET = "a".repeat(32);
    process.env.DEVICE_PEPPER = "b".repeat(32);
    process.env.P2P_QR_SECRET = "c".repeat(32);
  });

  it("blocks STUDENT and non-owning TEACHER from preset/merit endpoints and cross-student ledger access", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: "student-1",
      email: "s1@classpulse.local",
      institutionalId: "2026-0001",
      fullName: "Student One",
      role: "STUDENT",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    const { POST: createPreset } = await import(
      "@/app/api/subjects/[id]/presets/route"
    );
    const presetRes = await createPreset(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/presets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Bonus",
          type: "MERIT",
          pointsDelta: 5,
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(presetRes.status).toBe(403);

    const { POST: awardMerits } = await import(
      "@/app/api/subjects/[id]/merits/route"
    );
    const awardRes = await awardMerits(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/merits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollmentIds: [ENROLL_IDS[0]],
          pointsDelta: 5,
          note: "Self award attempt",
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(awardRes.status).toBe(403);

    // Student 1 cannot query Student 2's enrollment ledger
    subjectFindUniqueMock.mockResolvedValue(buildSubject());
    subjectEnrollmentFindUniqueMock.mockResolvedValue({
      id: ENROLL_IDS[0],
      subjectId: SUBJECT_ID,
      studentId: "student-1",
      availableBalance: 10,
      escrowedBalance: 0,
      manualStandingOverride: "NONE",
    });

    const { GET: getLedger } = await import(
      "@/app/api/subjects/[id]/ledger/route"
    );
    const crossLedgerRes = await getLedger(
      new Request(
        `http://localhost/api/subjects/${SUBJECT_ID}/ledger?enrollmentId=${ENROLL_IDS[1]}`
      ),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(crossLedgerRes.status).toBe(403);

    // Non-owning Teacher 2 blocked from awarding merits
    getCurrentUserMock.mockResolvedValue({
      id: "teacher-2",
      email: "t2@classpulse.local",
      institutionalId: "EMP-2",
      fullName: "Teacher Two",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    const otherTeacherAward = await awardMerits(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/merits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollmentIds: [ENROLL_IDS[0]],
          pointsDelta: 5,
          note: "Unauthorized",
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(otherTeacherAward.status).toBe(403);
  });

  it("enforces 0-floor clamping when allowNegativeBalance is false and permits debt when true", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: "teacher-1",
      email: "t1@classpulse.local",
      institutionalId: "EMP-1",
      fullName: "Prof. Elena Santos",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    const { POST: awardMerits } = await import(
      "@/app/api/subjects/[id]/merits/route"
    );

    // Case 1: allowNegativeBalance = false -> balance 3 with -8 demerit clamps to 0
    subjectFindUniqueMock.mockResolvedValue(
      buildSubject({ allowNegativeBalance: false })
    );
    queryRawMock.mockResolvedValue([
      {
        id: ENROLL_IDS[0],
        studentId: "student-1",
        availableBalance: 3,
        escrowedBalance: 0,
      },
    ]);

    const clampedRes = await awardMerits(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/merits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollmentIds: [ENROLL_IDS[0]],
          pointsDelta: -8,
          note: "Late submission violation",
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(clampedRes.status).toBe(201);
    const clampedBody = (await clampedRes.json()) as {
      results: {
        availableDelta: number;
        availableAfter: number;
        clamped: boolean;
      }[];
    };
    expect(clampedBody.results[0]).toMatchObject({
      availableDelta: -3,
      availableAfter: 0,
      clamped: true,
    });
    expect(subjectEnrollmentUpdateMock).toHaveBeenCalledWith({
      where: { id: ENROLL_IDS[0] },
      data: { availableBalance: 0 },
    });
    expect(pointLedgerCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          enrollmentId: ENROLL_IDS[0],
          entryType: "DEMERIT",
          availableDelta: -3,
          availableAfter: 0,
          note: expect.stringContaining("Requested -8 pts; floored at 0"),
        }),
      ],
    });

    vi.clearAllMocks();

    // Case 2: already at 0 balance with allowNegativeBalance = false -> still creates ledger entry
    subjectFindUniqueMock.mockResolvedValue(
      buildSubject({ allowNegativeBalance: false })
    );
    queryRawMock.mockResolvedValue([
      {
        id: ENROLL_IDS[0],
        studentId: "student-1",
        availableBalance: 0,
        escrowedBalance: 0,
      },
    ]);

    const zeroFloorRes = await awardMerits(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/merits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollmentIds: [ENROLL_IDS[0]],
          pointsDelta: -5,
          note: "Phone distraction",
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(zeroFloorRes.status).toBe(201);
    expect(subjectEnrollmentUpdateMock).not.toHaveBeenCalled();
    expect(pointLedgerCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          enrollmentId: ENROLL_IDS[0],
          entryType: "DEMERIT",
          availableDelta: 0,
          availableAfter: 0,
          note: expect.stringContaining("Requested -5 pts; floored at 0"),
        }),
      ],
    });

    vi.clearAllMocks();

    // Case 3: allowNegativeBalance = true -> balance 0 with -5 demerit goes to -5
    subjectFindUniqueMock.mockResolvedValue(
      buildSubject({ allowNegativeBalance: true })
    );
    queryRawMock.mockResolvedValue([
      {
        id: ENROLL_IDS[0],
        studentId: "student-1",
        availableBalance: 0,
        escrowedBalance: 0,
      },
    ]);

    const debtRes = await awardMerits(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/merits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollmentIds: [ENROLL_IDS[0]],
          pointsDelta: -5,
          note: "Phone distraction",
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(debtRes.status).toBe(201);
    const debtBody = (await debtRes.json()) as {
      results: {
        availableDelta: number;
        availableAfter: number;
        clamped: boolean;
      }[];
    };
    expect(debtBody.results[0]).toMatchObject({
      availableDelta: -5,
      availableAfter: -5,
      clamped: false,
    });
    expect(subjectEnrollmentUpdateMock).toHaveBeenCalledWith({
      where: { id: ENROLL_IDS[0] },
      data: { availableBalance: -5 },
    });
  });

  it("atomically awards a MeritPreset across 5 students creating 5 balanced ledger entries and audit logs", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: "teacher-1",
      email: "t1@classpulse.local",
      institutionalId: "EMP-1",
      fullName: "Prof. Elena Santos",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    subjectFindUniqueMock.mockResolvedValue(buildSubject());
    meritPresetFindUniqueMock.mockResolvedValue({
      id: PRESET_ID,
      subjectId: SUBJECT_ID,
      name: "Active Recitation",
      type: "MERIT",
      pointsDelta: 5,
      description: "Good answer",
      isArchived: false,
    });

    queryRawMock.mockResolvedValue(
      ENROLL_IDS.map((eid, idx) => ({
        id: eid,
        studentId: `student-${idx + 1}`,
        availableBalance: idx * 10,
        escrowedBalance: 0,
      }))
    );

    const { POST: awardMerits } = await import(
      "@/app/api/subjects/[id]/merits/route"
    );

    // Deliberately pass unsorted + duplicate ID to verify deduplication & sorting
    const res = await awardMerits(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/merits`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enrollmentIds: [...ENROLL_IDS].reverse().concat(ENROLL_IDS[0]!),
          presetId: PRESET_ID,
          note: "Week 4 review",
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      entryType: string;
      requestedDelta: number;
      results: { enrollmentId: string; availableDelta: number; availableAfter: number }[];
    };

    expect(body.entryType).toBe("MERIT");
    expect(body.requestedDelta).toBe(5);
    expect(body.results).toHaveLength(5);
    expect(subjectEnrollmentUpdateMock).toHaveBeenCalledTimes(5);

    expect(pointLedgerCreateManyMock).toHaveBeenCalledTimes(1);
    const ledgerArg = pointLedgerCreateManyMock.mock.calls[0]?.[0] as {
      data: {
        enrollmentId: string;
        entryType: string;
        availableDelta: number;
        availableAfter: number;
        referenceType: string;
        referenceId: string;
        note: string;
      }[];
    };
    expect(ledgerArg.data).toHaveLength(5);
    ledgerArg.data.forEach((row, idx) => {
      expect(row.entryType).toBe("MERIT");
      expect(row.availableDelta).toBe(5);
      expect(row.availableAfter).toBe(idx * 10 + 5);
      expect(row.referenceType).toBe("MeritPreset");
      expect(row.referenceId).toBe(PRESET_ID);
      expect(row.note).toBe("Active Recitation: Week 4 review");
    });

    expect(auditLogCreateManyMock).toHaveBeenCalledTimes(1);
    const auditArg = auditLogCreateManyMock.mock.calls[0]?.[0] as {
      data: unknown[];
    };
    expect(auditArg.data).toHaveLength(5);
  });

  it("filters and paginates student ledger entries safely", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: "student-1",
      email: "s1@classpulse.local",
      institutionalId: "2026-0001",
      fullName: "Student One",
      role: "STUDENT",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    subjectFindUniqueMock.mockResolvedValue(buildSubject());
    subjectEnrollmentFindUniqueMock.mockResolvedValue({
      id: ENROLL_IDS[0],
      subjectId: SUBJECT_ID,
      studentId: "student-1",
      availableBalance: 5,
      escrowedBalance: 0,
      manualStandingOverride: "NONE",
    });
    pointLedgerCountMock.mockResolvedValue(12);
    pointLedgerFindManyMock.mockResolvedValue([
      {
        id: "led-1",
        enrollmentId: ENROLL_IDS[0],
        entryType: "DEMERIT",
        availableDelta: -5,
        escrowDelta: 0,
        availableAfter: 5,
        escrowAfter: 0,
        referenceType: "MeritPreset",
        referenceId: PRESET_ID,
        note: "Phone Distraction",
        createdAt: new Date("2026-11-17T08:00:00Z"),
        actor: { id: "teacher-1", fullName: "Prof. Elena Santos", role: "TEACHER" },
      },
    ]);

    const { GET: getLedger } = await import(
      "@/app/api/subjects/[id]/ledger/route"
    );
    const res = await getLedger(
      new Request(
        `http://localhost/api/subjects/${SUBJECT_ID}/ledger?filter=DEMERIT&page=2&limit=5`
      ),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );

    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      entries: unknown[];
      pagination: { page: number; limit: number; total: number; totalPages: number };
    };
    expect(data.pagination).toEqual({
      page: 2,
      limit: 5,
      total: 12,
      totalPages: 3,
    });
    expect(pointLedgerFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          subjectId: SUBJECT_ID,
          enrollmentId: ENROLL_IDS[0],
          entryType: { in: ["DEMERIT"] },
        },
        skip: 5,
        take: 5,
      })
    );
  });
});
