import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

const getCurrentUserMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: getCurrentUserMock,
}));

describe("Subject Dates & Delete Section Integration (Real PostgreSQL)", () => {
  const suffix = randomUUID().slice(0, 8);
  let termId = "";
  let teacherId = "";
  let adminId = "";
  let studentId = "";
  const createdSubjectIds: string[] = [];

  beforeAll(async () => {
    const teacher = await db.user.create({
      data: {
        email: `sdel-t-${suffix}@classpulse.local`,
        institutionalId: `SDT-${suffix}`,
        passwordHash: "hash",
        fullName: "Section Delete Teacher",
        role: "TEACHER",
        status: "ACTIVE",
      },
    });
    teacherId = teacher.id;

    const admin = await db.user.create({
      data: {
        email: `sdel-a-${suffix}@classpulse.local`,
        institutionalId: `SDA-${suffix}`,
        passwordHash: "hash",
        fullName: "Section Delete Admin",
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
    adminId = admin.id;

    const student = await db.user.create({
      data: {
        email: `sdel-s-${suffix}@classpulse.local`,
        institutionalId: `SDS-${suffix}`,
        passwordHash: "hash",
        fullName: "Section Delete Student",
        role: "STUDENT",
        status: "ACTIVE",
      },
    });
    studentId = student.id;

    const term = await db.academicTerm.create({
      data: {
        name: `SDEL Term ${suffix}`,
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
      .deleteMany({ where: { actorUserId: { in: [teacherId, adminId] } } })
      .catch(() => undefined);
    if (termId) {
      await db.academicTerm
        .delete({ where: { id: termId } })
        .catch(() => undefined);
    }
    if (teacherId) {
      await db.user.delete({ where: { id: teacherId } }).catch(() => undefined);
    }
    if (adminId) {
      await db.user.delete({ where: { id: adminId } }).catch(() => undefined);
    }
    if (studentId) {
      await db.user.delete({ where: { id: studentId } }).catch(() => undefined);
    }
  });

  async function seedSectionWithStudentPointsAndAssessment(tag: string) {
    const subject = await db.subject.create({
      data: {
        teacherId,
        termId,
        code: `DEL-${tag}-${suffix}`,
        title: `Deletable Section ${tag}`,
        section: `SEC-${tag}`,
        startDate: new Date("2026-08-10T00:00:00.000Z"),
        endDate: new Date("2026-12-18T00:00:00.000Z"),
        inviteCode: `D${tag}${suffix.toUpperCase()}`.slice(0, 12),
      },
    });
    createdSubjectIds.push(subject.id);

    const enrollment = await db.subjectEnrollment.create({
      data: {
        subjectId: subject.id,
        studentId,
        availableBalance: 75,
        escrowedBalance: 15,
      },
    });

    await db.pointLedgerEntry.create({
      data: {
        enrollmentId: enrollment.id,
        subjectId: subject.id,
        entryType: "MERIT",
        availableDelta: 75,
        escrowDelta: 0,
        availableAfter: 75,
        escrowAfter: 0,
        referenceType: "ManualMerit",
        referenceId: randomUUID(),
        note: "Test merit points",
        actorUserId: teacherId,
      },
    });

    const category = await db.gradeCategory.create({
      data: {
        subjectId: subject.id,
        name: "Quizzes",
        categoryType: "ASSESSMENT",
        weightPct: 100,
      },
    });

    const assessment = await db.assessment.create({
      data: {
        subjectId: subject.id,
        categoryId: category.id,
        title: "Quiz 1",
        maxScore: 20,
      },
    });

    await db.assessmentScore.create({
      data: {
        assessmentId: assessment.id,
        enrollmentId: enrollment.id,
        status: "GRADED",
        rawScore: 18,
      },
    });

    await db.notification.create({
      data: {
        userId: studentId,
        subjectId: subject.id,
        type: "MERIT_RECEIVED",
        title: "Merit Awarded",
        body: "+75 pts",
      },
    });

    return { subject, enrollment };
  }

  it("allows owning teacher to edit startDate/endDate and delete section while unenrolling student & clearing points", async () => {
    const { subject, enrollment } =
      await seedSectionWithStudentPointsAndAssessment("T");

    const { PATCH: patchSubject, DELETE: deleteSubject } = await import(
      "@/app/api/subjects/[id]/route"
    );
    const { GET: listSubjects } = await import("@/app/api/subjects/route");

    // 1. Teacher updates startDate and endDate
    getCurrentUserMock.mockResolvedValue({
      id: teacherId,
      email: `sdel-t-${suffix}@classpulse.local`,
      institutionalId: `SDT-${suffix}`,
      fullName: "Section Delete Teacher",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    const patchRes = await patchSubject(
      new Request(`http://localhost/api/subjects/${subject.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          startDate: "2026-09-01",
          endDate: "2026-12-22",
        }),
      }),
      { params: Promise.resolve({ id: subject.id }) }
    );
    expect(patchRes.status).toBe(200);
    const patchJson = (await patchRes.json()) as {
      subject: { startDate: string; endDate: string };
    };
    expect(patchJson.subject.startDate.slice(0, 10)).toBe("2026-09-01");
    expect(patchJson.subject.endDate.slice(0, 10)).toBe("2026-12-22");

    // 2. Teacher deletes section
    const delRes = await deleteSubject(
      new Request(`http://localhost/api/subjects/${subject.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: subject.id }) }
    );
    expect(delRes.status).toBe(200);
    const delJson = (await delRes.json()) as {
      ok: boolean;
      unenrolledCount: number;
      clearedPointsTotal: number;
      notificationsDeleted: number;
    };
    expect(delJson).toEqual({
      ok: true,
      unenrolledCount: 1,
      clearedPointsTotal: 90,
      notificationsDeleted: 1,
    });

    // 3. Verify subject, enrollment, point ledger entries, and notifications are gone
    expect(await db.subject.findUnique({ where: { id: subject.id } })).toBeNull();
    expect(
      await db.subjectEnrollment.findUnique({ where: { id: enrollment.id } })
    ).toBeNull();
    expect(
      await db.pointLedgerEntry.count({ where: { subjectId: subject.id } })
    ).toBe(0);
    expect(
      await db.notification.count({ where: { subjectId: subject.id } })
    ).toBe(0);

    // 4. Verify student no longer sees the deleted section
    getCurrentUserMock.mockResolvedValue({
      id: studentId,
      email: `sdel-s-${suffix}@classpulse.local`,
      institutionalId: `SDS-${suffix}`,
      fullName: "Section Delete Student",
      role: "STUDENT",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    const studentListRes = await listSubjects(
      new Request("http://localhost/api/subjects")
    );
    expect(studentListRes.status).toBe(200);
    const studentListJson = (await studentListRes.json()) as {
      subjects: { id: string }[];
    };
    expect(studentListJson.subjects.some((s) => s.id === subject.id)).toBe(
      false
    );

    // 5. Verify audit log persisted after Subject deletion
    const auditEntry = await db.auditLog.findFirst({
      where: {
        action: "SUBJECT_DELETED",
        targetId: subject.id,
      },
    });
    expect(auditEntry).not.toBeNull();
  });

  it("allows ADMIN to delete any section and unenroll students", async () => {
    const { subject, enrollment } =
      await seedSectionWithStudentPointsAndAssessment("A");

    const { DELETE: deleteSubject } = await import(
      "@/app/api/subjects/[id]/route"
    );

    getCurrentUserMock.mockResolvedValue({
      id: adminId,
      email: `sdel-a-${suffix}@classpulse.local`,
      institutionalId: `SDA-${suffix}`,
      fullName: "Section Delete Admin",
      role: "ADMIN",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    const delRes = await deleteSubject(
      new Request(`http://localhost/api/subjects/${subject.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: subject.id }) }
    );
    expect(delRes.status).toBe(200);
    expect(
      await db.subjectEnrollment.findUnique({ where: { id: enrollment.id } })
    ).toBeNull();
    expect(
      await db.pointLedgerEntry.count({ where: { subjectId: subject.id } })
    ).toBe(0);
  });

  it("allows ADMIN to select and bulk-delete multiple sections, unenrolling students & deleting notifications", async () => {
    const first = await seedSectionWithStudentPointsAndAssessment("B1");
    const second = await seedSectionWithStudentPointsAndAssessment("B2");

    const { POST: bulkDelete } = await import(
      "@/app/api/subjects/bulk-delete/route"
    );

    getCurrentUserMock.mockResolvedValue({
      id: adminId,
      email: `sdel-a-${suffix}@classpulse.local`,
      institutionalId: `SDA-${suffix}`,
      fullName: "Section Delete Admin",
      role: "ADMIN",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    const bulkRes = await bulkDelete(
      new Request("http://localhost/api/subjects/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjectIds: [first.subject.id, second.subject.id],
        }),
      })
    );
    expect(bulkRes.status).toBe(200);
    const bulkJson = (await bulkRes.json()) as {
      ok: boolean;
      deletedCount: number;
      unenrolledCount: number;
      clearedPointsTotal: number;
      notificationsDeleted: number;
    };
    expect(bulkJson).toEqual({
      ok: true,
      deletedCount: 2,
      unenrolledCount: 2,
      clearedPointsTotal: 180,
      notificationsDeleted: 2,
    });

    expect(
      await db.subject.count({
        where: { id: { in: [first.subject.id, second.subject.id] } },
      })
    ).toBe(0);
    expect(
      await db.subjectEnrollment.count({
        where: { id: { in: [first.enrollment.id, second.enrollment.id] } },
      })
    ).toBe(0);
    expect(
      await db.notification.count({
        where: { subjectId: { in: [first.subject.id, second.subject.id] } },
      })
    ).toBe(0);
  });
});
