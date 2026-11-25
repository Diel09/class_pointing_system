import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.fn();

const subjectFindUniqueMock = vi.fn();
const subjectUpdateMock = vi.fn();
const subjectEnrollmentFindUniqueMock = vi.fn();
const subjectEnrollmentFindManyMock = vi.fn();
const subjectEnrollmentCountMock = vi.fn();
const subjectEnrollmentUpdateMock = vi.fn();
const gradeCategoryFindManyMock = vi.fn();
const gradeCategoryFindUniqueMock = vi.fn();
const gradeCategoryCreateMock = vi.fn();
const gradeCategoryUpdateMock = vi.fn();
const gradeCategoryDeleteManyMock = vi.fn();
const gradeScaleRuleFindManyMock = vi.fn();
const gradeScaleRuleDeleteManyMock = vi.fn();
const gradeScaleRuleCreateManyMock = vi.fn();
const assessmentFindManyMock = vi.fn();
const assessmentFindUniqueMock = vi.fn();
const assessmentCreateMock = vi.fn();
const assessmentScoreFindManyMock = vi.fn();
const assessmentScoreFindUniqueMock = vi.fn();
const assessmentScoreUpsertMock = vi.fn();
const assessmentScoreUpdateMock = vi.fn();
const assessmentScoreCreateMock = vi.fn();
const attendanceRecordFindManyMock = vi.fn();
const pointLedgerCountMock = vi.fn();
const pointLedgerGroupByMock = vi.fn();
const pointLedgerCreateMock = vi.fn();
const rewardItemFindUniqueMock = vi.fn();
const redemptionFindManyMock = vi.fn();
const redemptionUpdateMock = vi.fn();
const auditLogCreateMock = vi.fn();
const queryRawMock = vi.fn();

const txClient = {
  $queryRaw: queryRawMock,
  subject: { findUnique: subjectFindUniqueMock, update: subjectUpdateMock },
  subjectEnrollment: { update: subjectEnrollmentUpdateMock },
  gradeCategory: {
    findMany: gradeCategoryFindManyMock,
    create: gradeCategoryCreateMock,
    update: gradeCategoryUpdateMock,
    deleteMany: gradeCategoryDeleteManyMock,
  },
  gradeScaleRule: {
    deleteMany: gradeScaleRuleDeleteManyMock,
    createMany: gradeScaleRuleCreateManyMock,
    findMany: gradeScaleRuleFindManyMock,
  },
  assessment: {
    findUnique: assessmentFindUniqueMock,
    create: assessmentCreateMock,
  },
  assessmentScore: {
    findUnique: assessmentScoreFindUniqueMock,
    upsert: assessmentScoreUpsertMock,
    update: assessmentScoreUpdateMock,
    create: assessmentScoreCreateMock,
  },
  rewardItem: { findUnique: rewardItemFindUniqueMock },
  redemptionRequest: { update: redemptionUpdateMock },
  pointLedgerEntry: { create: pointLedgerCreateMock },
  auditLog: { create: auditLogCreateMock },
};

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    subject: { findUnique: subjectFindUniqueMock },
    subjectEnrollment: {
      findUnique: subjectEnrollmentFindUniqueMock,
      findMany: subjectEnrollmentFindManyMock,
      count: subjectEnrollmentCountMock,
    },
    gradeCategory: {
      findMany: gradeCategoryFindManyMock,
      findUnique: gradeCategoryFindUniqueMock,
    },
    gradeScaleRule: { findMany: gradeScaleRuleFindManyMock },
    assessment: {
      findMany: assessmentFindManyMock,
      findUnique: assessmentFindUniqueMock,
    },
    assessmentScore: { findMany: assessmentScoreFindManyMock },
    redemptionRequest: { findMany: redemptionFindManyMock },
    attendanceRecord: { findMany: attendanceRecordFindManyMock },
    pointLedgerEntry: {
      count: pointLedgerCountMock,
      groupBy: pointLedgerGroupByMock,
    },
    $transaction: async (cb: (tx: typeof txClient) => Promise<unknown>) =>
      cb(txClient),
  },
}));

const SUBJECT_ID = "11111111-1111-4111-8111-111111111111";
const CAT_QUIZ_ID = "22222222-2222-4222-8222-222222222221";
const CAT_EXAM_ID = "22222222-2222-4222-8222-222222222222";
const ASSESSMENT_ID = "33333333-3333-4333-8333-333333333333";
const ENROLL_ID = "44444444-4444-4444-8444-444444444444";
const REWARD_ID = "55555555-5555-4555-8555-555555555555";
const REDEMPTION_ID = "66666666-6666-4666-8666-666666666666";

function studentSession() {
  return {
    id: "student-1",
    email: "student1@classpulse.local",
    institutionalId: "2026-0001",
    fullName: "Student One",
    role: "STUDENT" as const,
    status: "ACTIVE" as const,
    sessionVersion: 1,
  };
}

function teacherSession(id = "teacher-1") {
  return {
    id,
    email: "teacher1@classpulse.local",
    institutionalId: "EMP-1001",
    fullName: "Prof. Santos",
    role: "TEACHER" as const,
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
    title: "Intro to Computing",
    section: "1A",
    inviteCode: "CS101SEC",
    isArchived: false,
    standingVisible: true,
    requireGapFreeGradeScale: true,
    lateAttendanceCreditPct: 50,
    termSplitConfig: null,
    ...overrides,
  };
}

describe("Phase 5 Assessments, RBAC, Visibility & Score Boost Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL = "postgresql://localhost/test";
    process.env.AUTH_SECRET = "a".repeat(32);
    process.env.DEVICE_PEPPER = "b".repeat(32);
    process.env.P2P_QR_SECRET = "c".repeat(32);
  });

  it("blocks STUDENT from computation, grade scale, assessment creation, and score entry (zero student submissions)", async () => {
    getCurrentUserMock.mockResolvedValue(studentSession());
    subjectFindUniqueMock.mockResolvedValue(buildSubject());
    assessmentFindUniqueMock.mockResolvedValue({
      id: ASSESSMENT_ID,
      subjectId: SUBJECT_ID,
      maxScore: 50,
      subject: buildSubject(),
      category: { id: CAT_QUIZ_ID, name: "Quizzes", termKey: "DEFAULT" },
    });

    const { PUT: putComputation } = await import(
      "@/app/api/subjects/[id]/computation/route"
    );
    const { PUT: putScale } = await import(
      "@/app/api/subjects/[id]/grade-scale/route"
    );
    const { POST: postAssessment } = await import(
      "@/app/api/subjects/[id]/assessments/route"
    );
    const { PUT: putScores } = await import(
      "@/app/api/assessments/[id]/scores/route"
    );

    const compRes = await putComputation(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/computation`, {
        method: "PUT",
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(compRes.status).toBe(403);

    const scaleRes = await putScale(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/grade-scale`, {
        method: "PUT",
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(scaleRes.status).toBe(403);

    const assessRes = await postAssessment(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/assessments`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(assessRes.status).toBe(403);

    const scoresRes = await putScores(
      new Request(`http://localhost/api/assessments/${ASSESSMENT_ID}/scores`, {
        method: "PUT",
        body: JSON.stringify({ scores: [] }),
      }),
      { params: Promise.resolve({ id: ASSESSMENT_ID }) }
    );
    expect(scoresRes.status).toBe(403);
  });

  it("hides standing details from students when standingVisible is false while keeping teacher view available", async () => {
    subjectFindUniqueMock.mockResolvedValue(
      buildSubject({ standingVisible: false })
    );
    subjectEnrollmentFindUniqueMock.mockResolvedValue({
      id: ENROLL_ID,
      subjectId: SUBJECT_ID,
      studentId: "student-1",
      manualStandingOverride: "NONE",
    });

    const { GET: getStanding } = await import(
      "@/app/api/subjects/[id]/standing/route"
    );

    getCurrentUserMock.mockResolvedValue(studentSession());
    const studentRes = await getStanding(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/standing`),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(studentRes.status).toBe(200);
    expect(await studentRes.json()).toEqual({
      standingVisible: false,
      manualStandingOverride: "NONE",
      standing: null,
    });

    getCurrentUserMock.mockResolvedValue(teacherSession("teacher-1"));
    gradeCategoryFindManyMock.mockResolvedValue([]);
    assessmentFindManyMock.mockResolvedValue([]);
    gradeScaleRuleFindManyMock.mockResolvedValue([]);
    subjectEnrollmentFindManyMock.mockResolvedValue([]);
    pointLedgerCountMock.mockResolvedValue(0);

    const teacherRes = await getStanding(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/standing`),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(teacherRes.status).toBe(200);
    expect(await teacherRes.json()).toMatchObject({
      standingVisible: false,
      standings: [],
    });
  });

  it("rejects SCORE_BOOST redemption targeting an ineligible category and applies bonusPoints on approval", async () => {
    // Part 1: Student attempts to apply an Exam-only boost to a Quiz assessment
    getCurrentUserMock.mockResolvedValue(studentSession());
    subjectFindUniqueMock.mockResolvedValue(buildSubject());
    subjectEnrollmentFindUniqueMock.mockResolvedValue({
      id: ENROLL_ID,
      subjectId: SUBJECT_ID,
      studentId: "student-1",
      availableBalance: 30,
      escrowedBalance: 0,
      manualStandingOverride: "NONE",
    });
    rewardItemFindUniqueMock.mockResolvedValue({
      id: REWARD_ID,
      subjectId: SUBJECT_ID,
      name: "Exam Boost",
      rewardType: "SCORE_BOOST",
      pointCostPerUnit: 10,
      scoreValuePerUnit: 1,
      eligibleCategoryIds: [CAT_EXAM_ID],
      allowExtraCredit: false,
      maxBoostPerAssessment: 5,
      isActive: true,
    });
    assessmentFindUniqueMock.mockResolvedValue({
      id: ASSESSMENT_ID,
      subjectId: SUBJECT_ID,
      categoryId: CAT_QUIZ_ID,
      title: "Quiz 1",
    });

    const { POST: submitRedemption } = await import(
      "@/app/api/subjects/[id]/redemptions/route"
    );
    const badCategoryRes = await submitRedemption(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/redemptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rewardItemId: REWARD_ID,
          requestedUnits: 2,
          targetAssessmentId: ASSESSMENT_ID,
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(badCategoryRes.status).toBe(400);
    expect(await badCategoryRes.json()).toMatchObject({
      code: "ERR_CATEGORY_NOT_ELIGIBLE",
    });

    // Part 2: Teacher approves a valid SCORE_BOOST targeting ASSESSMENT_ID -> increments bonusPoints
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue(teacherSession("teacher-1"));
    subjectFindUniqueMock.mockResolvedValue(buildSubject());
    rewardItemFindUniqueMock.mockResolvedValue({
      id: REWARD_ID,
      name: "Exam Boost",
      rewardType: "SCORE_BOOST",
      allowExtraCredit: true,
    });
    assessmentFindUniqueMock.mockResolvedValue({
      id: ASSESSMENT_ID,
      subjectId: SUBJECT_ID,
    });
    queryRawMock
      .mockResolvedValueOnce([
        {
          id: REDEMPTION_ID,
          subjectId: SUBJECT_ID,
          enrollmentId: ENROLL_ID,
          rewardItemId: REWARD_ID,
          targetAssessmentId: ASSESSMENT_ID,
          targetLabel: "Midterm Exam",
          pointsEscrowed: 20,
          projectedScoreBoost: 2,
          status: "PENDING",
        },
      ])
      .mockResolvedValueOnce([
        { id: ENROLL_ID, availableBalance: 10, escrowedBalance: 20 },
      ])
      .mockResolvedValueOnce([
        { id: "score-1", bonusPoints: 1, allowExtraCredit: false },
      ]);
    redemptionUpdateMock.mockResolvedValue({
      id: REDEMPTION_ID,
      status: "APPROVED",
      pointsEscrowed: 20,
      projectedScoreBoost: 2,
      teacherNote: null,
      reviewedAt: new Date(),
    });

    const { POST: reviewRedemption } = await import(
      "@/app/api/redemptions/[id]/review/route"
    );
    const approveRes = await reviewRedemption(
      new Request(`http://localhost/api/redemptions/${REDEMPTION_ID}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: "APPROVE" }),
      }),
      { params: Promise.resolve({ id: REDEMPTION_ID }) }
    );

    expect(approveRes.status).toBe(200);
    const payload = (await approveRes.json()) as {
      scoreBoostHook: {
        appliedToAssessment: boolean;
        newBonusPoints: number;
        allowExtraCredit: boolean;
      };
    };
    expect(payload.scoreBoostHook).toMatchObject({
      appliedToAssessment: true,
      newBonusPoints: 3,
      allowExtraCredit: true,
    });
    expect(assessmentScoreUpdateMock).toHaveBeenCalledWith({
      where: { id: "score-1" },
      data: {
        bonusPoints: 3,
        allowExtraCredit: true,
      },
    });
  });

  it("persists requireGapFreeGradeScale toggle and allows unequal gaps when disabled", async () => {
    getCurrentUserMock.mockResolvedValue(teacherSession("teacher-1"));
    subjectFindUniqueMock.mockResolvedValue(
      buildSubject({ requireGapFreeGradeScale: false })
    );
    gradeScaleRuleFindManyMock.mockResolvedValue([
      {
        id: "rule-1",
        minPct: 97,
        maxPct: 100,
        gradeEquivalent: "1.00",
        label: "Excellent",
        isPassing: true,
        sortOrder: 0,
      },
      {
        id: "rule-2",
        minPct: 0,
        maxPct: 96,
        gradeEquivalent: "3.00",
        label: "Passed",
        isPassing: true,
        sortOrder: 1,
      },
    ]);

    const { GET: getScale, PUT: putScale } = await import(
      "@/app/api/subjects/[id]/grade-scale/route"
    );

    const getRes = await getScale(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/grade-scale`),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(getRes.status).toBe(200);
    expect(await getScaleJson(getRes)).toMatchObject({
      isDefaultTemplate: false,
      requireGapFree: false,
    });

    const gappedRules = [
      { minPct: 97, maxPct: 100, gradeEquivalent: "1.00", label: "Excellent", isPassing: true },
      { minPct: 75, maxPct: 96, gradeEquivalent: "3.00", label: "Passed", isPassing: true },
      { minPct: 0, maxPct: 74, gradeEquivalent: "5.00", label: "Failed", isPassing: false },
    ];

    const rejectedRes = await putScale(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/grade-scale`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requireGapFree: true,
          rules: gappedRules,
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(rejectedRes.status).toBe(400);

    const allowedRes = await putScale(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/grade-scale`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requireGapFree: false,
          rules: gappedRules,
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(allowedRes.status).toBe(200);
    expect(subjectUpdateMock).toHaveBeenCalledWith({
      where: { id: SUBJECT_ID },
      data: { requireGapFreeGradeScale: false },
    });
    expect(await allowedRes.json()).toMatchObject({
      isDefaultTemplate: false,
      requireGapFree: false,
    });
  });

  it("blocks STUDENT from PATCH/DELETE on assessments and enforces score-boost guardrails for EXCUSED, MISSING, and maxed-out scores", async () => {
    getCurrentUserMock.mockResolvedValue(studentSession());
    subjectFindUniqueMock.mockResolvedValue(buildSubject());
    subjectEnrollmentFindUniqueMock.mockResolvedValue({
      id: ENROLL_ID,
      subjectId: SUBJECT_ID,
      studentId: "student-1",
      availableBalance: 40,
      escrowedBalance: 0,
      manualStandingOverride: "NONE",
    });

    const { PATCH: patchAssessment, DELETE: deleteAssessment } = await import(
      "@/app/api/assessments/[id]/route"
    );

    const patchRes = await patchAssessment(
      new Request(`http://localhost/api/assessments/${ASSESSMENT_ID}`, {
        method: "PATCH",
        body: JSON.stringify({ title: "Hacked" }),
      }),
      { params: Promise.resolve({ id: ASSESSMENT_ID }) }
    );
    expect(patchRes.status).toBe(403);

    const deleteRes = await deleteAssessment(
      new Request(`http://localhost/api/assessments/${ASSESSMENT_ID}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: ASSESSMENT_ID }) }
    );
    expect(deleteRes.status).toBe(403);

    // Student GET assessments returns pendingBoost metadata
    assessmentFindManyMock.mockResolvedValue([
      {
        id: ASSESSMENT_ID,
        subjectId: SUBJECT_ID,
        categoryId: CAT_EXAM_ID,
        category: {
          id: CAT_EXAM_ID,
          name: "Exams",
          termKey: "DEFAULT",
          categoryType: "ASSESSMENT",
        },
        title: "Midterm Exam",
        description: null,
        maxScore: 50,
        assessmentDate: null,
        createdAt: new Date(),
        scores: [
          {
            status: "GRADED",
            rawScore: 45,
            bonusPoints: 0,
            allowExtraCredit: false,
            remarks: null,
            updatedAt: new Date(),
          },
        ],
      },
    ]);
    redemptionFindManyMock.mockResolvedValue([
      {
        targetAssessmentId: ASSESSMENT_ID,
        projectedScoreBoost: 2,
        pointsEscrowed: 20,
      },
    ]);

    const { GET: getAssessments } = await import(
      "@/app/api/subjects/[id]/assessments/route"
    );
    const listRes = await getAssessments(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/assessments`),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(listRes.status).toBe(200);
    const listPayload = (await listRes.json()) as {
      assessments: {
        pendingBoost?: {
          count: number;
          totalBoost: number;
          totalPointsEscrowed: number;
        };
      }[];
    };
    expect(listPayload.assessments[0]?.pendingBoost).toEqual({
      count: 1,
      totalBoost: 2,
      totalPointsEscrowed: 20,
    });

    // Score-boost guardrails in POST /api/subjects/[id]/redemptions
    rewardItemFindUniqueMock.mockResolvedValue({
      id: REWARD_ID,
      subjectId: SUBJECT_ID,
      name: "Exam Boost",
      rewardType: "SCORE_BOOST",
      pointCostPerUnit: 10,
      scoreValuePerUnit: 1,
      eligibleCategoryIds: [CAT_EXAM_ID],
      allowExtraCredit: false,
      maxBoostPerAssessment: 5,
      isActive: true,
    });
    assessmentFindUniqueMock.mockResolvedValue({
      id: ASSESSMENT_ID,
      subjectId: SUBJECT_ID,
      categoryId: CAT_EXAM_ID,
      title: "Midterm Exam",
      maxScore: 50,
    });

    const { POST: submitRedemption } = await import(
      "@/app/api/subjects/[id]/redemptions/route"
    );

    assessmentScoreFindUniqueMock.mockResolvedValueOnce({
      status: "EXCUSED",
      rawScore: null,
      bonusPoints: 0,
      allowExtraCredit: false,
    });
    const excusedRes = await submitRedemption(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/redemptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rewardItemId: REWARD_ID,
          requestedUnits: 1,
          targetAssessmentId: ASSESSMENT_ID,
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(excusedRes.status).toBe(400);
    expect(await excusedRes.json()).toMatchObject({
      code: "ERR_ASSESSMENT_EXCUSED",
    });

    assessmentScoreFindUniqueMock.mockResolvedValueOnce({
      status: "MISSING",
      rawScore: null,
      bonusPoints: 0,
      allowExtraCredit: false,
    });
    const missingRes = await submitRedemption(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/redemptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rewardItemId: REWARD_ID,
          requestedUnits: 1,
          targetAssessmentId: ASSESSMENT_ID,
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(missingRes.status).toBe(400);
    expect(await missingRes.json()).toMatchObject({
      code: "ERR_ASSESSMENT_MISSING",
    });

    assessmentScoreFindUniqueMock.mockResolvedValueOnce({
      status: "GRADED",
      rawScore: 50,
      bonusPoints: 0,
      allowExtraCredit: false,
    });
    const maxedRes = await submitRedemption(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/redemptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rewardItemId: REWARD_ID,
          requestedUnits: 1,
          targetAssessmentId: ASSESSMENT_ID,
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(maxedRes.status).toBe(400);
    expect(await maxedRes.json()).toMatchObject({
      code: "ERR_SCORE_ALREADY_MAX",
    });
  });

  it("bulk-upserts large individual score batches via $executeRaw, deduplicates enrollmentIds, and returns structured 500 on DB failure", async () => {
    getCurrentUserMock.mockResolvedValue(teacherSession("teacher-1"));
    assessmentFindUniqueMock.mockResolvedValue({
      id: ASSESSMENT_ID,
      subjectId: SUBJECT_ID,
      maxScore: 50,
      subject: buildSubject(),
      category: { id: CAT_QUIZ_ID, name: "Quizzes", termKey: "DEFAULT" },
    });

    const enrollIds = Array.from({ length: 220 }, (_, i) => {
      const suffix = String(i + 1).padStart(4, "0");
      return `44444444-4444-4444-8444-44444444${suffix}`;
    });
    subjectEnrollmentFindManyMock.mockResolvedValue(
      enrollIds.map((id, i) => ({ id, studentId: `student-${i + 1}` }))
    );

    const executeRawMock = vi.fn().mockResolvedValue(200);
    const prevExecuteRaw = (txClient as { $executeRaw?: unknown }).$executeRaw;
    (txClient as { $executeRaw?: unknown }).$executeRaw = executeRawMock;

    try {
      const { PUT: putScores } = await import(
        "@/app/api/assessments/[id]/scores/route"
      );

      // 220 unique enrollments + 1 duplicate -> deduped to 220 -> 2 chunks (200 + 20)
      const scoresPayload = [
        ...enrollIds.map((enrollmentId) => ({
          enrollmentId,
          status: "GRADED" as const,
          rawScore: 45,
          remarks: null,
        })),
        {
          enrollmentId: enrollIds[0]!,
          status: "GRADED" as const,
          rawScore: 48,
          remarks: "Updated",
        },
      ];

      const res = await putScores(
        new Request(`http://localhost/api/assessments/${ASSESSMENT_ID}/scores`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scores: scoresPayload }),
        }),
        { params: Promise.resolve({ id: ASSESSMENT_ID }) }
      );

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true, updatedCount: 220 });
      expect(executeRawMock).toHaveBeenCalledTimes(2);
      expect(assessmentScoreUpsertMock).not.toHaveBeenCalled();

      // DB error inside bulk upsert returns structured 500 JSON
      subjectEnrollmentFindManyMock.mockResolvedValueOnce([
        { id: enrollIds[0]!, studentId: "student-1" },
      ]);
      executeRawMock.mockRejectedValueOnce(new Error("P2028 simulated error"));
      const errRes = await putScores(
        new Request(`http://localhost/api/assessments/${ASSESSMENT_ID}/scores`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scores: [
              {
                enrollmentId: enrollIds[0]!,
                status: "GRADED",
                rawScore: 40,
                remarks: null,
              },
            ],
          }),
        }),
        { params: Promise.resolve({ id: ASSESSMENT_ID }) }
      );
      expect(errRes.status).toBe(500);
      expect(await errRes.json()).toMatchObject({
        code: "ERR_INTERNAL",
      });
    } finally {
      if (prevExecuteRaw === undefined) {
        delete (txClient as { $executeRaw?: unknown }).$executeRaw;
      } else {
        (txClient as { $executeRaw?: unknown }).$executeRaw = prevExecuteRaw;
      }
    }
  });
});

async function getScaleJson(res: Response) {
  return (await res.json()) as Record<string, unknown>;
}
