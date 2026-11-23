import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.fn();

const subjectFindUniqueMock = vi.fn();
const subjectCoTeacherFindUniqueMock = vi.fn();
const subjectEnrollmentFindUniqueMock = vi.fn();
const subjectEnrollmentFindManyMock = vi.fn();
const groupSetFindUniqueMock = vi.fn();
const groupSetFindFirstMock = vi.fn();
const groupSetFindManyMock = vi.fn();
const groupSetCreateMock = vi.fn();
const groupSetDeleteMock = vi.fn();
const studentGroupFindManyMock = vi.fn();
const studentGroupMembershipFindUniqueMock = vi.fn();
const assessmentFindUniqueMock = vi.fn();
const assessmentCountMock = vi.fn();
const assessmentScoreFindUniqueMock = vi.fn();
const assessmentScoreFindManyMock = vi.fn();
const assessmentScoreUpsertMock = vi.fn();
const assessmentSubmissionFindManyMock = vi.fn();
const groupAssessmentSubmissionFindUniqueMock = vi.fn();
const groupAssessmentSubmissionFindManyMock = vi.fn();
const groupAssessmentSubmissionUpsertMock = vi.fn();
const groupAssessmentSubmissionDeleteMock = vi.fn();
const groupAssessmentScoreFindUniqueMock = vi.fn();
const groupAssessmentScoreFindManyMock = vi.fn();
const groupAssessmentScoreUpsertMock = vi.fn();
const auditLogCreateMock = vi.fn();
const dispatchNotificationsMock = vi.fn();
const verifyGoogleDriveLinkAccessMock = vi.fn();

const txClient = {
  groupSet: { create: groupSetCreateMock, delete: groupSetDeleteMock },
  studentGroup: { create: vi.fn() },
  studentGroupMembership: { createMany: vi.fn() },
  subjectEnrollment: { findMany: subjectEnrollmentFindManyMock },
  groupAssessmentSubmission: {
    findUnique: groupAssessmentSubmissionFindUniqueMock,
    upsert: groupAssessmentSubmissionUpsertMock,
    delete: groupAssessmentSubmissionDeleteMock,
  },
  groupAssessmentScore: {
    upsert: groupAssessmentScoreUpsertMock,
  },
  assessmentScore: {
    upsert: assessmentScoreUpsertMock,
  },
  auditLog: { create: auditLogCreateMock },
};

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock("@/lib/notifications/dispatch", () => ({
  dispatchNotifications: dispatchNotificationsMock,
}));

vi.mock("@/lib/submissions/google-drive-link", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/submissions/google-drive-link")>();
  return {
    ...actual,
    verifyGoogleDriveLinkAccess: verifyGoogleDriveLinkAccessMock,
  };
});

vi.mock("@/lib/db", () => ({
  db: {
    subject: { findUnique: subjectFindUniqueMock },
    subjectCoTeacher: { findUnique: subjectCoTeacherFindUniqueMock },
    subjectEnrollment: {
      findUnique: subjectEnrollmentFindUniqueMock,
      findMany: subjectEnrollmentFindManyMock,
    },
    groupSet: {
      findUnique: groupSetFindUniqueMock,
      findFirst: groupSetFindFirstMock,
      findMany: groupSetFindManyMock,
    },
    studentGroup: { findMany: studentGroupFindManyMock },
    studentGroupMembership: {
      findUnique: studentGroupMembershipFindUniqueMock,
    },
    assessment: {
      findUnique: assessmentFindUniqueMock,
      count: assessmentCountMock,
    },
    assessmentScore: {
      findUnique: assessmentScoreFindUniqueMock,
      findMany: assessmentScoreFindManyMock,
    },
    assessmentSubmission: { findMany: assessmentSubmissionFindManyMock },
    groupAssessmentSubmission: {
      findUnique: groupAssessmentSubmissionFindUniqueMock,
      findMany: groupAssessmentSubmissionFindManyMock,
    },
    groupAssessmentScore: {
      findUnique: groupAssessmentScoreFindUniqueMock,
      findMany: groupAssessmentScoreFindManyMock,
    },
    $transaction: async (cb: (tx: typeof txClient) => Promise<unknown>) =>
      cb(txClient),
  },
}));

const SUBJECT_ID = "11111111-1111-4111-8111-111111111111";
const TEACHER_ID = "22222222-2222-4222-8222-222222222222";
const STUDENT_ID = "33333333-3333-4333-8333-333333333333";
const STUDENT_2_ID = "33333333-3333-4333-8333-333333333334";
const GROUP_SET_ID = "44444444-4444-4444-8444-444444444444";
const GROUP_ID = "55555555-5555-4555-8555-555555555555";
const ASSESSMENT_ID = "66666666-6666-4666-8666-666666666666";
const ENROLL_1_ID = "77777777-7777-4777-8777-777777777771";
const ENROLL_2_ID = "77777777-7777-4777-8777-777777777772";
const SUB_ID = "88888888-8888-4888-8888-888888888888";

const VALID_DRIVE_URL =
  "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view?usp=sharing";

describe("Group Mode APIs (Group Sets, Group Submissions, Group Grading)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subjectFindUniqueMock.mockResolvedValue({
      id: SUBJECT_ID,
      code: "CS 101",
      teacherId: TEACHER_ID,
      isArchived: false,
    });
    subjectCoTeacherFindUniqueMock.mockResolvedValue(null);
    verifyGoogleDriveLinkAccessMock.mockResolvedValue({
      accessStatus: "PUBLIC_VERIFIED",
      checkedAt: new Date("2026-11-23T05:00:00.000Z"),
    });
  });

  it("restricts Group Set deletion when referenced by assessments", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: TEACHER_ID,
      role: "TEACHER",
      status: "ACTIVE",
      fullName: "Prof. Cruz",
      email: "prof@classpulse.local",
    });
    groupSetFindUniqueMock.mockResolvedValue({
      id: GROUP_SET_ID,
      subjectId: SUBJECT_ID,
      name: "Lab Groups",
    });
    assessmentCountMock.mockResolvedValue(2);

    const { DELETE } = await import(
      "@/app/api/subjects/[id]/group-sets/[groupSetId]/route"
    );
    const res = await DELETE(
      new Request("http://localhost/api/subjects/x/group-sets/y", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: SUBJECT_ID, groupSetId: GROUP_SET_ID }) }
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("ERR_GROUP_SET_IN_USE");
  });

  it("blocks ungrouped students and lets group members submit/withdraw shared Drive links", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: STUDENT_ID,
      role: "STUDENT",
      status: "ACTIVE",
      fullName: "Alice Reyes",
      email: "alice@classpulse.local",
    });
    assessmentFindUniqueMock.mockResolvedValue({
      id: ASSESSMENT_ID,
      subjectId: SUBJECT_ID,
      title: "Group Lab 1",
      submissionEnabled: true,
      dueAt: null,
      allowLateSubmissions: true,
      requirePublicLink: true,
      isGroupMode: true,
      groupSetId: GROUP_SET_ID,
      subject: {
        id: SUBJECT_ID,
        code: "CS 101",
        teacherId: TEACHER_ID,
        isArchived: false,
      },
    });
    subjectEnrollmentFindUniqueMock.mockResolvedValue({
      id: ENROLL_1_ID,
      subjectId: SUBJECT_ID,
      studentId: STUDENT_ID,
    });
    assessmentScoreFindUniqueMock.mockResolvedValue(null);
    groupAssessmentScoreFindUniqueMock.mockResolvedValue(null);

    const { PUT, DELETE } = await import(
      "@/app/api/assessments/[id]/submission/route"
    );

    // 1. Ungrouped student is blocked
    studentGroupMembershipFindUniqueMock.mockResolvedValueOnce(null);
    const blockedRes = await PUT(
      new Request("http://localhost/api/assessments/x/submission", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveUrl: VALID_DRIVE_URL }),
      }),
      { params: Promise.resolve({ id: ASSESSMENT_ID }) }
    );
    expect(blockedRes.status).toBe(403);
    const blockedJson = (await blockedRes.json()) as { code?: string };
    expect(blockedJson.code).toBe("ERR_NO_GROUP_ASSIGNED");

    // 2. Group member submits for the group
    studentGroupMembershipFindUniqueMock.mockResolvedValue({
      id: "mem-1",
      groupSetId: GROUP_SET_ID,
      groupId: GROUP_ID,
      enrollmentId: ENROLL_1_ID,
      group: { id: GROUP_ID, name: "Group 1" },
    });
    groupAssessmentSubmissionFindUniqueMock.mockResolvedValue(null);
    groupAssessmentSubmissionUpsertMock.mockImplementation(
      async (args: { create: Record<string, unknown> }) => ({
        id: SUB_ID,
        ...args.create,
        submittedAt: new Date("2026-11-23T05:00:00.000Z"),
        updatedAt: new Date("2026-11-23T05:00:00.000Z"),
      })
    );

    const submitRes = await PUT(
      new Request("http://localhost/api/assessments/x/submission", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driveUrl: VALID_DRIVE_URL,
          studentNote: "Group 1 final file",
        }),
      }),
      { params: Promise.resolve({ id: ASSESSMENT_ID }) }
    );
    expect(submitRes.status).toBe(200);
    const submitJson = (await submitRes.json()) as {
      submission: { submittedByName?: string };
    };
    expect(submitJson.submission.submittedByName).toBe("Alice Reyes");
    expect(dispatchNotificationsMock).toHaveBeenCalledTimes(1);

    // 3. Locked when group score is GRADED
    groupAssessmentScoreFindUniqueMock.mockResolvedValueOnce({
      status: "GRADED",
    });
    const lockedRes = await DELETE(
      new Request("http://localhost/api/assessments/x/submission", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: ASSESSMENT_ID }) }
    );
    expect(lockedRes.status).toBe(409);

    // 4. Withdraw succeeds when pending
    groupAssessmentScoreFindUniqueMock.mockResolvedValueOnce({
      status: "PENDING",
    });
    groupAssessmentSubmissionFindUniqueMock.mockResolvedValueOnce({
      id: SUB_ID,
      normalizedUrl: VALID_DRIVE_URL,
    });
    const deleteRes = await DELETE(
      new Request("http://localhost/api/assessments/x/submission", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: ASSESSMENT_ID }) }
    );
    expect(deleteRes.status).toBe(200);
    expect(groupAssessmentSubmissionDeleteMock).toHaveBeenCalledTimes(1);
  });

  it("grades groups, syncs non-overridden members, and applies individual overrides", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: TEACHER_ID,
      role: "TEACHER",
      status: "ACTIVE",
      fullName: "Prof. Cruz",
      email: "prof@classpulse.local",
    });
    assessmentFindUniqueMock.mockResolvedValue({
      id: ASSESSMENT_ID,
      subjectId: SUBJECT_ID,
      categoryId: "cat-1",
      title: "Group Lab 1",
      description: null,
      maxScore: 50,
      assessmentDate: null,
      submissionEnabled: true,
      dueAt: null,
      allowLateSubmissions: true,
      requirePublicLink: true,
      isGroupMode: true,
      groupSetId: GROUP_SET_ID,
      groupSet: { id: GROUP_SET_ID, name: "Lab Groups" },
      category: { id: "cat-1", name: "Labs", termKey: "DEFAULT" },
      subject: {
        id: SUBJECT_ID,
        code: "CS 101",
        teacherId: TEACHER_ID,
        isArchived: false,
      },
    });
    studentGroupFindManyMock.mockResolvedValue([
      {
        id: GROUP_ID,
        groupSetId: GROUP_SET_ID,
        name: "Group 1",
        sortOrder: 0,
        memberships: [
          { enrollmentId: ENROLL_1_ID },
          { enrollmentId: ENROLL_2_ID },
        ],
      },
    ]);
    subjectEnrollmentFindManyMock.mockResolvedValue([
      { id: ENROLL_1_ID, studentId: STUDENT_ID },
      { id: ENROLL_2_ID, studentId: STUDENT_2_ID },
    ]);

    const { PUT } = await import("@/app/api/assessments/[id]/scores/route");
    const res = await PUT(
      new Request("http://localhost/api/assessments/x/scores", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          groupScores: [
            {
              groupId: GROUP_ID,
              status: "GRADED",
              rawScore: 46,
              remarks: "Solid presentation",
            },
          ],
          memberScores: [
            {
              enrollmentId: ENROLL_2_ID,
              isGroupOverride: true,
              status: "GRADED",
              rawScore: 40,
              remarks: "Missed part 2",
            },
          ],
        }),
      }),
      { params: Promise.resolve({ id: ASSESSMENT_ID }) }
    );

    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      ok: boolean;
      updatedGroupsCount: number;
      updatedCount: number;
    };
    expect(json.ok).toBe(true);
    expect(json.updatedGroupsCount).toBe(1);
    expect(json.updatedCount).toBe(2);

    expect(groupAssessmentScoreUpsertMock).toHaveBeenCalledTimes(1);
    expect(assessmentScoreUpsertMock).toHaveBeenCalledTimes(2);

    expect(assessmentScoreUpsertMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        update: expect.objectContaining({
          status: "GRADED",
          rawScore: 46,
          remarks: "Solid presentation",
          isGroupOverride: false,
        }),
      })
    );
    expect(assessmentScoreUpsertMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        update: expect.objectContaining({
          status: "GRADED",
          rawScore: 40,
          remarks: "Missed part 2",
          isGroupOverride: true,
        }),
      })
    );
    expect(dispatchNotificationsMock).toHaveBeenCalledTimes(1);
  });
});
