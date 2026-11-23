import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.fn();
const subjectFindUniqueMock = vi.fn();
const userFindManyMock = vi.fn();
const subjectCoTeacherFindUniqueMock = vi.fn();
const subjectCoTeacherFindManyMock = vi.fn();
const subjectCoTeacherCreateManyMock = vi.fn();
const subjectCoTeacherDeleteMock = vi.fn();
const subjectMaterialFindManyMock = vi.fn();
const subjectMaterialFindUniqueMock = vi.fn();
const subjectMaterialCreateMock = vi.fn();
const subjectMaterialUpdateMock = vi.fn();
const subjectMaterialDeleteMock = vi.fn();
const subjectEnrollmentFindManyMock = vi.fn();
const gradeCategoryFindUniqueMock = vi.fn();
const assessmentCreateMock = vi.fn();
const auditCreateMock = vi.fn();
const dispatchNotificationsMock = vi.fn();
const verifyGoogleDriveLinkAccessMock = vi.fn();

const txClient = {
  subjectCoTeacher: {
    createMany: subjectCoTeacherCreateManyMock,
    delete: subjectCoTeacherDeleteMock,
  },
  subjectMaterial: {
    create: subjectMaterialCreateMock,
    update: subjectMaterialUpdateMock,
    delete: subjectMaterialDeleteMock,
  },
  assessment: {
    create: assessmentCreateMock,
  },
  auditLog: {
    create: auditCreateMock,
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
    subject: {
      findUnique: subjectFindUniqueMock,
    },
    user: {
      findMany: userFindManyMock,
    },
    subjectCoTeacher: {
      findUnique: subjectCoTeacherFindUniqueMock,
      findMany: subjectCoTeacherFindManyMock,
    },
    subjectMaterial: {
      findMany: subjectMaterialFindManyMock,
      findUnique: subjectMaterialFindUniqueMock,
    },
    subjectEnrollment: {
      findMany: subjectEnrollmentFindManyMock,
    },
    gradeCategory: {
      findUnique: gradeCategoryFindUniqueMock,
    },
    auditLog: {
      create: auditCreateMock,
    },
    $transaction: async (cb: (tx: typeof txClient) => Promise<unknown>) =>
      cb(txClient),
  },
}));

const SUBJECT_ID = "11111111-1111-4111-8111-111111111111";
const OWNER_ID = "22222222-2222-4222-8222-222222222222";
const CO_TEACHER_ID = "33333333-3333-4333-8333-333333333333";
const OTHER_TEACHER_ID = "44444444-4444-4444-8444-444444444444";
const STUDENT_ID = "55555555-5555-4555-8555-555555555555";
const MATERIAL_ID = "66666666-6666-4666-8666-666666666666";
const CO_TEACHER_ROW_ID = "77777777-7777-4777-8777-777777777777";
const CATEGORY_ID = "88888888-8888-4888-8888-888888888888";

describe("Co-Teachers & Subject Learning Materials APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    subjectFindUniqueMock.mockResolvedValue({
      id: SUBJECT_ID,
      teacherId: OWNER_ID,
      termId: "term-1",
      code: "CS 101",
      title: "Intro to Computing",
      section: "BSCS-1A",
      inviteCode: "CS101SEC",
      isArchived: false,
    });
  });

  it("allows primary owner to add and remove co-teachers and blocks co-teachers from managing co-teachers or student roster", async () => {
    const { POST: addCoTeachers } = await import(
      "@/app/api/subjects/[id]/co-teachers/route"
    );
    const { DELETE: removeCoTeacher } = await import(
      "@/app/api/subjects/[id]/co-teachers/[coTeacherId]/route"
    );
    const { POST: addStudentRoster } = await import(
      "@/app/api/subjects/[id]/roster/route"
    );
    const { PUT: putComputation } = await import(
      "@/app/api/subjects/[id]/computation/route"
    );

    // 1. Primary owner adds a co-teacher by email
    getCurrentUserMock.mockResolvedValue({
      id: OWNER_ID,
      email: "owner@classpulse.local",
      institutionalId: "T-001",
      fullName: "Prof. Owner",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    userFindManyMock.mockResolvedValue([
      {
        id: CO_TEACHER_ID,
        email: "coteacher@classpulse.local",
        institutionalId: "T-002",
        fullName: "Prof. Co-Teacher",
      },
    ]);
    subjectCoTeacherFindManyMock.mockResolvedValue([]);
    subjectCoTeacherCreateManyMock.mockResolvedValue({ count: 1 });

    const addRes = await addCoTeachers(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/co-teachers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rawText: "coteacher@classpulse.local, missing@classpulse.local",
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(addRes.status).toBe(200);
    const addJson = (await addRes.json()) as {
      added: { id: string }[];
      alreadyCoTeacher: { id: string }[];
      notFound: string[];
    };
    expect(addJson.added).toHaveLength(1);
    expect(addJson.added[0]?.id).toBe(CO_TEACHER_ID);
    expect(addJson.notFound).toEqual(["missing@classpulse.local"]);
    expect(dispatchNotificationsMock).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: CO_TEACHER_ID,
        subjectId: SUBJECT_ID,
        type: "CO_TEACHER_ADDED",
      }),
    ]);

    // 2. Co-teacher cannot add another co-teacher, enroll students, or edit computation rules
    getCurrentUserMock.mockResolvedValue({
      id: CO_TEACHER_ID,
      email: "coteacher@classpulse.local",
      institutionalId: "T-002",
      fullName: "Prof. Co-Teacher",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    subjectCoTeacherFindUniqueMock.mockResolvedValue({ id: CO_TEACHER_ROW_ID });

    const coTeacherAddRes = await addCoTeachers(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/co-teachers`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: "other@classpulse.local" }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(coTeacherAddRes.status).toBe(403);

    const coTeacherRosterRes = await addStudentRoster(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/roster`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rawText: "student1@classpulse.local" }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(coTeacherRosterRes.status).toBe(403);

    const coTeacherCompRes = await putComputation(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/computation`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lateAttendanceCreditPct: 50,
          termSplitConfig: null,
          categories: [],
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(coTeacherCompRes.status).toBe(403);

    // 3. Primary owner removes co-teacher
    getCurrentUserMock.mockResolvedValue({
      id: OWNER_ID,
      email: "owner@classpulse.local",
      institutionalId: "T-001",
      fullName: "Prof. Owner",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    subjectCoTeacherFindUniqueMock.mockResolvedValue({
      id: CO_TEACHER_ROW_ID,
      subjectId: SUBJECT_ID,
      teacherId: CO_TEACHER_ID,
      teacher: {
        id: CO_TEACHER_ID,
        fullName: "Prof. Co-Teacher",
        email: "coteacher@classpulse.local",
        institutionalId: "T-002",
      },
    });

    const delRes = await removeCoTeacher(
      new Request(
        `http://localhost/api/subjects/${SUBJECT_ID}/co-teachers/${CO_TEACHER_ROW_ID}`,
        { method: "DELETE" }
      ),
      {
        params: Promise.resolve({
          id: SUBJECT_ID,
          coTeacherId: CO_TEACHER_ROW_ID,
        }),
      }
    );
    expect(delRes.status).toBe(200);
    expect(subjectCoTeacherDeleteMock).toHaveBeenCalledWith({
      where: { id: CO_TEACHER_ROW_ID },
    });
  });

  it("allows co-teachers to create assessments and post/edit/delete Google Drive materials while notifying students", async () => {
    const { GET: listMaterials, POST: createMaterial } = await import(
      "@/app/api/subjects/[id]/materials/route"
    );
    const { PATCH: updateMaterial, DELETE: deleteMaterial } = await import(
      "@/app/api/subjects/[id]/materials/[materialId]/route"
    );
    const { POST: createAssessment } = await import(
      "@/app/api/subjects/[id]/assessments/route"
    );

    // Co-teacher session
    getCurrentUserMock.mockResolvedValue({
      id: CO_TEACHER_ID,
      email: "coteacher@classpulse.local",
      institutionalId: "T-002",
      fullName: "Prof. Co-Teacher",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    subjectCoTeacherFindUniqueMock.mockResolvedValue({ id: CO_TEACHER_ROW_ID });

    // 1. Co-teacher creates an assessment
    gradeCategoryFindUniqueMock.mockResolvedValue({
      id: CATEGORY_ID,
      subjectId: SUBJECT_ID,
      name: "Quizzes",
      termKey: "DEFAULT",
      categoryType: "ASSESSMENT",
    });
    assessmentCreateMock.mockResolvedValue({
      id: "assess-1",
      subjectId: SUBJECT_ID,
      categoryId: CATEGORY_ID,
      title: "Quiz 1",
      description: null,
      maxScore: 20,
      assessmentDate: null,
      submissionEnabled: false,
      dueAt: null,
      allowLateSubmissions: true,
      requirePublicLink: true,
      createdAt: new Date(),
      category: {
        id: CATEGORY_ID,
        name: "Quizzes",
        termKey: "DEFAULT",
        categoryType: "ASSESSMENT",
      },
    });
    subjectEnrollmentFindManyMock.mockResolvedValue([
      { studentId: STUDENT_ID },
    ]);

    const assessRes = await createAssessment(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/assessments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          categoryId: CATEGORY_ID,
          title: "Quiz 1",
          maxScore: 20,
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(assessRes.status).toBe(201);

    // 2. Co-teacher posts a Google Drive folder link for class materials
    const checkedAt = new Date();
    verifyGoogleDriveLinkAccessMock.mockResolvedValue({
      accessStatus: "PUBLIC_VERIFIED",
      checkedAt,
    });
    subjectMaterialCreateMock.mockResolvedValue({
      id: MATERIAL_ID,
      subjectId: SUBJECT_ID,
      uploadedByTeacherId: CO_TEACHER_ID,
      title: "Week 1 Lecture Slides & Code",
      topic: "Week 1",
      description: "Download the starter kit",
      driveUrl:
        "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz?usp=sharing",
      normalizedUrl:
        "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz",
      driveResourceId: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
      resourceType: "FOLDER",
      accessStatus: "PUBLIC_VERIFIED",
      accessCheckedAt: checkedAt,
      requirePublicLink: true,
      uploadedByTeacher: {
        id: CO_TEACHER_ID,
        fullName: "Prof. Co-Teacher",
        email: "coteacher@classpulse.local",
      },
      createdAt: checkedAt,
      updatedAt: checkedAt,
    });

    const postMatRes = await createMaterial(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Week 1 Lecture Slides & Code",
          topic: "Week 1",
          description: "Download the starter kit",
          driveUrl:
            "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz?usp=sharing",
          requirePublicLink: true,
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(postMatRes.status).toBe(201);
    const postMatJson = (await postMatRes.json()) as {
      material: {
        id: string;
        resourceType: string;
        normalizedUrl: string;
      };
    };
    expect(postMatJson.material.resourceType).toBe("FOLDER");
    expect(postMatJson.material.normalizedUrl).toBe(
      "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz"
    );
    expect(dispatchNotificationsMock).toHaveBeenCalledWith([
      expect.objectContaining({
        userId: STUDENT_ID,
        subjectId: SUBJECT_ID,
        type: "MATERIAL_POSTED",
        linkUrl: `/subjects/${SUBJECT_ID}/materials`,
      }),
    ]);

    // 3. Rejects private/restricted Drive link when requirePublicLink is true
    verifyGoogleDriveLinkAccessMock.mockResolvedValueOnce({
      accessStatus: "PRIVATE_OR_RESTRICTED",
      checkedAt,
      reason: "Restricted link",
    });
    const restrictedRes = await createMaterial(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/materials`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Private Slides",
          driveUrl:
            "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/view",
          requirePublicLink: true,
        }),
      }),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(restrictedRes.status).toBe(422);

    // 4. Co-teacher updates and deletes material
    subjectMaterialFindUniqueMock.mockResolvedValue({
      id: MATERIAL_ID,
      subjectId: SUBJECT_ID,
      uploadedByTeacherId: OWNER_ID,
      title: "Week 1 Lecture Slides & Code",
      topic: "Week 1",
      description: "Download the starter kit",
      driveUrl:
        "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz",
      normalizedUrl:
        "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz",
      driveResourceId: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
      resourceType: "FOLDER",
      accessStatus: "PUBLIC_VERIFIED",
      accessCheckedAt: checkedAt,
      requirePublicLink: true,
    });
    subjectMaterialUpdateMock.mockResolvedValue({
      id: MATERIAL_ID,
      subjectId: SUBJECT_ID,
      title: "Week 1 Updated Slides",
      topic: "Week 1",
      description: "Updated notes",
      driveUrl:
        "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz",
      normalizedUrl:
        "https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz",
      driveResourceId: "1AbCdEfGhIjKlMnOpQrStUvWxYz",
      resourceType: "FOLDER",
      accessStatus: "PUBLIC_VERIFIED",
      accessCheckedAt: checkedAt,
      requirePublicLink: true,
      uploadedByTeacher: {
        id: OWNER_ID,
        fullName: "Prof. Owner",
        email: "owner@classpulse.local",
      },
      createdAt: checkedAt,
      updatedAt: checkedAt,
    });

    const patchMatRes = await updateMaterial(
      new Request(
        `http://localhost/api/subjects/${SUBJECT_ID}/materials/${MATERIAL_ID}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: "Week 1 Updated Slides" }),
        }
      ),
      { params: Promise.resolve({ id: SUBJECT_ID, materialId: MATERIAL_ID }) }
    );
    expect(patchMatRes.status).toBe(200);

    const delMatRes = await deleteMaterial(
      new Request(
        `http://localhost/api/subjects/${SUBJECT_ID}/materials/${MATERIAL_ID}`,
        { method: "DELETE" }
      ),
      { params: Promise.resolve({ id: SUBJECT_ID, materialId: MATERIAL_ID }) }
    );
    expect(delMatRes.status).toBe(200);

    // 5. Unassigned teacher cannot view or post materials
    getCurrentUserMock.mockResolvedValue({
      id: OTHER_TEACHER_ID,
      email: "other@classpulse.local",
      institutionalId: "T-003",
      fullName: "Other Teacher",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    subjectCoTeacherFindUniqueMock.mockResolvedValue(null);

    const forbiddenGetRes = await listMaterials(
      new Request(`http://localhost/api/subjects/${SUBJECT_ID}/materials`),
      { params: Promise.resolve({ id: SUBJECT_ID }) }
    );
    expect(forbiddenGetRes.status).toBe(403);
  });
});
