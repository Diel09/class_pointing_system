import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

const getCurrentUserMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: getCurrentUserMock,
}));

describe("Admin Student Deletion Integration (Real PostgreSQL)", () => {
  const suffix = randomUUID().slice(0, 8);
  let termId = "";
  let adminId = "";
  let teacherId = "";
  let subjectId = "";
  const createdStudentIds: string[] = [];

  beforeAll(async () => {
    const admin = await db.user.create({
      data: {
        email: `asd-a-${suffix}@classpulse.local`,
        institutionalId: `ASDA-${suffix}`,
        passwordHash: "hash",
        fullName: "Admin Student Deleter",
        role: "ADMIN",
        status: "ACTIVE",
      },
    });
    adminId = admin.id;

    const teacher = await db.user.create({
      data: {
        email: `asd-t-${suffix}@classpulse.local`,
        institutionalId: `ASDT-${suffix}`,
        passwordHash: "hash",
        fullName: "Student Delete Test Teacher",
        role: "TEACHER",
        status: "ACTIVE",
      },
    });
    teacherId = teacher.id;

    const term = await db.academicTerm.create({
      data: {
        name: `ASD Term ${suffix}`,
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
        code: `ASD-${suffix}`,
        title: "Admin Student Delete Course",
        section: "SEC-A",
        inviteCode: `ASD${suffix.toUpperCase()}`.slice(0, 12),
      },
    });
    subjectId = subject.id;
  });

  afterAll(async () => {
    if (subjectId) {
      await db.subject
        .delete({ where: { id: subjectId } })
        .catch(() => undefined);
    }
    await db.auditLog
      .deleteMany({
        where: { actorUserId: { in: [adminId, teacherId] } },
      })
      .catch(() => undefined);
    if (createdStudentIds.length > 0) {
      await db.user
        .deleteMany({ where: { id: { in: createdStudentIds } } })
        .catch(() => undefined);
    }
    if (termId) {
      await db.academicTerm
        .delete({ where: { id: termId } })
        .catch(() => undefined);
    }
    for (const userId of [teacherId, adminId]) {
      if (userId) {
        await db.user.delete({ where: { id: userId } }).catch(() => undefined);
      }
    }
  });

  async function createStudent(tag: string) {
    const user = await db.user.create({
      data: {
        email: `asd-${tag}-${suffix}@classpulse.local`,
        institutionalId: `ASDS-${tag}-${suffix}`,
        passwordHash: "hash",
        fullName: `Deletable Student ${tag}`,
        role: "STUDENT",
        status: "ACTIVE",
      },
    });
    createdStudentIds.push(user.id);
    return user;
  }

  it("blocks non-admins, refuses deleting teachers, and deletes single & bulk students while preserving peer P2P ledger history", async () => {
    const s1 = await createStudent("1");
    const s2 = await createStudent("2");
    const peer = await createStudent("peer");

    const enr1 = await db.subjectEnrollment.create({
      data: {
        subjectId,
        studentId: s1.id,
        availableBalance: 25,
        escrowedBalance: 5,
      },
    });
    const enr2 = await db.subjectEnrollment.create({
      data: {
        subjectId,
        studentId: s2.id,
        availableBalance: 10,
      },
    });
    const enrPeer = await db.subjectEnrollment.create({
      data: {
        subjectId,
        studentId: peer.id,
        availableBalance: 50,
      },
    });

    // Simulate s1 sending P2P points to peer (creates P2P_RECEIVE on peer's enrollment with actorUserId = s1.id)
    const p2pRefId = randomUUID();
    await db.pointLedgerEntry.createMany({
      data: [
        {
          enrollmentId: enr1.id,
          subjectId,
          entryType: "P2P_SEND",
          availableDelta: -10,
          escrowDelta: 0,
          availableAfter: 25,
          escrowAfter: 5,
          referenceType: "P2pTransfer",
          referenceId: p2pRefId,
          note: "Sent to peer",
          actorUserId: s1.id,
        },
        {
          enrollmentId: enrPeer.id,
          subjectId,
          entryType: "P2P_RECEIVE",
          availableDelta: 10,
          escrowDelta: 0,
          availableAfter: 50,
          escrowAfter: 0,
          referenceType: "P2pTransfer",
          referenceId: p2pRefId,
          note: `Received from ${s1.fullName}`,
          actorUserId: s1.id,
        },
      ],
    });

    await db.notification.create({
      data: {
        userId: s1.id,
        subjectId,
        type: "MERIT_RECEIVED",
        title: "Welcome",
        body: "Test",
      },
    });

    const { GET: listStudents } = await import(
      "@/app/api/admin/students/route"
    );
    const { DELETE: deleteStudent } = await import(
      "@/app/api/admin/students/[id]/route"
    );
    const { POST: bulkDeleteStudents } = await import(
      "@/app/api/admin/students/bulk-delete/route"
    );

    // 1. Teacher cannot access admin student endpoints
    getCurrentUserMock.mockResolvedValue({
      id: teacherId,
      email: `asd-t-${suffix}@classpulse.local`,
      institutionalId: `ASDT-${suffix}`,
      fullName: "Student Delete Test Teacher",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    expect((await listStudents()).status).toBe(403);
    expect(
      (
        await deleteStudent(
          new Request(`http://localhost/api/admin/students/${s1.id}`, {
            method: "DELETE",
          }),
          { params: Promise.resolve({ id: s1.id }) }
        )
      ).status
    ).toBe(403);

    // 2. Admin can list students
    getCurrentUserMock.mockResolvedValue({
      id: adminId,
      email: `asd-a-${suffix}@classpulse.local`,
      institutionalId: `ASDA-${suffix}`,
      fullName: "Admin Student Deleter",
      role: "ADMIN",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    const listRes = await listStudents();
    expect(listRes.status).toBe(200);
    const listJson = (await listRes.json()) as {
      students: { id: string }[];
    };
    expect(listJson.students.some((u) => u.id === s1.id)).toBe(true);
    expect(listJson.students.some((u) => u.id === teacherId)).toBe(false);

    // 3. Refuses deleting a teacher account via student delete endpoint
    const wrongRoleRes = await deleteStudent(
      new Request(`http://localhost/api/admin/students/${teacherId}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: teacherId }) }
    );
    expect(wrongRoleRes.status).toBe(404);

    // 4. Single-delete student s1 (who sent P2P points to peer)
    const delRes = await deleteStudent(
      new Request(`http://localhost/api/admin/students/${s1.id}`, {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: s1.id }) }
    );
    expect(delRes.status).toBe(200);
    const delJson = (await delRes.json()) as {
      ok: boolean;
      deletedCount: number;
      unenrolledCount: number;
      clearedPointsTotal: number;
    };
    expect(delJson).toEqual({
      ok: true,
      deletedCount: 1,
      unenrolledCount: 1,
      clearedPointsTotal: 30,
    });

    expect(await db.user.findUnique({ where: { id: s1.id } })).toBeNull();
    expect(
      await db.subjectEnrollment.findUnique({ where: { id: enr1.id } })
    ).toBeNull();

    // Peer's P2P_RECEIVE entry remains intact with actorUserId = null
    const peerLedger = await db.pointLedgerEntry.findFirst({
      where: { enrollmentId: enrPeer.id, referenceId: p2pRefId },
    });
    expect(peerLedger).not.toBeNull();
    expect(peerLedger?.actorUserId).toBeNull();
    expect(peerLedger?.availableDelta).toBe(10);

    // 5. Bulk-delete remaining students (s2 & peer)
    const bulkRes = await bulkDeleteStudents(
      new Request("http://localhost/api/admin/students/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentIds: [s2.id, peer.id] }),
      })
    );
    expect(bulkRes.status).toBe(200);
    const bulkJson = (await bulkRes.json()) as {
      ok: boolean;
      deletedCount: number;
      unenrolledCount: number;
      clearedPointsTotal: number;
    };
    expect(bulkJson).toEqual({
      ok: true,
      deletedCount: 2,
      unenrolledCount: 2,
      clearedPointsTotal: 60,
    });

    expect(
      await db.user.count({ where: { id: { in: [s2.id, peer.id] } } })
    ).toBe(0);
    expect(
      await db.subjectEnrollment.count({
        where: { id: { in: [enr2.id, enrPeer.id] } },
      })
    ).toBe(0);

    // Verify audit logs recorded
    expect(
      await db.auditLog.findFirst({
        where: { action: "ADMIN_STUDENT_DELETED", targetId: s1.id },
      })
    ).not.toBeNull();
    expect(
      await db.auditLog.findFirst({
        where: { action: "ADMIN_STUDENTS_BULK_DELETED", actorUserId: adminId },
      })
    ).not.toBeNull();
  });
});
