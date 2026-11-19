import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.fn();
const assessmentFindUniqueMock = vi.fn();
const subjectEnrollmentFindUniqueMock = vi.fn();
const assessmentScoreFindUniqueMock = vi.fn();
const assessmentSubmissionFindUniqueMock = vi.fn();
const assessmentSubmissionUpsertMock = vi.fn();
const assessmentSubmissionDeleteMock = vi.fn();
const auditLogCreateMock = vi.fn();
const dispatchNotificationsMock = vi.fn();
const verifyGoogleDriveLinkAccessMock = vi.fn();

const txClient = {
  assessmentSubmission: {
    findUnique: assessmentSubmissionFindUniqueMock,
    upsert: assessmentSubmissionUpsertMock,
    delete: assessmentSubmissionDeleteMock,
  },
  auditLog: {
    create: auditLogCreateMock,
  },
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
    assessment: { findUnique: assessmentFindUniqueMock },
    subjectEnrollment: { findUnique: subjectEnrollmentFindUniqueMock },
    assessmentScore: { findUnique: assessmentScoreFindUniqueMock },
    assessmentSubmission: { findUnique: assessmentSubmissionFindUniqueMock },
    $transaction: async (cb: (tx: typeof txClient) => Promise<unknown>) =>
      cb(txClient),
  },
}));

const SUBJECT_ID = "11111111-1111-4111-8111-111111111111";
const ASSESSMENT_ID = "22222222-2222-4222-8222-222222222222";
const STUDENT_ID = "33333333-3333-4333-8333-333333333333";
const TEACHER_ID = "44444444-4444-4444-8444-444444444444";
const ENROLLMENT_ID = "55555555-5555-4555-8555-555555555555";
const SUBMISSION_ID = "66666666-6666-4666-8666-666666666666";

const VALID_DRIVE_URL =
  "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view?usp=sharing";

function makeAssessment(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSESSMENT_ID,
    subjectId: SUBJECT_ID,
    title: "Lab Activity 1",
    submissionEnabled: true,
    dueAt: null,
    allowLateSubmissions: true,
    requirePublicLink: true,
    subject: {
      id: SUBJECT_ID,
      code: "CS 101",
      teacherId: TEACHER_ID,
      isArchived: false,
    },
    ...overrides,
  };
}

describe("Assessment Google Drive Submissions API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue({
      id: STUDENT_ID,
      role: "STUDENT",
      status: "ACTIVE",
      fullName: "Student One",
      email: "student1@classpulse.local",
    });
    assessmentFindUniqueMock.mockResolvedValue(makeAssessment());
    subjectEnrollmentFindUniqueMock.mockResolvedValue({
      id: ENROLLMENT_ID,
      subjectId: SUBJECT_ID,
      studentId: STUDENT_ID,
    });
    assessmentScoreFindUniqueMock.mockResolvedValue(null);
    assessmentSubmissionFindUniqueMock.mockResolvedValue(null);
    verifyGoogleDriveLinkAccessMock.mockResolvedValue({
      accessStatus: "PUBLIC_VERIFIED",
      checkedAt: new Date("2026-11-19T02:00:00.000Z"),
    });
    assessmentSubmissionUpsertMock.mockImplementation(
      async (args: {
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => ({
        id: SUBMISSION_ID,
        ...args.create,
        submittedAt: new Date("2026-11-19T02:00:00.000Z"),
        updatedAt: new Date("2026-11-19T02:00:00.000Z"),
      })
    );
  });

  it("blocks non-students, unenrolled students, disabled assessments, and graded submissions", async () => {
    const { PUT } = await import(
      "@/app/api/assessments/[id]/submission/route"
    );

    getCurrentUserMock.mockResolvedValueOnce({
      id: TEACHER_ID,
      role: "TEACHER",
      status: "ACTIVE",
    });
    const teacherRes = await PUT(
      new Request(`http://localhost/api/assessments/${ASSESSMENT_ID}/submission`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveUrl: VALID_DRIVE_URL }),
      }),
      { params: Promise.resolve({ id: ASSESSMENT_ID }) }
    );
    expect(teacherRes.status).toBe(403);

    subjectEnrollmentFindUniqueMock.mockResolvedValueOnce(null);
    const unenrolledRes = await PUT(
      new Request(`http://localhost/api/assessments/${ASSESSMENT_ID}/submission`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveUrl: VALID_DRIVE_URL }),
      }),
      { params: Promise.resolve({ id: ASSESSMENT_ID }) }
    );
    expect(unenrolledRes.status).toBe(403);

    assessmentFindUniqueMock.mockResolvedValueOnce(
      makeAssessment({ submissionEnabled: false })
    );
    const disabledRes = await PUT(
      new Request(`http://localhost/api/assessments/${ASSESSMENT_ID}/submission`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveUrl: VALID_DRIVE_URL }),
      }),
      { params: Promise.resolve({ id: ASSESSMENT_ID }) }
    );
    expect(disabledRes.status).toBe(403);
    expect(await disabledRes.json()).toMatchObject({
      code: "ERR_SUBMISSIONS_DISABLED",
    });

    assessmentScoreFindUniqueMock.mockResolvedValueOnce({ status: "GRADED" });
    const gradedRes = await PUT(
      new Request(`http://localhost/api/assessments/${ASSESSMENT_ID}/submission`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveUrl: VALID_DRIVE_URL }),
      }),
      { params: Promise.resolve({ id: ASSESSMENT_ID }) }
    );
    expect(gradedRes.status).toBe(409);
    expect(await gradedRes.json()).toMatchObject({
      code: "ERR_SUBMISSION_LOCKED",
    });
  });

  it("enforces Google Drive URLs, public-link checks, and optional school-workspace bypass", async () => {
    const { PUT } = await import(
      "@/app/api/assessments/[id]/submission/route"
    );

    const nonDriveRes = await PUT(
      new Request(`http://localhost/api/assessments/${ASSESSMENT_ID}/submission`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveUrl: "https://onedrive.live.com/123" }),
      }),
      { params: Promise.resolve({ id: ASSESSMENT_ID }) }
    );
    expect(nonDriveRes.status).toBe(400);

    verifyGoogleDriveLinkAccessMock.mockResolvedValueOnce({
      accessStatus: "PRIVATE_OR_RESTRICTED",
      checkedAt: new Date(),
      reason: "Restricted",
    });
    const privateRes = await PUT(
      new Request(`http://localhost/api/assessments/${ASSESSMENT_ID}/submission`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveUrl: VALID_DRIVE_URL }),
      }),
      { params: Promise.resolve({ id: ASSESSMENT_ID }) }
    );
    expect(privateRes.status).toBe(422);
    expect(await privateRes.json()).toMatchObject({
      code: "ERR_DRIVE_LINK_RESTRICTED",
    });

    // When teacher disables requirePublicLink (school Workspace), restricted link is accepted
    assessmentFindUniqueMock.mockResolvedValueOnce(
      makeAssessment({ requirePublicLink: false })
    );
    verifyGoogleDriveLinkAccessMock.mockResolvedValueOnce({
      accessStatus: "PRIVATE_OR_RESTRICTED",
      checkedAt: new Date(),
      reason: "Restricted",
    });
    const orgAllowedRes = await PUT(
      new Request(`http://localhost/api/assessments/${ASSESSMENT_ID}/submission`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveUrl: VALID_DRIVE_URL }),
      }),
      { params: Promise.resolve({ id: ASSESSMENT_ID }) }
    );
    expect(orgAllowedRes.status).toBe(200);
    expect(assessmentSubmissionUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          accessStatus: "PRIVATE_OR_RESTRICTED",
          status: "SUBMITTED",
        }),
      })
    );
  });

  it("handles deadline late-marking, hard close, and student withdrawal", async () => {
    const { PUT, DELETE } = await import(
      "@/app/api/assessments/[id]/submission/route"
    );

    // Past due with allowLateSubmissions = true -> LATE
    assessmentFindUniqueMock.mockResolvedValueOnce(
      makeAssessment({
        dueAt: new Date("2020-01-01T00:00:00.000Z"),
        allowLateSubmissions: true,
      })
    );
    const lateRes = await PUT(
      new Request(`http://localhost/api/assessments/${ASSESSMENT_ID}/submission`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          driveUrl: VALID_DRIVE_URL,
          studentNote: "Submitted slightly late",
        }),
      }),
      { params: Promise.resolve({ id: ASSESSMENT_ID }) }
    );
    expect(lateRes.status).toBe(200);
    expect(assessmentSubmissionUpsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "LATE",
          normalizedUrl:
            "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/view",
        }),
      })
    );
    expect(dispatchNotificationsMock).toHaveBeenCalledTimes(1);

    // Past due with allowLateSubmissions = false -> 400 ERR_SUBMISSION_PAST_DUE
    assessmentFindUniqueMock.mockResolvedValueOnce(
      makeAssessment({
        dueAt: new Date("2020-01-01T00:00:00.000Z"),
        allowLateSubmissions: false,
      })
    );
    const closedRes = await PUT(
      new Request(`http://localhost/api/assessments/${ASSESSMENT_ID}/submission`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ driveUrl: VALID_DRIVE_URL }),
      }),
      { params: Promise.resolve({ id: ASSESSMENT_ID }) }
    );
    expect(closedRes.status).toBe(400);
    expect(await closedRes.json()).toMatchObject({
      code: "ERR_SUBMISSION_PAST_DUE",
    });

    // Withdraw submission while PENDING
    assessmentSubmissionFindUniqueMock.mockResolvedValueOnce({
      id: SUBMISSION_ID,
      normalizedUrl: VALID_DRIVE_URL,
    });
    const deleteRes = await DELETE(
      new Request(`http://localhost/api/assessments/${ASSESSMENT_ID}/submission`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: ASSESSMENT_ID }) }
    );
    expect(deleteRes.status).toBe(200);
    expect(assessmentSubmissionDeleteMock).toHaveBeenCalledWith({
      where: { id: SUBMISSION_ID },
    });
  });
});
