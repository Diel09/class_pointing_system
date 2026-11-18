import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

const getCurrentUserMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: getCurrentUserMock,
}));

describe("Subject Duplication Integration (Real PostgreSQL)", () => {
  const suffix = randomUUID().slice(0, 8);
  let termId = "";
  let teacherId = "";
  let otherTeacherId = "";
  let studentId = "";
  const createdSubjectIds: string[] = [];

  beforeAll(async () => {
    const teacher = await db.user.create({
      data: {
        email: `sdup-t1-${suffix}@classpulse.local`,
        institutionalId: `SDT1-${suffix}`,
        passwordHash: "hash",
        fullName: "Duplication Owner Teacher",
        role: "TEACHER",
        status: "ACTIVE",
      },
    });
    teacherId = teacher.id;

    const otherTeacher = await db.user.create({
      data: {
        email: `sdup-t2-${suffix}@classpulse.local`,
        institutionalId: `SDT2-${suffix}`,
        passwordHash: "hash",
        fullName: "Other Teacher",
        role: "TEACHER",
        status: "ACTIVE",
      },
    });
    otherTeacherId = otherTeacher.id;

    const student = await db.user.create({
      data: {
        email: `sdup-s-${suffix}@classpulse.local`,
        institutionalId: `SDS-${suffix}`,
        passwordHash: "hash",
        fullName: "Duplication Test Student",
        role: "STUDENT",
        status: "ACTIVE",
      },
    });
    studentId = student.id;

    const term = await db.academicTerm.create({
      data: {
        name: `SDUP Term ${suffix}`,
        startDate: new Date("2026-08-01T00:00:00.000Z"),
        endDate: new Date("2026-12-20T00:00:00.000Z"),
        isActive: false,
      },
    });
    termId = term.id;
  });

  afterAll(async () => {
    if (createdSubjectIds.length > 0) {
      await db.assessment
        .deleteMany({ where: { subjectId: { in: createdSubjectIds } } })
        .catch(() => undefined);
      await db.subject
        .deleteMany({ where: { id: { in: createdSubjectIds } } })
        .catch(() => undefined);
    }
    await db.auditLog
      .deleteMany({
        where: { actorUserId: { in: [teacherId, otherTeacherId] } },
      })
      .catch(() => undefined);
    if (termId) {
      await db.academicTerm
        .delete({ where: { id: termId } })
        .catch(() => undefined);
    }
    for (const userId of [teacherId, otherTeacherId, studentId]) {
      if (userId) {
        await db.user.delete({ where: { id: userId } }).catch(() => undefined);
      }
    }
  });

  it("duplicates subject policies, categories, grade scale, presets, and remapped rewards while excluding assessments and student data", async () => {
    const termSplitConfig = {
      enabled: true,
      terms: [
        { key: "MIDTERM", label: "Midterm", weightPct: 40 },
        { key: "FINALS", label: "Finals", weightPct: 60 },
      ],
    };

    const source = await db.subject.create({
      data: {
        teacherId,
        termId,
        code: `CS-${suffix}`,
        title: "Algorithms & Structures",
        section: "BSCS-1A",
        startDate: new Date("2026-08-15T00:00:00.000Z"),
        endDate: new Date("2026-12-15T00:00:00.000Z"),
        inviteCode: `DUP${suffix.toUpperCase()}`.slice(0, 12),
        isArchived: true,
        allowNegativeBalance: true,
        allowP2pTransfers: false,
        p2pMaxPerTransfer: 25,
        p2pMaxPerDay: 50,
        p2pMaxPerTerm: 200,
        allowOpenRedemptions: true,
        standingVisible: false,
        requireGapFreeGradeScale: false,
        lateAttendanceCreditPct: 75,
        termSplitConfig,
      },
    });
    createdSubjectIds.push(source.id);

    const quizzesCategory = await db.gradeCategory.create({
      data: {
        subjectId: source.id,
        termKey: "MIDTERM",
        name: "Quizzes",
        categoryType: "ASSESSMENT",
        weightPct: 60,
        aggregationMethod: "EQUAL_AVERAGE",
        sortOrder: 0,
      },
    });
    const attendanceCategory = await db.gradeCategory.create({
      data: {
        subjectId: source.id,
        termKey: "FINALS",
        name: "Attendance",
        categoryType: "ATTENDANCE",
        weightPct: 40,
        aggregationMethod: "TOTAL_POINTS",
        sortOrder: 1,
      },
    });

    await db.gradeScaleRule.createMany({
      data: [
        {
          subjectId: source.id,
          minPct: 90,
          maxPct: 100,
          gradeEquivalent: "1.00",
          label: "Excellent",
          isPassing: true,
          sortOrder: 0,
        },
        {
          subjectId: source.id,
          minPct: 0,
          maxPct: 89.99,
          gradeEquivalent: "5.00",
          label: "Failed",
          isPassing: false,
          sortOrder: 1,
        },
      ],
    });

    await db.meritPreset.createMany({
      data: [
        {
          subjectId: source.id,
          name: "Recitation",
          type: "MERIT",
          pointsDelta: 5,
          description: "Active participation",
          isArchived: false,
        },
        {
          subjectId: source.id,
          name: "Old Penalty",
          type: "DEMERIT",
          pointsDelta: -3,
          description: null,
          isArchived: true,
        },
      ],
    });

    await db.rewardItem.createMany({
      data: [
        {
          subjectId: source.id,
          name: "Quiz Boost +2",
          description: "Applies only to Quizzes",
          rewardType: "SCORE_BOOST",
          pointCostPerUnit: 20,
          scoreValuePerUnit: 2,
          eligibleCategoryIds: [quizzesCategory.id],
          allowExtraCredit: true,
          maxBoostPerAssessment: 4,
          isActive: true,
        },
        {
          subjectId: source.id,
          name: "Homework Pass",
          description: "Fixed perk",
          rewardType: "FIXED_PERK",
          pointCostPerUnit: 30,
          scoreValuePerUnit: 1,
          eligibleCategoryIds: [],
          allowExtraCredit: false,
          isActive: false,
        },
      ],
    });

    // Runtime & assessment data that MUST NOT be copied
    const assessment = await db.assessment.create({
      data: {
        subjectId: source.id,
        categoryId: quizzesCategory.id,
        title: "Quiz 1",
        maxScore: 20,
      },
    });
    const enrollment = await db.subjectEnrollment.create({
      data: {
        subjectId: source.id,
        studentId,
        availableBalance: 40,
      },
    });
    await db.assessmentScore.create({
      data: {
        assessmentId: assessment.id,
        enrollmentId: enrollment.id,
        status: "GRADED",
        rawScore: 19,
      },
    });
    await db.pointLedgerEntry.create({
      data: {
        enrollmentId: enrollment.id,
        subjectId: source.id,
        entryType: "MERIT",
        availableDelta: 40,
        escrowDelta: 0,
        availableAfter: 40,
        escrowAfter: 0,
        referenceType: "ManualMerit",
        referenceId: randomUUID(),
        actorUserId: teacherId,
      },
    });
    await db.attendanceSession.create({
      data: {
        subjectId: source.id,
        teacherId,
        teacherLat: 14.5995,
        teacherLng: 120.9842,
        teacherAccuracyM: 10,
        qrSecret: "secret",
        presentCutoffAt: new Date(),
        lateCutoffAt: new Date(),
      },
    });
    await db.redemptionRequest.create({
      data: {
        subjectId: source.id,
        enrollmentId: enrollment.id,
        isCustomRequest: true,
        targetLabel: "Custom",
        pointsEscrowed: 10,
      },
    });
    await db.notification.create({
      data: {
        userId: studentId,
        subjectId: source.id,
        type: "MERIT_RECEIVED",
        title: "Points",
        body: "+40",
      },
    });

    const { POST: duplicateSubject } = await import(
      "@/app/api/subjects/[id]/duplicate/route"
    );

    // 1. Unauthenticated -> 401
    getCurrentUserMock.mockResolvedValue(null);
    const unauthRes = await duplicateSubject(
      new Request(`http://localhost/api/subjects/${source.id}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "BSCS-1B" }),
      }),
      { params: Promise.resolve({ id: source.id }) }
    );
    expect(unauthRes.status).toBe(401);

    // 2. Student -> 403
    getCurrentUserMock.mockResolvedValue({
      id: studentId,
      email: `sdup-s-${suffix}@classpulse.local`,
      institutionalId: `SDS-${suffix}`,
      fullName: "Duplication Test Student",
      role: "STUDENT",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    const studentRes = await duplicateSubject(
      new Request(`http://localhost/api/subjects/${source.id}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "BSCS-1B" }),
      }),
      { params: Promise.resolve({ id: source.id }) }
    );
    expect(studentRes.status).toBe(403);

    // 3. Non-owner teacher -> 403
    getCurrentUserMock.mockResolvedValue({
      id: otherTeacherId,
      email: `sdup-t2-${suffix}@classpulse.local`,
      institutionalId: `SDT2-${suffix}`,
      fullName: "Other Teacher",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    const otherRes = await duplicateSubject(
      new Request(`http://localhost/api/subjects/${source.id}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "BSCS-1B" }),
      }),
      { params: Promise.resolve({ id: source.id }) }
    );
    expect(otherRes.status).toBe(403);

    // 4. Owning teacher with same section (case-insensitive) -> 400
    getCurrentUserMock.mockResolvedValue({
      id: teacherId,
      email: `sdup-t1-${suffix}@classpulse.local`,
      institutionalId: `SDT1-${suffix}`,
      fullName: "Duplication Owner Teacher",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    const sameRes = await duplicateSubject(
      new Request(`http://localhost/api/subjects/${source.id}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "  bscs-1a  " }),
      }),
      { params: Promise.resolve({ id: source.id }) }
    );
    expect(sameRes.status).toBe(400);

    // 5. Owning teacher with new section -> 201
    const dupRes = await duplicateSubject(
      new Request(`http://localhost/api/subjects/${source.id}/duplicate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ section: "BSCS-1B" }),
      }),
      { params: Promise.resolve({ id: source.id }) }
    );
    expect(dupRes.status).toBe(201);
    const dupJson = (await dupRes.json()) as {
      subject: {
        id: string;
        code: string;
        title: string;
        section: string;
        termId: string;
        inviteCode: string;
        isArchived: boolean;
      };
      copied: {
        gradeCategories: number;
        gradeScaleRules: number;
        meritPresets: number;
        rewardItems: number;
      };
    };
    createdSubjectIds.push(dupJson.subject.id);

    expect(dupJson.subject.id).not.toBe(source.id);
    expect(dupJson.subject.code).toBe(source.code);
    expect(dupJson.subject.title).toBe(source.title);
    expect(dupJson.subject.section).toBe("BSCS-1B");
    expect(dupJson.subject.termId).toBe(termId);
    expect(dupJson.subject.isArchived).toBe(false);
    expect(dupJson.subject.inviteCode).not.toBe(source.inviteCode);
    expect(dupJson.copied).toEqual({
      gradeCategories: 2,
      gradeScaleRules: 2,
      meritPresets: 2,
      rewardItems: 2,
    });

    // Verify full persisted clone & isolation
    const cloned = await db.subject.findUniqueOrThrow({
      where: { id: dupJson.subject.id },
      include: {
        gradeCategories: { orderBy: { sortOrder: "asc" } },
        gradeScaleRules: { orderBy: { sortOrder: "asc" } },
        meritPresets: { orderBy: { name: "asc" } },
        rewardItems: { orderBy: { pointCostPerUnit: "asc" } },
      },
    });

    expect(cloned.startDate?.toISOString()).toBe("2026-08-15T00:00:00.000Z");
    expect(cloned.endDate?.toISOString()).toBe("2026-12-15T00:00:00.000Z");
    expect(cloned.allowNegativeBalance).toBe(true);
    expect(cloned.allowP2pTransfers).toBe(false);
    expect(cloned.p2pMaxPerTransfer).toBe(25);
    expect(cloned.p2pMaxPerDay).toBe(50);
    expect(cloned.p2pMaxPerTerm).toBe(200);
    expect(cloned.allowOpenRedemptions).toBe(true);
    expect(cloned.standingVisible).toBe(false);
    expect(cloned.requireGapFreeGradeScale).toBe(false);
    expect(Number(cloned.lateAttendanceCreditPct)).toBe(75);
    expect(cloned.termSplitConfig).toEqual(termSplitConfig);

    expect(cloned.gradeCategories).toHaveLength(2);
    const clonedQuizzesCategory = cloned.gradeCategories.find(
      (c) => c.name === "Quizzes"
    );
    expect(clonedQuizzesCategory).toBeDefined();
    expect(clonedQuizzesCategory?.id).not.toBe(quizzesCategory.id);
    expect(Number(clonedQuizzesCategory?.weightPct)).toBe(60);
    expect(clonedQuizzesCategory?.aggregationMethod).toBe("EQUAL_AVERAGE");
    expect(
      cloned.gradeCategories.some((c) => c.id === attendanceCategory.id)
    ).toBe(false);

    expect(cloned.gradeScaleRules).toHaveLength(2);
    expect(cloned.gradeScaleRules[0]?.gradeEquivalent).toBe("1.00");

    expect(cloned.meritPresets).toHaveLength(2);
    expect(cloned.meritPresets.some((p) => p.name === "Recitation")).toBe(true);
    expect(
      cloned.meritPresets.find((p) => p.name === "Old Penalty")?.isArchived
    ).toBe(true);

    expect(cloned.rewardItems).toHaveLength(2);
    const clonedBoostReward = cloned.rewardItems.find(
      (r) => r.name === "Quiz Boost +2"
    );
    expect(clonedBoostReward?.eligibleCategoryIds).toEqual([
      clonedQuizzesCategory!.id,
    ]);
    expect(clonedBoostReward?.eligibleCategoryIds).not.toContain(
      quizzesCategory.id
    );
    expect(clonedBoostReward?.allowExtraCredit).toBe(true);
    expect(Number(clonedBoostReward?.maxBoostPerAssessment)).toBe(4);
    expect(
      cloned.rewardItems.find((r) => r.name === "Homework Pass")?.isActive
    ).toBe(false);

    // Ensure assessments and student runtime records were NOT copied
    expect(
      await db.assessment.count({ where: { subjectId: cloned.id } })
    ).toBe(0);
    expect(
      await db.subjectEnrollment.count({ where: { subjectId: cloned.id } })
    ).toBe(0);
    expect(
      await db.pointLedgerEntry.count({ where: { subjectId: cloned.id } })
    ).toBe(0);
    expect(
      await db.attendanceSession.count({ where: { subjectId: cloned.id } })
    ).toBe(0);
    expect(
      await db.redemptionRequest.count({ where: { subjectId: cloned.id } })
    ).toBe(0);
    expect(
      await db.notification.count({ where: { subjectId: cloned.id } })
    ).toBe(0);

    // Audit log recorded
    const audit = await db.auditLog.findFirst({
      where: {
        action: "SUBJECT_DUPLICATED",
        targetId: cloned.id,
      },
    });
    expect(audit).not.toBeNull();
  });
});
