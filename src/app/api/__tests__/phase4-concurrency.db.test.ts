import { randomUUID } from "crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { signP2pQrPayload } from "@/lib/points/p2p-qr";

const getCurrentUserMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: getCurrentUserMock,
}));

describe("Phase 4 Real PostgreSQL Concurrency Tests", () => {
  const suffix = randomUUID().slice(0, 8);
  let termId = "";
  let teacherId = "";
  let studentAId = "";
  let studentBId = "";
  let subjectId = "";
  let enrollAId = "";
  let enrollBId = "";
  let rewardId = "";

  beforeAll(async () => {
    const teacher = await db.user.create({
      data: {
        email: `p4-t-${suffix}@classpulse.local`,
        institutionalId: `P4T-${suffix}`,
        passwordHash: "hash",
        fullName: "Phase 4 Concurrency Teacher",
        role: "TEACHER",
        status: "ACTIVE",
      },
    });
    teacherId = teacher.id;

    const studentA = await db.user.create({
      data: {
        email: `p4-a-${suffix}@classpulse.local`,
        institutionalId: `P4A-${suffix}`,
        passwordHash: "hash",
        fullName: "Concurrency Student A",
        role: "STUDENT",
        status: "ACTIVE",
      },
    });
    studentAId = studentA.id;

    const studentB = await db.user.create({
      data: {
        email: `p4-b-${suffix}@classpulse.local`,
        institutionalId: `P4B-${suffix}`,
        passwordHash: "hash",
        fullName: "Concurrency Student B",
        role: "STUDENT",
        status: "ACTIVE",
      },
    });
    studentBId = studentB.id;

    const term = await db.academicTerm.create({
      data: {
        name: `P4 Concurrency Term ${suffix}`,
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
        code: `P4-${suffix}`,
        title: "Concurrency Verification Subject",
        section: "TEST",
        inviteCode: `P4${suffix.toUpperCase()}`,
        allowP2pTransfers: true,
      },
    });
    subjectId = subject.id;

    const [enrollA, enrollB] = await Promise.all([
      db.subjectEnrollment.create({
        data: {
          subjectId,
          studentId: studentAId,
          availableBalance: 50,
          escrowedBalance: 0,
        },
      }),
      db.subjectEnrollment.create({
        data: {
          subjectId,
          studentId: studentBId,
          availableBalance: 50,
          escrowedBalance: 0,
        },
      }),
    ]);
    enrollAId = enrollA.id;
    enrollBId = enrollB.id;

    const reward = await db.rewardItem.create({
      data: {
        subjectId,
        name: "Concurrent Boost",
        rewardType: "SCORE_BOOST",
        pointCostPerUnit: 15,
        scoreValuePerUnit: 1,
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
    const userIds = [studentAId, studentBId, teacherId].filter(Boolean);
    if (userIds.length > 0) {
      await db.user
        .deleteMany({ where: { id: { in: userIds } } })
        .catch(() => undefined);
    }
    await db.$disconnect();
  });

  it("completes simultaneous opposing P2P transfers (A -> B and B -> A) with zero deadlocks", async () => {
    const { POST: sendTransfer } = await import(
      "@/app/api/subjects/[id]/transfers/route"
    );

    const qrForB = signP2pQrPayload({
      subjectId,
      receiverEnrollmentId: enrollBId,
    });
    const qrForA = signP2pQrPayload({
      subjectId,
      receiverEnrollmentId: enrollAId,
    });

    // Switch caller context safely by passing mockImplementationOnce in order of invocation
    getCurrentUserMock
      .mockResolvedValueOnce({
        id: studentAId,
        email: `p4-a-${suffix}@classpulse.local`,
        institutionalId: `P4A-${suffix}`,
        fullName: "Concurrency Student A",
        role: "STUDENT",
        status: "ACTIVE",
        sessionVersion: 1,
      })
      .mockResolvedValueOnce({
        id: studentBId,
        email: `p4-b-${suffix}@classpulse.local`,
        institutionalId: `P4B-${suffix}`,
        fullName: "Concurrency Student B",
        role: "STUDENT",
        status: "ACTIVE",
        sessionVersion: 1,
      });

    const [resAtoB, resBtoA] = await Promise.all([
      sendTransfer(
        new Request(`http://localhost/api/subjects/${subjectId}/transfers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ qrPayload: qrForB, amount: 12 }),
        }),
        { params: Promise.resolve({ id: subjectId }) }
      ),
      sendTransfer(
        new Request(`http://localhost/api/subjects/${subjectId}/transfers`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ qrPayload: qrForA, amount: 5 }),
        }),
        { params: Promise.resolve({ id: subjectId }) }
      ),
    ]);

    expect(resAtoB.status).toBe(201);
    expect(resBtoA.status).toBe(201);

    const [afterA, afterB] = await Promise.all([
      db.subjectEnrollment.findUniqueOrThrow({ where: { id: enrollAId } }),
      db.subjectEnrollment.findUniqueOrThrow({ where: { id: enrollBId } }),
    ]);

    // A: 50 - 12 + 5 = 43; B: 50 + 12 - 5 = 57
    expect(afterA.availableBalance).toBe(43);
    expect(afterB.availableBalance).toBe(57);
  });

  it("allows only valid concurrent redemption requests and blocks over-spending with zero negative balance", async () => {
    await db.subjectEnrollment.update({
      where: { id: enrollAId },
      data: { availableBalance: 25, escrowedBalance: 0 },
    });

    const { POST: submitRedemption } = await import(
      "@/app/api/subjects/[id]/redemptions/route"
    );

    getCurrentUserMock.mockResolvedValue({
      id: studentAId,
      email: `p4-a-${suffix}@classpulse.local`,
      institutionalId: `P4A-${suffix}`,
      fullName: "Concurrency Student A",
      role: "STUDENT",
      status: "ACTIVE",
      sessionVersion: 1,
    });

    const responses = await Promise.all([
      submitRedemption(
        new Request(`http://localhost/api/subjects/${subjectId}/redemptions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rewardItemId: rewardId,
            requestedUnits: 1,
            targetLabel: "Concurrent Quiz 1",
          }),
        }),
        { params: Promise.resolve({ id: subjectId }) }
      ),
      submitRedemption(
        new Request(`http://localhost/api/subjects/${subjectId}/redemptions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rewardItemId: rewardId,
            requestedUnits: 1,
            targetLabel: "Concurrent Quiz 2",
          }),
        }),
        { params: Promise.resolve({ id: subjectId }) }
      ),
      submitRedemption(
        new Request(`http://localhost/api/subjects/${subjectId}/redemptions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            rewardItemId: rewardId,
            requestedUnits: 1,
            targetLabel: "Concurrent Quiz 3",
          }),
        }),
        { params: Promise.resolve({ id: subjectId }) }
      ),
    ]);

    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 400, 400]);

    const afterA = await db.subjectEnrollment.findUniqueOrThrow({
      where: { id: enrollAId },
    });
    expect(afterA.availableBalance).toBe(10);
    expect(afterA.escrowedBalance).toBe(15);
  });
});
