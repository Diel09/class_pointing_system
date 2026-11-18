import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { DEFAULT_PH_GRADE_SCALE } from "@/lib/grading/default-scale";

const getCurrentUserMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: getCurrentUserMock,
}));

describe("Phase 5 Real PostgreSQL Score Boost & Class Standing Integration", () => {
  const suffix = randomUUID().slice(0, 8);
  let termId = "";
  let teacherId = "";
  let studentId = "";
  let subjectId = "";
  let enrollmentId = "";
  let examCategoryId = "";
  let assessmentId = "";
  let rewardId = "";

  beforeAll(async () => {
    const teacher = await db.user.create({
      data: {
        email: `p5-t-${suffix}@classpulse.local`,
        institutionalId: `P5T-${suffix}`,
        passwordHash: "hash",
        fullName: "Phase 5 Teacher",
        role: "TEACHER",
        status: "ACTIVE",
      },
    });
    teacherId = teacher.id;

    const student = await db.user.create({
      data: {
        email: `p5-s-${suffix}@classpulse.local`,
        institutionalId: `P5S-${suffix}`,
        passwordHash: "hash",
        fullName: "Phase 5 Student",
        role: "STUDENT",
        status: "ACTIVE",
      },
    });
    studentId = student.id;

    const term = await db.academicTerm.create({
      data: {
        name: `P5 Term ${suffix}`,
        startDate: new Date("2026-01-01T00:00:00.000Z"),
        endDate: new Date("2026-12-31T23:59:59.000Z"),
        isActive: false,
      },
    });
    termId = term.id;

    const subject = await db.subject.create({
      data: {
        teacherId,
        termId,
        code: `P5-${suffix}`,
        title: "Phase 5 Grading Subject",
        section: "TEST",
        inviteCode: `P5${suffix.toUpperCase()}`,
        standingVisible: true,
      },
    });
    subjectId = subject.id;

    const enrollment = await db.subjectEnrollment.create({
      data: {
        subjectId,
        studentId,
        availableBalance: 50,
        escrowedBalance: 0,
      },
    });
    enrollmentId = enrollment.id;

    const examCat = await db.gradeCategory.create({
      data: {
        subjectId,
        termKey: "DEFAULT",
        name: "Exams",
        categoryType: "ASSESSMENT",
        weightPct: 100,
        aggregationMethod: "TOTAL_POINTS",
      },
    });
    examCategoryId = examCat.id;

    await db.gradeScaleRule.createMany({
      data: DEFAULT_PH_GRADE_SCALE.map((r, i) => ({
        subjectId,
        minPct: r.minPct,
        maxPct: r.maxPct,
        gradeEquivalent: r.gradeEquivalent,
        label: r.label,
        isPassing: r.isPassing,
        sortOrder: i,
      })),
    });

    const assessment = await db.assessment.create({
      data: {
        subjectId,
        categoryId: examCategoryId,
        title: "Final Exam",
        maxScore: 100,
      },
    });
    assessmentId = assessment.id;

    await db.assessmentScore.create({
      data: {
        assessmentId,
        enrollmentId,
        status: "GRADED",
        rawScore: 95,
        bonusPoints: 0,
        allowExtraCredit: false,
        updatedByTeacherId: teacherId,
      },
    });

    const reward = await db.rewardItem.create({
      data: {
        subjectId,
        name: "Exam Boost",
        rewardType: "SCORE_BOOST",
        pointCostPerUnit: 10,
        scoreValuePerUnit: 1,
        eligibleCategoryIds: [examCategoryId],
        allowExtraCredit: false,
      },
    });
    rewardId = reward.id;
  });

  afterAll(async () => {
    if (subjectId) {
      await db.subject.delete({ where: { id: subjectId } }).catch(() => undefined);
    }
    if (termId) {
      await db.academicTerm.delete({ where: { id: termId } }).catch(() => undefined);
    }
    if (teacherId) {
      await db.user.delete({ where: { id: teacherId } }).catch(() => undefined);
    }
    if (studentId) {
      await db.user.delete({ where: { id: studentId } }).catch(() => undefined);
    }
  });

  it("updates AssessmentScore.bonusPoints, PointLedgerEntry, and live standing atomically upon Score Boost approval", async () => {
    const { GET: getStanding } = await import(
      "@/app/api/subjects/[id]/standing/route"
    );
    const { POST: submitRedemption } = await import(
      "@/app/api/subjects/[id]/redemptions/route"
    );
    const { POST: reviewRedemption } = await import(
      "@/app/api/redemptions/[id]/review/route"
    );

    // 1. Initial standing: 95/100 => 95.00% => 1.25
    getCurrentUserMock.mockResolvedValue({
      id: studentId,
      email: `p5-s-${suffix}@classpulse.local`,
      institutionalId: `P5S-${suffix}`,
      fullName: "Phase 5 Student",
      role: "STUDENT",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    const beforeRes = await getStanding(
      new Request(`http://localhost/api/subjects/${subjectId}/standing`),
      { params: Promise.resolve({ id: subjectId }) }
    );
    expect(beforeRes.status).toBe(200);
    const beforeJson = (await beforeRes.json()) as {
      standing: { overallPct: number; effectiveGradeEquivalent: string };
    };
    expect(beforeJson.standing.overallPct).toBe(95);
    expect(beforeJson.standing.effectiveGradeEquivalent).toBe("1.25");

    // 2. Student submits 2-unit (+2) boost redemption targeting Final Exam (20 pts escrowed)
    const submitRes = await submitRedemption(
      new Request(`http://localhost/api/subjects/${subjectId}/redemptions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rewardItemId: rewardId,
          requestedUnits: 2,
          targetAssessmentId: assessmentId,
        }),
      }),
      { params: Promise.resolve({ id: subjectId }) }
    );
    expect(submitRes.status).toBe(201);
    const submitJson = (await submitRes.json()) as {
      redemption: { id: string; targetLabel: string };
    };
    expect(submitJson.redemption.targetLabel).toBe("Final Exam");

    // 3. Teacher approves the redemption
    getCurrentUserMock.mockResolvedValue({
      id: teacherId,
      email: `p5-t-${suffix}@classpulse.local`,
      institutionalId: `P5T-${suffix}`,
      fullName: "Phase 5 Teacher",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    const approveRes = await reviewRedemption(
      new Request(
        `http://localhost/api/redemptions/${submitJson.redemption.id}/review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decision: "APPROVE" }),
        }
      ),
      { params: Promise.resolve({ id: submitJson.redemption.id }) }
    );
    expect(approveRes.status).toBe(200);
    const approveJson = (await approveRes.json()) as {
      scoreBoostHook: { appliedToAssessment: boolean; newBonusPoints: number };
    };
    expect(approveJson.scoreBoostHook).toMatchObject({
      appliedToAssessment: true,
      newBonusPoints: 2,
    });

    // 4. Verify student standing updated from 95% (1.25) -> 97% (1.00) and ledger finalized
    getCurrentUserMock.mockResolvedValue({
      id: studentId,
      email: `p5-s-${suffix}@classpulse.local`,
      institutionalId: `P5S-${suffix}`,
      fullName: "Phase 5 Student",
      role: "STUDENT",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    const afterRes = await getStanding(
      new Request(`http://localhost/api/subjects/${subjectId}/standing`),
      { params: Promise.resolve({ id: subjectId }) }
    );
    expect(afterRes.status).toBe(200);
    const afterJson = (await afterRes.json()) as {
      standing: { overallPct: number; effectiveGradeEquivalent: string };
    };
    expect(afterJson.standing.overallPct).toBe(97);
    expect(afterJson.standing.effectiveGradeEquivalent).toBe("1.00");

    const updatedEnrollment = await db.subjectEnrollment.findUnique({
      where: { id: enrollmentId },
    });
    expect(updatedEnrollment?.availableBalance).toBe(30);
    expect(updatedEnrollment?.escrowedBalance).toBe(0);

    const finalizeEntry = await db.pointLedgerEntry.findFirst({
      where: {
        enrollmentId,
        referenceId: submitJson.redemption.id,
        entryType: "REDEMPTION_FINALIZE",
      },
    });
    expect(finalizeEntry).not.toBeNull();
  });
});
