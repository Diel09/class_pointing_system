import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

const getCurrentUserMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: getCurrentUserMock,
}));

describe("Teacher Roster Unenrollment Integration (Real PostgreSQL)", () => {
  const suffix = randomUUID().slice(0, 8);
  let termId = "";
  let teacherId = "";
  let otherTeacherId = "";
  let subjectId = "";
  let otherSubjectId = "";
  const studentIds: string[] = [];

  beforeAll(async () => {
    const teacher = await db.user.create({
      data: {
        email: `ru-t1-${suffix}@classpulse.local`,
        institutionalId: `RUT1-${suffix}`,
        passwordHash: "hash",
        fullName: "Roster Owner Teacher",
        role: "TEACHER",
        status: "ACTIVE",
      },
    });
    teacherId = teacher.id;

    const otherTeacher = await db.user.create({
      data: {
        email: `ru-t2-${suffix}@classpulse.local`,
        institutionalId: `RUT2-${suffix}`,
        passwordHash: "hash",
        fullName: "Other Teacher",
        role: "TEACHER",
        status: "ACTIVE",
      },
    });
    otherTeacherId = otherTeacher.id;

    const term = await db.academicTerm.create({
      data: {
        name: `RU Term ${suffix}`,
        startDate: new Date("2026-08-01T00:00:00.000Z"),
        endDate: new Date("2026-12-20T00:00:00.000Z"),
        isActive: false,
      },
    });
    termId = term.id;

    const subject = await db.subject.create({
      data: {
        teacherId,
        termId,
        code: `RU1-${suffix}`,
        title: "Roster Course 1",
        section: "1A",
        inviteCode: `RU1${suffix.toUpperCase()}`.slice(0, 12),
      },
    });
    subjectId = subject.id;

    const otherSubject = await db.subject.create({
      data: {
        teacherId: otherTeacherId,
        termId,
        code: `RU2-${suffix}`,
        title: "Roster Course 2",
        section: "2A",
        inviteCode: `RU2${suffix.toUpperCase()}`.slice(0, 12),
      },
    });
    otherSubjectId = otherSubject.id;

    for (const tag of ["1", "2", "3"]) {
      const s = await db.user.create({
        data: {
          email: `ru-s${tag}-${suffix}@classpulse.local`,
          institutionalId: `RUS${tag}-${suffix}`,
          passwordHash: "hash",
          fullName: `Roster Student ${tag}`,
          role: "STUDENT",
          status: "ACTIVE",
        },
      });
      studentIds.push(s.id);
    }
  });

  afterAll(async () => {
    for (const sid of [subjectId, otherSubjectId]) {
      if (sid) {
        await db.subject
          .delete({ where: { id: sid } })
          .catch(() => undefined);
      }
    }
    await db.auditLog
      .deleteMany({
        where: { actorUserId: { in: [teacherId, otherTeacherId] } },
      })
      .catch(() => undefined);
    if (studentIds.length > 0) {
      await db.user
        .deleteMany({ where: { id: { in: studentIds } } })
        .catch(() => undefined);
    }
    if (termId) {
      await db.academicTerm
        .delete({ where: { id: termId } })
        .catch(() => undefined);
    }
    for (const uid of [teacherId, otherTeacherId]) {
      if (uid) {
        await db.user.delete({ where: { id: uid } }).catch(() => undefined);
      }
    }
  });

  it("allows owning teacher to single- and bulk-unenroll students while keeping their accounts and other enrollments intact", async () => {
    const [s1, s2, s3] = studentIds as [string, string, string];

    const enr1 = await db.subjectEnrollment.create({
      data: {
        subjectId,
        studentId: s1,
        availableBalance: 20,
        escrowedBalance: 5,
      },
    });
    const enr2 = await db.subjectEnrollment.create({
      data: {
        subjectId,
        studentId: s2,
        availableBalance: 15,
      },
    });
    const enr3 = await db.subjectEnrollment.create({
      data: {
        subjectId,
        studentId: s3,
        availableBalance: 30,
      },
    });
    // s1 is also enrolled in another teacher's subject — must stay intact!
    const enr1Other = await db.subjectEnrollment.create({
      data: {
        subjectId: otherSubjectId,
        studentId: s1,
        availableBalance: 99,
      },
    });

    await db.notification.createMany({
      data: [
        {
          userId: s1,
          subjectId,
          type: "MERIT_RECEIVED",
          title: "Class 1 Merit",
          body: "+20",
        },
        {
          userId: s1,
          subjectId: otherSubjectId,
          type: "MERIT_RECEIVED",
          title: "Class 2 Merit",
          body: "+99",
        },
        {
          userId: s2,
          subjectId,
          type: "MERIT_RECEIVED",
          title: "Class 1 Merit",
          body: "+15",
        },
      ],
    });

    const { DELETE: deleteEnrollment } = await import(
      "@/app/api/subjects/[id]/roster/[enrollmentId]/route"
    );
    const { POST: bulkUnenroll } = await import(
      "@/app/api/subjects/[id]/roster/bulk-unenroll/route"
    );

    // 1. Non-owning teacher is blocked
    getCurrentUserMock.mockResolvedValue({
      id: otherTeacherId,
      email: `ru-t2-${suffix}@classpulse.local`,
      institutionalId: `RUT2-${suffix}`,
      fullName: "Other Teacher",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    expect(
      (
        await deleteEnrollment(
          new Request(
            `http://localhost/api/subjects/${subjectId}/roster/${enr1.id}`,
            { method: "DELETE" }
          ),
          { params: Promise.resolve({ id: subjectId, enrollmentId: enr1.id }) }
        )
      ).status
    ).toBe(403);
    expect(
      (
        await bulkUnenroll(
          new Request(
            `http://localhost/api/subjects/${subjectId}/roster/bulk-unenroll`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ enrollmentIds: [enr2.id, enr3.id] }),
            }
          ),
          { params: Promise.resolve({ id: subjectId }) }
        )
      ).status
    ).toBe(403);

    // 2. Owning teacher single-unenrolls s1
    getCurrentUserMock.mockResolvedValue({
      id: teacherId,
      email: `ru-t1-${suffix}@classpulse.local`,
      institutionalId: `RUT1-${suffix}`,
      fullName: "Roster Owner Teacher",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    const singleRes = await deleteEnrollment(
      new Request(
        `http://localhost/api/subjects/${subjectId}/roster/${enr1.id}`,
        { method: "DELETE" }
      ),
      { params: Promise.resolve({ id: subjectId, enrollmentId: enr1.id }) }
    );
    expect(singleRes.status).toBe(200);
    expect(await singleRes.json()).toEqual({
      ok: true,
      unenrolledCount: 1,
      clearedPointsTotal: 25,
      notificationsDeleted: 1,
    });

    // s1 enrollment in subjectId is gone, but User + otherSubjectId enrollment + otherSubjectId notification remain!
    expect(
      await db.subjectEnrollment.findUnique({ where: { id: enr1.id } })
    ).toBeNull();
    expect(await db.user.findUnique({ where: { id: s1 } })).not.toBeNull();
    expect(
      await db.subjectEnrollment.findUnique({ where: { id: enr1Other.id } })
    ).not.toBeNull();
    expect(
      await db.notification.count({
        where: { userId: s1, subjectId: otherSubjectId },
      })
    ).toBe(1);

    // 3. Owning teacher bulk-unenrolls s2 and s3
    const bulkRes = await bulkUnenroll(
      new Request(
        `http://localhost/api/subjects/${subjectId}/roster/bulk-unenroll`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ enrollmentIds: [enr2.id, enr3.id] }),
        }
      ),
      { params: Promise.resolve({ id: subjectId }) }
    );
    expect(bulkRes.status).toBe(200);
    expect(await bulkRes.json()).toEqual({
      ok: true,
      unenrolledCount: 2,
      clearedPointsTotal: 45,
      notificationsDeleted: 1,
    });

    expect(
      await db.subjectEnrollment.count({ where: { subjectId } })
    ).toBe(0);
    expect(
      await db.user.count({ where: { id: { in: [s2, s3] } } })
    ).toBe(2);

    // Audit logs recorded
    expect(
      await db.auditLog.findFirst({
        where: {
          subjectId,
          action: "ROSTER_STUDENT_REMOVED",
          targetId: enr1.id,
        },
      })
    ).not.toBeNull();
    expect(
      await db.auditLog.findFirst({
        where: {
          subjectId,
          action: "ROSTER_STUDENTS_BULK_REMOVED",
          targetId: subjectId,
        },
      })
    ).not.toBeNull();
  });
});
