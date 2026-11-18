import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.fn();
const subjectFindUniqueMock = vi.fn();
const subjectFindManyMock = vi.fn();
const subjectUpdateMock = vi.fn();
const subjectDeleteManyMock = vi.fn();
const teacherInviteFindUniqueMock = vi.fn();
const teacherInviteUpdateManyMock = vi.fn();
const userFindUniqueMock = vi.fn();
const userCreateMock = vi.fn();
const subjectEnrollmentFindUniqueMock = vi.fn();
const subjectEnrollmentFindManyMock = vi.fn();
const subjectEnrollmentCreateMock = vi.fn();
const subjectEnrollmentDeleteManyMock = vi.fn();
const assessmentDeleteManyMock = vi.fn();
const redemptionDeleteManyMock = vi.fn();
const ledgerDeleteManyMock = vi.fn();
const notificationDeleteManyMock = vi.fn();
const auditCreateMock = vi.fn();
const ensureDeviceCookieMock = vi.fn();
const setSessionCookieMock = vi.fn();

const txClient = {
  teacherInviteCode: {
    findUnique: teacherInviteFindUniqueMock,
    updateMany: teacherInviteUpdateManyMock,
  },
  user: {
    create: userCreateMock,
  },
  subject: {
    update: subjectUpdateMock,
    deleteMany: subjectDeleteManyMock,
  },
  subjectEnrollment: {
    create: subjectEnrollmentCreateMock,
    deleteMany: subjectEnrollmentDeleteManyMock,
  },
  assessment: {
    deleteMany: assessmentDeleteManyMock,
  },
  redemptionRequest: {
    deleteMany: redemptionDeleteManyMock,
  },
  pointLedgerEntry: {
    deleteMany: ledgerDeleteManyMock,
  },
  notification: {
    deleteMany: notificationDeleteManyMock,
  },
  auditLog: {
    create: auditCreateMock,
  },
};

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: getCurrentUserMock,
  setSessionCookie: setSessionCookieMock,
}));

vi.mock("@/lib/device/token", () => ({
  ensureDeviceCookie: ensureDeviceCookieMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: userFindUniqueMock,
    },
    subject: {
      findUnique: subjectFindUniqueMock,
      findMany: subjectFindManyMock,
    },
    subjectEnrollment: {
      findUnique: subjectEnrollmentFindUniqueMock,
      findMany: subjectEnrollmentFindManyMock,
    },
    auditLog: {
      create: auditCreateMock,
    },
    $transaction: async (cb: (tx: typeof txClient) => Promise<unknown>) =>
      cb(txClient),
  },
}));

const SUBJECT_UUID = "11111111-1111-4111-8111-111111111111";

describe("Phase 1 RBAC, Teacher Gating & Subject Isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ensureDeviceCookieMock.mockResolvedValue({
      token: "dev.sig",
      deviceId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("blocks STUDENT from creating subjects or hitting teacher/admin endpoints", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: "student-1",
      email: "s1@classpulse.local",
      institutionalId: "2026-0001",
      fullName: "Student One",
      role: "STUDENT",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    const { POST: createSubject } = await import("@/app/api/subjects/route");
    const createRes = await createSubject(
      new Request("http://localhost/api/subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: "CS 101",
          title: "Intro",
          section: "A",
        }),
      })
    );
    expect(createRes.status).toBe(403);

    const { GET: getRoster } = await import(
      "@/app/api/subjects/[id]/roster/route"
    );
    const rosterRes = await getRoster(
      new Request(`http://localhost/api/subjects/${SUBJECT_UUID}/roster`),
      { params: Promise.resolve({ id: SUBJECT_UUID }) }
    );
    expect(rosterRes.status).toBe(403);

    const { GET: getAdminTeachers } = await import(
      "@/app/api/admin/teachers/route"
    );
    const adminRes = await getAdminTeachers();
    expect(adminRes.status).toBe(403);
  });

  it("blocks TEACHER A from mutating TEACHER B's subject or roster", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: "teacher-a",
      email: "ta@classpulse.local",
      institutionalId: "EMP-1",
      fullName: "Teacher A",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    subjectFindUniqueMock.mockResolvedValue({
      id: SUBJECT_UUID,
      teacherId: "teacher-b",
      termId: "term-1",
      code: "IT 204",
      title: "Info Mgmt",
      section: "B",
      inviteCode: "IT204SEC",
      isArchived: false,
    });

    const { PATCH: patchSubject } = await import(
      "@/app/api/subjects/[id]/route"
    );
    const patchRes = await patchSubject(
      new Request(`http://localhost/api/subjects/${SUBJECT_UUID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: "Hacked Title" }),
      }),
      { params: Promise.resolve({ id: SUBJECT_UUID }) }
    );
    expect(patchRes.status).toBe(403);

    const { POST: addRoster } = await import(
      "@/app/api/subjects/[id]/roster/route"
    );
    const rosterRes = await addRoster(
      new Request(`http://localhost/api/subjects/${SUBJECT_UUID}/roster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: "student1@classpulse.local" }),
      }),
      { params: Promise.resolve({ id: SUBJECT_UUID }) }
    );
    expect(rosterRes.status).toBe(403);
  });

  it("rejects invalid teacher invite codes and creates PENDING teacher when invite code is omitted", async () => {
    userFindUniqueMock.mockResolvedValue(null);
    teacherInviteFindUniqueMock.mockResolvedValue(null);

    const { POST: register } = await import("@/app/api/auth/register/route");

    const invalidRes = await register(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: "New Teacher",
          email: "newteacher@classpulse.local",
          password: "Password123!",
          accountType: "TEACHER",
          inviteCode: "BAD-CODE-999",
        }),
      })
    );
    expect(invalidRes.status).toBe(400);
    const invalidJson = (await invalidRes.json()) as { code: string };
    expect(invalidJson.code).toBe("ERR_INVALID_INVITE");

    userCreateMock.mockResolvedValueOnce({
      id: "pending-teacher-1",
      email: "pending@classpulse.local",
      institutionalId: null,
      fullName: "Pending Teacher",
      role: "TEACHER",
      status: "PENDING",
      sessionVersion: 1,
      createdAt: new Date(),
    });

    const pendingRes = await register(
      new Request("http://localhost/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: "Pending Teacher",
          email: "pending@classpulse.local",
          password: "Password123!",
          accountType: "TEACHER",
        }),
      })
    );
    expect(pendingRes.status).toBe(201);
    const pendingJson = (await pendingRes.json()) as {
      pendingApproval: boolean;
      user: { status: string };
    };
    expect(pendingJson.pendingApproval).toBe(true);
    expect(pendingJson.user.status).toBe("PENDING");
    expect(setSessionCookieMock).not.toHaveBeenCalled();
  });

  it("initializes an isolated 0/0 wallet when a student joins a subject", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: "student-6",
      email: "student6@classpulse.local",
      institutionalId: "2026-0006",
      fullName: "Student 6",
      role: "STUDENT",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    subjectFindUniqueMock.mockResolvedValue({
      id: SUBJECT_UUID,
      code: "CS 101",
      title: "Intro to Computing",
      section: "BSCS-1A",
      isArchived: false,
      teacher: { fullName: "Prof. Elena Santos" },
      term: { name: "1st Sem 2026-2027" },
    });
    subjectEnrollmentFindUniqueMock.mockResolvedValue(null);
    subjectEnrollmentCreateMock.mockResolvedValue({
      id: "enroll-6",
      subjectId: SUBJECT_UUID,
      studentId: "student-6",
      availableBalance: 0,
      escrowedBalance: 0,
      manualStandingOverride: "NONE",
    });

    const { POST: joinSubject } = await import("@/app/api/subjects/join/route");
    const joinRes = await joinSubject(
      new Request("http://localhost/api/subjects/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inviteCode: "cs101sec" }),
      })
    );

    expect(joinRes.status).toBe(201);
    const data = (await joinRes.json()) as {
      enrollment: { availableBalance: number; escrowedBalance: number };
    };
    expect(data.enrollment.availableBalance).toBe(0);
    expect(data.enrollment.escrowedBalance).toBe(0);
    expect(subjectEnrollmentCreateMock).toHaveBeenCalledWith({
      data: {
        subjectId: SUBJECT_UUID,
        studentId: "student-6",
        availableBalance: 0,
        escrowedBalance: 0,
      },
    });
  });

  it("enforces ownership/admin RBAC and clears enrollments & points on DELETE /api/subjects/[id]", async () => {
    const { DELETE: deleteSubject, PATCH: patchSubject } = await import(
      "@/app/api/subjects/[id]/route"
    );

    // 1. STUDENT is blocked (403)
    getCurrentUserMock.mockResolvedValue({
      id: "student-1",
      email: "s1@classpulse.local",
      institutionalId: "2026-0001",
      fullName: "Student One",
      role: "STUDENT",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    const studentRes = await deleteSubject(
      new Request(`http://localhost/api/subjects/${SUBJECT_UUID}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: SUBJECT_UUID }) }
    );
    expect(studentRes.status).toBe(403);

    // 2. Non-owner TEACHER is blocked (403)
    getCurrentUserMock.mockResolvedValue({
      id: "teacher-a",
      email: "ta@classpulse.local",
      institutionalId: "EMP-1",
      fullName: "Teacher A",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    subjectFindUniqueMock.mockResolvedValue({
      id: SUBJECT_UUID,
      teacherId: "teacher-b",
      termId: "term-1",
      code: "IT 204",
      title: "Info Mgmt",
      section: "B",
      startDate: new Date("2026-08-10T00:00:00.000Z"),
      endDate: new Date("2026-12-18T00:00:00.000Z"),
      inviteCode: "IT204SEC",
      isArchived: false,
    });
    const otherTeacherRes = await deleteSubject(
      new Request(`http://localhost/api/subjects/${SUBJECT_UUID}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: SUBJECT_UUID }) }
    );
    expect(otherTeacherRes.status).toBe(403);

    // 3. Owning TEACHER rejects invalid date order on PATCH
    getCurrentUserMock.mockResolvedValue({
      id: "teacher-b",
      email: "tb@classpulse.local",
      institutionalId: "EMP-2",
      fullName: "Teacher B",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    const badDatesRes = await patchSubject(
      new Request(`http://localhost/api/subjects/${SUBJECT_UUID}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: "2026-12-20",
          endDate: "2026-08-10",
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_UUID }) }
    );
    expect(badDatesRes.status).toBe(400);

    // 4. Owning TEACHER deletes section and unenrolls students + points
    subjectEnrollmentFindManyMock.mockResolvedValue([
      {
        id: "enroll-1",
        studentId: "student-1",
        availableBalance: 25,
        escrowedBalance: 5,
      },
      {
        id: "enroll-2",
        studentId: "student-2",
        availableBalance: 10,
        escrowedBalance: 0,
      },
    ]);

    notificationDeleteManyMock.mockResolvedValue({ count: 3 });

    const ownerDeleteRes = await deleteSubject(
      new Request(`http://localhost/api/subjects/${SUBJECT_UUID}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: SUBJECT_UUID }) }
    );
    expect(ownerDeleteRes.status).toBe(200);
    const ownerDeleteJson = (await ownerDeleteRes.json()) as {
      ok: boolean;
      unenrolledCount: number;
      clearedPointsTotal: number;
      notificationsDeleted: number;
    };
    expect(ownerDeleteJson).toEqual({
      ok: true,
      unenrolledCount: 2,
      clearedPointsTotal: 40,
      notificationsDeleted: 3,
    });
    expect(assessmentDeleteManyMock).toHaveBeenCalledWith({
      where: { subjectId: { in: [SUBJECT_UUID] } },
    });
    expect(redemptionDeleteManyMock).toHaveBeenCalledWith({
      where: { subjectId: { in: [SUBJECT_UUID] } },
    });
    expect(ledgerDeleteManyMock).toHaveBeenCalledWith({
      where: { subjectId: { in: [SUBJECT_UUID] } },
    });
    expect(subjectEnrollmentDeleteManyMock).toHaveBeenCalledWith({
      where: { subjectId: { in: [SUBJECT_UUID] } },
    });
    expect(notificationDeleteManyMock).toHaveBeenCalledWith({
      where: { subjectId: { in: [SUBJECT_UUID] } },
    });
    expect(subjectDeleteManyMock).toHaveBeenCalledWith({
      where: { id: { in: [SUBJECT_UUID] } },
    });

    // 5. ADMIN can also delete any section
    vi.clearAllMocks();
    getCurrentUserMock.mockResolvedValue({
      id: "admin-1",
      email: "admin@classpulse.local",
      institutionalId: "ADM-1",
      fullName: "Admin",
      role: "ADMIN",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    subjectFindUniqueMock.mockResolvedValue({
      id: SUBJECT_UUID,
      teacherId: "teacher-b",
      termId: "term-1",
      code: "IT 204",
      title: "Info Mgmt",
      section: "B",
      startDate: null,
      endDate: null,
      inviteCode: "IT204SEC",
      isArchived: false,
    });
    subjectEnrollmentFindManyMock.mockResolvedValue([]);
    notificationDeleteManyMock.mockResolvedValue({ count: 0 });
    const adminDeleteRes = await deleteSubject(
      new Request(`http://localhost/api/subjects/${SUBJECT_UUID}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: SUBJECT_UUID }) }
    );
    expect(adminDeleteRes.status).toBe(200);
  });

  it("enforces RBAC on POST /api/subjects/bulk-delete for teachers and admins", async () => {
    const { POST: bulkDelete } = await import(
      "@/app/api/subjects/bulk-delete/route"
    );
    const SECOND_UUID = "33333333-3333-4333-8333-333333333333";

    // 1. STUDENT blocked
    getCurrentUserMock.mockResolvedValue({
      id: "student-1",
      email: "s1@classpulse.local",
      institutionalId: "2026-0001",
      fullName: "Student One",
      role: "STUDENT",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    const studentRes = await bulkDelete(
      new Request("http://localhost/api/subjects/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectIds: [SUBJECT_UUID, SECOND_UUID] }),
      })
    );
    expect(studentRes.status).toBe(403);

    // 2. TEACHER blocked if any selected subject belongs to another teacher
    getCurrentUserMock.mockResolvedValue({
      id: "teacher-a",
      email: "ta@classpulse.local",
      institutionalId: "EMP-1",
      fullName: "Teacher A",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    subjectFindManyMock.mockResolvedValue([
      {
        id: SUBJECT_UUID,
        teacherId: "teacher-a",
        code: "CS 101",
        title: "Intro",
        section: "A",
        termId: "term-1",
        isArchived: false,
        startDate: null,
        endDate: null,
        enrollments: [],
      },
      {
        id: SECOND_UUID,
        teacherId: "teacher-b",
        code: "IT 204",
        title: "Info Mgmt",
        section: "B",
        termId: "term-1",
        isArchived: false,
        startDate: null,
        endDate: null,
        enrollments: [],
      },
    ]);
    const crossTeacherRes = await bulkDelete(
      new Request("http://localhost/api/subjects/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectIds: [SUBJECT_UUID, SECOND_UUID] }),
      })
    );
    expect(crossTeacherRes.status).toBe(403);

    // 3. ADMIN can bulk-delete selected sections across teachers
    getCurrentUserMock.mockResolvedValue({
      id: "admin-1",
      email: "admin@classpulse.local",
      institutionalId: "ADM-1",
      fullName: "Admin",
      role: "ADMIN",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    subjectFindManyMock.mockResolvedValue([
      {
        id: SUBJECT_UUID,
        teacherId: "teacher-a",
        code: "CS 101",
        title: "Intro",
        section: "A",
        termId: "term-1",
        isArchived: false,
        startDate: null,
        endDate: null,
        enrollments: [
          {
            id: "e-1",
            studentId: "student-1",
            availableBalance: 20,
            escrowedBalance: 0,
          },
        ],
      },
      {
        id: SECOND_UUID,
        teacherId: "teacher-b",
        code: "IT 204",
        title: "Info Mgmt",
        section: "B",
        termId: "term-1",
        isArchived: false,
        startDate: null,
        endDate: null,
        enrollments: [
          {
            id: "e-2",
            studentId: "student-2",
            availableBalance: 30,
            escrowedBalance: 5,
          },
        ],
      },
    ]);
    notificationDeleteManyMock.mockResolvedValue({ count: 4 });

    const adminRes = await bulkDelete(
      new Request("http://localhost/api/subjects/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subjectIds: [SUBJECT_UUID, SECOND_UUID] }),
      })
    );
    expect(adminRes.status).toBe(200);
    const adminJson = (await adminRes.json()) as {
      ok: boolean;
      deletedCount: number;
      unenrolledCount: number;
      clearedPointsTotal: number;
      notificationsDeleted: number;
    };
    expect(adminJson).toEqual({
      ok: true,
      deletedCount: 2,
      unenrolledCount: 2,
      clearedPointsTotal: 55,
      notificationsDeleted: 4,
    });
    expect(subjectDeleteManyMock).toHaveBeenCalledWith({
      where: { id: { in: [SUBJECT_UUID, SECOND_UUID] } },
    });
  });
});
