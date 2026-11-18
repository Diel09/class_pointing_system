import { beforeEach, describe, expect, it, vi } from "vitest";
import { signP2pQrPayload } from "@/lib/points/p2p-qr";

const getCurrentUserMock = vi.fn();

const subjectFindUniqueMock = vi.fn();
const subjectEnrollmentFindUniqueMock = vi.fn();
const subjectEnrollmentUpdateMock = vi.fn();
const userFindUniqueMock = vi.fn();
const rewardItemFindUniqueMock = vi.fn();
const rewardItemFindManyMock = vi.fn();
const rewardItemCreateMock = vi.fn();
const rewardItemUpdateMock = vi.fn();
const redemptionFindManyMock = vi.fn();
const redemptionCreateMock = vi.fn();
const redemptionUpdateMock = vi.fn();
const pointLedgerAggregateMock = vi.fn();
const pointLedgerCreateMock = vi.fn();
const pointLedgerCreateManyMock = vi.fn();
const auditLogCreateMock = vi.fn();
const queryRawMock = vi.fn();

const txClient = {
  $queryRaw: queryRawMock,
  subject: { findUnique: subjectFindUniqueMock },
  subjectEnrollment: { update: subjectEnrollmentUpdateMock },
  user: { findUnique: userFindUniqueMock },
  rewardItem: {
    findUnique: rewardItemFindUniqueMock,
    create: rewardItemCreateMock,
    update: rewardItemUpdateMock,
  },
  redemptionRequest: {
    create: redemptionCreateMock,
    update: redemptionUpdateMock,
  },
  pointLedgerEntry: {
    aggregate: pointLedgerAggregateMock,
    create: pointLedgerCreateMock,
    createMany: pointLedgerCreateManyMock,
  },
  auditLog: { create: auditLogCreateMock },
};

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    subject: { findUnique: subjectFindUniqueMock },
    subjectEnrollment: { findUnique: subjectEnrollmentFindUniqueMock },
    rewardItem: {
      findUnique: rewardItemFindUniqueMock,
      findMany: rewardItemFindManyMock,
    },
    redemptionRequest: { findMany: redemptionFindManyMock },
    $transaction: async (cb: (tx: typeof txClient) => Promise<unknown>) =>
      cb(txClient),
  },
}));

const SUBJECT_1 = "11111111-1111-4111-8111-111111111111";
const SUBJECT_2 = "22222222-2222-4222-8222-222222222222";
const ENROLL_A = "33333333-3333-4333-8333-333333333331";
const ENROLL_B = "33333333-3333-4333-8333-333333333332";
const REWARD_ID = "44444444-4444-4444-8444-444444444444";
const REDEMPTION_ID = "55555555-5555-4555-8555-555555555555";

function buildSubject(overrides?: Record<string, unknown>) {
  return {
    id: SUBJECT_1,
    teacherId: "teacher-1",
    termId: "term-1",
    code: "CS 101",
    title: "Introduction to Computing",
    section: "BSCS-1A",
    inviteCode: "CS101SEC",
    isArchived: false,
    allowNegativeBalance: false,
    allowP2pTransfers: true,
    p2pMaxPerTransfer: 30,
    p2pMaxPerDay: 40,
    p2pMaxPerTerm: 200,
    allowOpenRedemptions: false,
    standingVisible: true,
    term: {
      startDate: new Date("2026-08-01T00:00:00.000Z"),
      endDate: new Date("2026-12-20T00:00:00.000Z"),
    },
    ...overrides,
  };
}

describe("Phase 4 P2P QR Sharing & Redemption Escrow Economy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.AUTH_SECRET = "a".repeat(32);
    process.env.DEVICE_PEPPER = "b".repeat(32);
    process.env.P2P_QR_SECRET = "c".repeat(32);
  });

  it("rejects cross-subject QR codes, self-transfers, and daily P2P cap violations", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: "student-a",
      email: "a@classpulse.local",
      institutionalId: "2026-0001",
      fullName: "Student A",
      role: "STUDENT",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    subjectFindUniqueMock.mockResolvedValue(buildSubject());
    subjectEnrollmentFindUniqueMock.mockResolvedValue({
      id: ENROLL_A,
      subjectId: SUBJECT_1,
      studentId: "student-a",
      availableBalance: 50,
      escrowedBalance: 0,
      manualStandingOverride: "NONE",
    });

    const { POST: inspectQr } = await import(
      "@/app/api/subjects/[id]/p2p-qr/inspect/route"
    );

    const crossQr = signP2pQrPayload({
      subjectId: SUBJECT_2,
      receiverEnrollmentId: ENROLL_B,
      requestedAmount: 10,
    });
    const crossRes = await inspectQr(
      new Request(`http://localhost/api/subjects/${SUBJECT_1}/p2p-qr/inspect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrPayload: crossQr }),
      }),
      { params: Promise.resolve({ id: SUBJECT_1 }) }
    );
    expect(crossRes.status).toBe(400);
    expect(await crossRes.json()).toMatchObject({
      code: "ERR_CROSS_SUBJECT_QR",
    });

    const selfQr = signP2pQrPayload({
      subjectId: SUBJECT_1,
      receiverEnrollmentId: ENROLL_A,
    });
    const selfRes = await inspectQr(
      new Request(`http://localhost/api/subjects/${SUBJECT_1}/p2p-qr/inspect`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrPayload: selfQr }),
      }),
      { params: Promise.resolve({ id: SUBJECT_1 }) }
    );
    expect(selfRes.status).toBe(400);
    expect(await selfRes.json()).toMatchObject({ code: "ERR_SELF_TRANSFER" });

    // Exceeds daily P2P cap (already sent 35 today, max 40, trying 10)
    const validQr = signP2pQrPayload({
      subjectId: SUBJECT_1,
      receiverEnrollmentId: ENROLL_B,
    });
    queryRawMock.mockResolvedValue([
      {
        id: ENROLL_A,
        subjectId: SUBJECT_1,
        studentId: "student-a",
        availableBalance: 50,
        escrowedBalance: 0,
      },
      {
        id: ENROLL_B,
        subjectId: SUBJECT_1,
        studentId: "student-b",
        availableBalance: 10,
        escrowedBalance: 0,
      },
    ]);
    userFindUniqueMock.mockResolvedValue({
      id: "student-b",
      fullName: "Student B",
      institutionalId: "2026-0002",
      status: "ACTIVE",
    });
    pointLedgerAggregateMock
      .mockResolvedValueOnce({ _sum: { availableDelta: -35 } })
      .mockResolvedValueOnce({ _sum: { availableDelta: 0 } })
      .mockResolvedValueOnce({ _sum: { availableDelta: -35 } })
      .mockResolvedValueOnce({ _sum: { availableDelta: 0 } });

    const { POST: sendTransfer } = await import(
      "@/app/api/subjects/[id]/transfers/route"
    );
    const limitRes = await sendTransfer(
      new Request(`http://localhost/api/subjects/${SUBJECT_1}/transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrPayload: validQr, amount: 10 }),
      }),
      { params: Promise.resolve({ id: SUBJECT_1 }) }
    );
    expect(limitRes.status).toBe(400);
    expect(await limitRes.json()).toMatchObject({
      code: "ERR_P2P_LIMIT_EXCEEDED",
    });
  });

  it("executes atomic P2P transfer with paired P2P_SEND / P2P_RECEIVE ledger rows", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: "student-b",
      email: "b@classpulse.local",
      institutionalId: "2026-0002",
      fullName: "Student B",
      role: "STUDENT",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    subjectFindUniqueMock.mockResolvedValue(
      buildSubject({ p2pMaxPerDay: null, p2pMaxPerTerm: null })
    );
    subjectEnrollmentFindUniqueMock.mockResolvedValue({
      id: ENROLL_B,
      subjectId: SUBJECT_1,
      studentId: "student-b",
      availableBalance: 25,
      escrowedBalance: 0,
      manualStandingOverride: "NONE",
    });
    // Return rows in ascending UUID order (ENROLL_A < ENROLL_B)
    queryRawMock.mockResolvedValue([
      {
        id: ENROLL_A,
        subjectId: SUBJECT_1,
        studentId: "student-a",
        availableBalance: 10,
        escrowedBalance: 0,
      },
      {
        id: ENROLL_B,
        subjectId: SUBJECT_1,
        studentId: "student-b",
        availableBalance: 25,
        escrowedBalance: 0,
      },
    ]);
    userFindUniqueMock.mockResolvedValue({
      id: "student-a",
      fullName: "Student A",
      institutionalId: "2026-0001",
      status: "ACTIVE",
    });

    const qr = signP2pQrPayload({
      subjectId: SUBJECT_1,
      receiverEnrollmentId: ENROLL_A,
      requestedAmount: 15,
      requestedNote: "Project split",
    });

    const { POST: sendTransfer } = await import(
      "@/app/api/subjects/[id]/transfers/route"
    );
    const res = await sendTransfer(
      new Request(`http://localhost/api/subjects/${SUBJECT_1}/transfers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrPayload: qr, amount: 15 }),
      }),
      { params: Promise.resolve({ id: SUBJECT_1 }) }
    );

    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      receipt: {
        amount: number;
        note: string | null;
        sender: { availableBalanceAfter: number };
      };
    };
    expect(body.receipt.amount).toBe(15);
    expect(body.receipt.note).toBe("Project split");
    expect(body.receipt.sender.availableBalanceAfter).toBe(10);

    expect(subjectEnrollmentUpdateMock).toHaveBeenNthCalledWith(1, {
      where: { id: ENROLL_B },
      data: { availableBalance: 10 },
    });
    expect(subjectEnrollmentUpdateMock).toHaveBeenNthCalledWith(2, {
      where: { id: ENROLL_A },
      data: { availableBalance: 25 },
    });
    expect(pointLedgerCreateManyMock).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          enrollmentId: ENROLL_B,
          entryType: "P2P_SEND",
          availableDelta: -15,
          availableAfter: 10,
        }),
        expect.objectContaining({
          enrollmentId: ENROLL_A,
          entryType: "P2P_RECEIVE",
          availableDelta: 15,
          availableAfter: 25,
        }),
      ],
    });
  });

  it("enforces RBAC on rewards/redemptions and accurately handles escrow, cancel refund, approve, and reject", async () => {
    // 1. Student cannot create rewards or review redemptions
    getCurrentUserMock.mockResolvedValue({
      id: "student-a",
      email: "a@classpulse.local",
      institutionalId: "2026-0001",
      fullName: "Student A",
      role: "STUDENT",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    const { POST: createReward } = await import(
      "@/app/api/subjects/[id]/rewards/route"
    );
    const rewardDenied = await createReward(
      new Request(`http://localhost/api/subjects/${SUBJECT_1}/rewards`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: "Sneaky Boost",
          rewardType: "SCORE_BOOST",
          pointCostPerUnit: 5,
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_1 }) }
    );
    expect(rewardDenied.status).toBe(403);

    const { POST: reviewRedemption } = await import(
      "@/app/api/redemptions/[id]/review/route"
    );
    const reviewDenied = await reviewRedemption(
      new Request(`http://localhost/api/redemptions/${REDEMPTION_ID}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "APPROVE" }),
      }),
      { params: Promise.resolve({ id: REDEMPTION_ID }) }
    );
    expect(reviewDenied.status).toBe(403);

    // 2. Student submits SCORE_BOOST redemption (20 pts escrowed)
    subjectFindUniqueMock.mockResolvedValue(buildSubject());
    subjectEnrollmentFindUniqueMock.mockResolvedValue({
      id: ENROLL_A,
      subjectId: SUBJECT_1,
      studentId: "student-a",
      availableBalance: 30,
      escrowedBalance: 0,
      manualStandingOverride: "NONE",
    });
    rewardItemFindUniqueMock.mockResolvedValue({
      id: REWARD_ID,
      subjectId: SUBJECT_1,
      name: "Quiz Boost",
      rewardType: "SCORE_BOOST",
      pointCostPerUnit: 10,
      scoreValuePerUnit: 1,
      allowExtraCredit: false,
      maxBoostPerAssessment: 5,
      isActive: true,
    });
    queryRawMock.mockResolvedValue([
      { id: ENROLL_A, availableBalance: 30, escrowedBalance: 0 },
    ]);
    redemptionCreateMock.mockResolvedValue({
      id: REDEMPTION_ID,
      subjectId: SUBJECT_1,
      enrollmentId: ENROLL_A,
      rewardItemId: REWARD_ID,
      isCustomRequest: false,
      targetAssessmentId: null,
      targetLabel: "Midterm Exam",
      pointsEscrowed: 20,
      requestedUnits: 2,
      projectedScoreBoost: 2,
      studentNote: null,
      status: "PENDING",
      reviewedByTeacherId: null,
      teacherNote: null,
      reviewedAt: null,
      createdAt: new Date(),
      rewardItem: {
        id: REWARD_ID,
        name: "Quiz Boost",
        rewardType: "SCORE_BOOST",
        pointCostPerUnit: 10,
        scoreValuePerUnit: 1,
        allowExtraCredit: false,
      },
    });

    const { POST: submitRedemption } = await import(
      "@/app/api/subjects/[id]/redemptions/route"
    );
    const submitRes = await submitRedemption(
      new Request(`http://localhost/api/subjects/${SUBJECT_1}/redemptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rewardItemId: REWARD_ID,
          requestedUnits: 2,
          targetLabel: "Midterm Exam",
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_1 }) }
    );
    expect(submitRes.status).toBe(201);
    expect(subjectEnrollmentUpdateMock).toHaveBeenCalledWith({
      where: { id: ENROLL_A },
      data: { availableBalance: 10, escrowedBalance: 20 },
    });
    expect(pointLedgerCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entryType: "REDEMPTION_ESCROW",
        availableDelta: -20,
        escrowDelta: 20,
        availableAfter: 10,
        escrowAfter: 20,
      }),
    });

    vi.clearAllMocks();

    // 3. Student cancels pending redemption -> full refund to availableBalance
    getCurrentUserMock.mockResolvedValue({
      id: "student-a",
      email: "a@classpulse.local",
      institutionalId: "2026-0001",
      fullName: "Student A",
      role: "STUDENT",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    queryRawMock
      .mockResolvedValueOnce([
        {
          id: REDEMPTION_ID,
          subjectId: SUBJECT_1,
          enrollmentId: ENROLL_A,
          pointsEscrowed: 20,
          status: "PENDING",
          targetLabel: "Midterm Exam",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: ENROLL_A,
          studentId: "student-a",
          availableBalance: 10,
          escrowedBalance: 20,
        },
      ]);
    redemptionUpdateMock.mockResolvedValue({
      id: REDEMPTION_ID,
      status: "CANCELLED",
      pointsEscrowed: 20,
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
    expect(subjectEnrollmentUpdateMock).toHaveBeenCalledWith({
      where: { id: ENROLL_A },
      data: { availableBalance: 30, escrowedBalance: 0 },
    });
    expect(pointLedgerCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entryType: "REDEMPTION_REFUND",
        availableDelta: 20,
        escrowDelta: -20,
        availableAfter: 30,
        escrowAfter: 0,
      }),
    });

    vi.clearAllMocks();

    // 4. Teacher approves a pending redemption -> REDEMPTION_FINALIZE + scoreBoostHook
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
    rewardItemFindUniqueMock.mockResolvedValue({
      id: REWARD_ID,
      name: "Quiz Boost",
      rewardType: "SCORE_BOOST",
      allowExtraCredit: false,
    });
    queryRawMock
      .mockResolvedValueOnce([
        {
          id: REDEMPTION_ID,
          subjectId: SUBJECT_1,
          enrollmentId: ENROLL_A,
          rewardItemId: REWARD_ID,
          targetAssessmentId: null,
          targetLabel: "Midterm Exam",
          pointsEscrowed: 20,
          projectedScoreBoost: 2,
          status: "PENDING",
        },
      ])
      .mockResolvedValueOnce([
        { id: ENROLL_A, availableBalance: 10, escrowedBalance: 20 },
      ]);
    redemptionUpdateMock.mockResolvedValue({
      id: REDEMPTION_ID,
      status: "APPROVED",
      pointsEscrowed: 20,
      projectedScoreBoost: 2,
      teacherNote: "Applied to Midterm",
      reviewedAt: new Date(),
    });

    const approveRes = await reviewRedemption(
      new Request(`http://localhost/api/redemptions/${REDEMPTION_ID}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "APPROVE",
          teacherNote: "Applied to Midterm",
        }),
      }),
      { params: Promise.resolve({ id: REDEMPTION_ID }) }
    );
    expect(approveRes.status).toBe(200);
    expect(subjectEnrollmentUpdateMock).toHaveBeenCalledWith({
      where: { id: ENROLL_A },
      data: { availableBalance: 10, escrowedBalance: 0 },
    });
    expect(pointLedgerCreateMock).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entryType: "REDEMPTION_FINALIZE",
        availableDelta: 0,
        escrowDelta: -20,
        availableAfter: 10,
        escrowAfter: 0,
      }),
    });
  });
});
