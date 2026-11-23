import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.fn();
const subjectFindUniqueMock = vi.fn();
const subjectCreateMock = vi.fn();
const gradeCategoryCreateManyMock = vi.fn();
const gradeScaleRuleCreateManyMock = vi.fn();
const meritPresetCreateManyMock = vi.fn();
const rewardItemCreateManyMock = vi.fn();
const auditCreateMock = vi.fn();
const transactionMock = vi.fn();

const txClient = {
  subject: {
    findUnique: subjectFindUniqueMock,
    findUniqueOrThrow: subjectFindUniqueMock,
    create: subjectCreateMock,
  },
  gradeCategory: {
    createMany: gradeCategoryCreateManyMock,
  },
  gradeScaleRule: {
    createMany: gradeScaleRuleCreateManyMock,
  },
  meritPreset: {
    createMany: meritPresetCreateManyMock,
  },
  rewardItem: {
    createMany: rewardItemCreateManyMock,
  },
  auditLog: {
    create: auditCreateMock,
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
    $transaction: transactionMock,
  },
}));

const SUBJECT_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const TERM_ID = "33333333-3333-4333-8333-333333333333";
const OLD_CAT_1 = "44444444-4444-4444-8444-444444444441";
const OLD_CAT_2 = "44444444-4444-4444-8444-444444444442";

describe("POST /api/subjects/[id]/duplicate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue({
      id: OWNER_ID,
      email: "owner@classpulse.local",
      institutionalId: "T-001",
      fullName: "Prof. Owner",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    transactionMock.mockImplementation(
      async (cb: (tx: typeof txClient) => Promise<unknown>) => cb(txClient)
    );
  });

  it("prefetches source, batches grade categories with createMany, remaps reward categories, and uses extended transaction timeout", async () => {
    const sourceSubject = {
      id: SUBJECT_ID,
      teacherId: OWNER_ID,
      termId: TERM_ID,
      code: "CS 101",
      title: "Intro to Computing",
      section: "BSCS-1A",
      startDate: new Date("2026-08-15T00:00:00.000Z"),
      endDate: null,
      inviteCode: "OLD12345",
      isArchived: false,
      pointsEnabled: false,
      allowNegativeBalance: false,
      allowP2pTransfers: true,
      p2pMaxPerTransfer: null,
      p2pMaxPerDay: null,
      p2pMaxPerTerm: null,
      allowOpenRedemptions: false,
      standingVisible: true,
      requireGapFreeGradeScale: true,
      lateAttendanceCreditPct: 50,
      termSplitConfig: null,
      gradeCategories: [
        {
          id: OLD_CAT_1,
          subjectId: SUBJECT_ID,
          termKey: "DEFAULT",
          name: "Quizzes",
          categoryType: "ASSESSMENT",
          weightPct: 30,
          aggregationMethod: "TOTAL_POINTS",
          targetPointsCap: null,
          sortOrder: 0,
        },
        {
          id: OLD_CAT_2,
          subjectId: SUBJECT_ID,
          termKey: "DEFAULT",
          name: "Exams",
          categoryType: "ASSESSMENT",
          weightPct: 70,
          aggregationMethod: "TOTAL_POINTS",
          targetPointsCap: null,
          sortOrder: 1,
        },
      ],
      gradeScaleRules: [
        {
          minPct: 90,
          maxPct: 100,
          gradeEquivalent: "1.00",
          label: "Excellent",
          isPassing: true,
          sortOrder: 0,
        },
      ],
      meritPresets: [
        {
          name: "Recitation",
          type: "MERIT",
          pointsDelta: 5,
          description: null,
          isArchived: false,
        },
      ],
      rewardItems: [
        {
          name: "Quiz Boost",
          description: null,
          rewardType: "SCORE_BOOST",
          pointCostPerUnit: 10,
          scoreValuePerUnit: 1,
          eligibleCategoryIds: [OLD_CAT_1],
          allowExtraCredit: false,
          maxBoostPerAssessment: null,
          isActive: true,
        },
      ],
    };

    // 1st call: guard check; 2nd call: prefetch source; 3rd call: invite code collision check
    subjectFindUniqueMock
      .mockResolvedValueOnce(sourceSubject)
      .mockResolvedValueOnce(sourceSubject)
      .mockResolvedValueOnce(null);

    const newSubjectId = "99999999-9999-4999-8999-999999999999";
    subjectCreateMock.mockResolvedValue({
      id: newSubjectId,
      teacherId: OWNER_ID,
      termId: TERM_ID,
      code: "CS 101",
      title: "Intro to Computing",
      section: "BSCS-1B",
      startDate: sourceSubject.startDate,
      endDate: null,
      inviteCode: "NEW12345",
      isArchived: false,
      term: { id: TERM_ID, name: "1st Sem", isActive: true },
      _count: { enrollments: 0 },
    });

    const { POST } = await import("@/app/api/subjects/[id]/duplicate/route");
    const res = await POST(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "BSCS-1B" }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );

    expect(res.status).toBe(201);
    expect(subjectCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pointsEnabled: false,
        }),
      })
    );
    expect(transactionMock).toHaveBeenCalledWith(expect.any(Function), {
      maxWait: 5000,
      timeout: 20000,
    });

    expect(gradeCategoryCreateManyMock).toHaveBeenCalledTimes(1);
    const createdCatData = gradeCategoryCreateManyMock.mock.calls[0]?.[0]?.data as {
      id: string;
      name: string;
    }[];
    expect(createdCatData).toHaveLength(2);
    expect(createdCatData[0]?.id).not.toBe(OLD_CAT_1);
    expect(createdCatData[1]?.id).not.toBe(OLD_CAT_2);

    const rewardData = rewardItemCreateManyMock.mock.calls[0]?.[0]?.data as {
      eligibleCategoryIds: string[];
    }[];
    expect(rewardData[0]?.eligibleCategoryIds).toEqual([createdCatData[0]?.id]);
  });

  it("returns structured 504 JSON error on Prisma P2028 transaction timeout and 500 on unexpected error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const baseSubject = {
      id: SUBJECT_ID,
      teacherId: OWNER_ID,
      termId: TERM_ID,
      code: "CS 101",
      title: "Intro to Computing",
      section: "BSCS-1A",
      startDate: null,
      endDate: null,
      inviteCode: "OLD12345",
      isArchived: false,
      gradeCategories: [],
      gradeScaleRules: [],
      meritPresets: [],
      rewardItems: [],
    };

    subjectFindUniqueMock
      .mockResolvedValueOnce(baseSubject)
      .mockResolvedValueOnce(baseSubject);

    transactionMock.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Transaction expired", {
        code: "P2028",
        clientVersion: "6.19.3",
      })
    );

    const { POST } = await import("@/app/api/subjects/[id]/duplicate/route");
    const timeoutRes = await POST(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "BSCS-1B" }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(timeoutRes.status).toBe(504);
    const timeoutJson = (await timeoutRes.json()) as { code: string };
    expect(timeoutJson.code).toBe("ERR_TIMEOUT");

    subjectFindUniqueMock
      .mockResolvedValueOnce(baseSubject)
      .mockResolvedValueOnce(baseSubject);
    transactionMock.mockRejectedValueOnce(new Error("Unexpected DB error"));

    const errRes = await POST(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "BSCS-1C" }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(errRes.status).toBe(500);
    const errJson = (await errRes.json()) as { code: string };
    expect(errJson.code).toBe("ERR_INTERNAL");

    consoleSpy.mockRestore();
  });
});
