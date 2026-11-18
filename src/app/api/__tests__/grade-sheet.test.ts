import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.fn();

const subjectFindUniqueMock = vi.fn();
const gradeCategoryFindManyMock = vi.fn();
const assessmentFindManyMock = vi.fn();
const gradeScaleRuleFindManyMock = vi.fn();
const subjectEnrollmentFindManyMock = vi.fn();
const assessmentScoreFindManyMock = vi.fn();
const attendanceRecordFindManyMock = vi.fn();
const pointLedgerCountMock = vi.fn();
const pointLedgerGroupByMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    subject: { findUnique: subjectFindUniqueMock },
    gradeCategory: { findMany: gradeCategoryFindManyMock },
    assessment: { findMany: assessmentFindManyMock },
    gradeScaleRule: { findMany: gradeScaleRuleFindManyMock },
    subjectEnrollment: { findMany: subjectEnrollmentFindManyMock },
    assessmentScore: { findMany: assessmentScoreFindManyMock },
    attendanceRecord: { findMany: attendanceRecordFindManyMock },
    pointLedgerEntry: {
      count: pointLedgerCountMock,
      groupBy: pointLedgerGroupByMock,
    },
  },
}));

const SUBJECT_ID = "11111111-1111-4111-8111-111111111111";
const CAT_ID = "22222222-2222-4222-8222-222222222222";
const ASSESSMENT_ID = "33333333-3333-4333-8333-333333333333";
const ENROLL_ID = "44444444-4444-4444-8444-444444444444";

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

function buildSubject(overrides?: Record<string, unknown>) {
  return {
    id: SUBJECT_ID,
    teacherId: "teacher-1",
    termId: "term-1",
    code: "CS 101",
    title: "Intro to Computing",
    section: "1A",
    startDate: new Date("2026-08-18T00:00:00.000Z"),
    endDate: new Date("2026-12-18T00:00:00.000Z"),
    inviteCode: "CS101SEC",
    isArchived: false,
    standingVisible: true,
    requireGapFreeGradeScale: true,
    lateAttendanceCreditPct: 50,
    termSplitConfig: null,
    teacher: {
      fullName: "Prof. Santos",
      email: "teacher1@classpulse.local",
    },
    term: {
      name: "AY 2026-2027 1st Sem",
    },
    ...overrides,
  };
}

describe("GET /api/subjects/[id]/grade-sheet", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects unauthenticated requests with 401", async () => {
    getCurrentUserMock.mockResolvedValue(null);
    const { GET } = await import("@/app/api/subjects/[id]/grade-sheet/route");

    const res = await GET(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/grade-sheet`),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );

    expect(res.status).toBe(401);
  });

  it("rejects students and non-owning teachers with 403", async () => {
    getCurrentUserMock.mockResolvedValue(studentSession());
    const { GET } = await import("@/app/api/subjects/[id]/grade-sheet/route");

    const studentRes = await GET(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/grade-sheet`),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(studentRes.status).toBe(403);

    getCurrentUserMock.mockResolvedValue(teacherSession("other-teacher"));
    subjectFindUniqueMock.mockResolvedValue(buildSubject());

    const otherTeacherRes = await GET(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/grade-sheet`),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(otherTeacherRes.status).toBe(403);
  });

  it("rejects malformed enrollmentId with 400 and missing enrollment with 404", async () => {
    getCurrentUserMock.mockResolvedValue(teacherSession());
    subjectFindUniqueMock.mockResolvedValue(buildSubject());
    const { GET } = await import("@/app/api/subjects/[id]/grade-sheet/route");

    const invalidRes = await GET(
      new Request(
        `http://localhost/api/subjects/${SUBJECT_ID}/grade-sheet?enrollmentId=bad-id`
      ),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(invalidRes.status).toBe(400);

    gradeCategoryFindManyMock.mockResolvedValue([]);
    assessmentFindManyMock.mockResolvedValue([]);
    gradeScaleRuleFindManyMock.mockResolvedValue([]);
    subjectEnrollmentFindManyMock.mockResolvedValue([]);
    pointLedgerCountMock.mockResolvedValue(0);

    const missingEnrollRes = await GET(
      new Request(
        `http://localhost/api/subjects/${SUBJECT_ID}/grade-sheet?enrollmentId=${ENROLL_ID}`
      ),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(missingEnrollRes.status).toBe(404);
  });

  it("downloads full class grade sheet CSV for owning teacher (even when archived)", async () => {
    getCurrentUserMock.mockResolvedValue(teacherSession());
    subjectFindUniqueMock.mockResolvedValue(buildSubject({ isArchived: true }));
    gradeCategoryFindManyMock.mockResolvedValue([
      {
        id: CAT_ID,
        subjectId: SUBJECT_ID,
        termKey: "DEFAULT",
        name: "Quizzes",
        categoryType: "ASSESSMENT",
        weightPct: 100,
        aggregationMethod: "TOTAL_POINTS",
        targetPointsCap: null,
        sortOrder: 0,
      },
    ]);
    assessmentFindManyMock.mockResolvedValue([
      {
        id: ASSESSMENT_ID,
        categoryId: CAT_ID,
        title: "Quiz 1",
        maxScore: 50,
        assessmentDate: new Date("2026-09-10T00:00:00.000Z"),
      },
    ]);
    gradeScaleRuleFindManyMock.mockResolvedValue([]);
    subjectEnrollmentFindManyMock.mockResolvedValue([
      {
        id: ENROLL_ID,
        enrolledAt: new Date("2026-08-19T00:00:00.000Z"),
        availableBalance: 20,
        escrowedBalance: 5,
        manualStandingOverride: "NONE",
        student: {
          id: "student-1",
          fullName: "Student One",
          email: "student1@classpulse.local",
          institutionalId: "2026-0001",
        },
      },
    ]);
    assessmentScoreFindManyMock.mockResolvedValue([
      {
        enrollmentId: ENROLL_ID,
        assessmentId: ASSESSMENT_ID,
        status: "GRADED",
        rawScore: 46,
        bonusPoints: 2,
        allowExtraCredit: false,
        remarks: "Great improvement",
      },
    ]);
    attendanceRecordFindManyMock.mockResolvedValue([
      { enrollmentId: ENROLL_ID, status: "PRESENT" },
    ]);
    pointLedgerCountMock.mockResolvedValue(1);
    pointLedgerGroupByMock.mockResolvedValue([
      { enrollmentId: ENROLL_ID, _sum: { availableDelta: 25 } },
    ]);

    const { GET } = await import("@/app/api/subjects/[id]/grade-sheet/route");
    const res = await GET(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/grade-sheet`),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="CS-101-1A-grade-sheet-\d{4}-\d{2}-\d{2}\.csv"$/
    );

    const csv = await res.text();
    expect(csv).toContain("Full Class Grade Sheet");
    expect(csv).toContain("Student One");
    expect(csv).toContain("96.00%,1.25,Superior,Passing,NONE,96.00%,1.25");
    expect(csv).toContain("GRADED,46,2,48,96.00%,Great improvement");
  });

  it("downloads individual student grade sheet CSV when enrollmentId is specified", async () => {
    getCurrentUserMock.mockResolvedValue(teacherSession());
    subjectFindUniqueMock.mockResolvedValue(buildSubject());
    gradeCategoryFindManyMock.mockResolvedValue([
      {
        id: CAT_ID,
        subjectId: SUBJECT_ID,
        termKey: "DEFAULT",
        name: "Quizzes",
        categoryType: "ASSESSMENT",
        weightPct: 100,
        aggregationMethod: "TOTAL_POINTS",
        targetPointsCap: null,
        sortOrder: 0,
      },
    ]);
    assessmentFindManyMock.mockResolvedValue([
      {
        id: ASSESSMENT_ID,
        categoryId: CAT_ID,
        title: "Quiz 1",
        maxScore: 50,
        assessmentDate: new Date("2026-09-10T00:00:00.000Z"),
      },
    ]);
    gradeScaleRuleFindManyMock.mockResolvedValue([]);
    subjectEnrollmentFindManyMock.mockResolvedValue([
      {
        id: ENROLL_ID,
        enrolledAt: new Date("2026-08-19T00:00:00.000Z"),
        availableBalance: 20,
        escrowedBalance: 5,
        manualStandingOverride: "NONE",
        student: {
          id: "student-1",
          fullName: "Student One",
          email: "student1@classpulse.local",
          institutionalId: "2026-0001",
        },
      },
    ]);
    assessmentScoreFindManyMock.mockResolvedValue([
      {
        enrollmentId: ENROLL_ID,
        assessmentId: ASSESSMENT_ID,
        status: "GRADED",
        rawScore: 46,
        bonusPoints: 2,
        allowExtraCredit: false,
        remarks: "Great improvement",
      },
    ]);
    attendanceRecordFindManyMock.mockResolvedValue([
      { enrollmentId: ENROLL_ID, status: "PRESENT" },
    ]);
    pointLedgerCountMock.mockResolvedValue(1);
    pointLedgerGroupByMock.mockResolvedValue([
      { enrollmentId: ENROLL_ID, _sum: { availableDelta: 25 } },
    ]);

    const { GET } = await import("@/app/api/subjects/[id]/grade-sheet/route");
    const res = await GET(
      new Request(
        `http://localhost/api/subjects/${SUBJECT_ID}/grade-sheet?enrollmentId=${ENROLL_ID}`
      ),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-disposition")).toMatch(
      /^attachment; filename="CS-101-1A-2026-0001-Student-One-grade-sheet-\d{4}-\d{2}-\d{2}\.csv"$/
    );

    const csv = await res.text();
    expect(csv).toContain("Individual Student Grade Sheet");
    expect(csv).toContain("Overall Percentage,96.00%");
    expect(csv).toContain("Grade Scale Equivalent,1.25");
    expect(csv).toContain("Quiz 1,2026-09-10,50,GRADED,46,2,No,48,96.00%,Yes,Great improvement");
  });
});
