import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentUserMock = vi.fn();
const notificationFindManyMock = vi.fn();
const notificationCountMock = vi.fn();
const notificationUpdateManyMock = vi.fn();
const pushSubCountMock = vi.fn();
const pushSubUpsertMock = vi.fn();
const pushSubDeleteManyMock = vi.fn();
const auditLogCountMock = vi.fn();
const auditLogFindManyMock = vi.fn();
const userCountMock = vi.fn();
const subjectCountMock = vi.fn();
const subjectEnrollmentCountMock = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getCurrentUser: getCurrentUserMock,
}));

vi.mock("@/lib/db", () => ({
  db: {
    notification: {
      findMany: notificationFindManyMock,
      count: notificationCountMock,
      updateMany: notificationUpdateManyMock,
    },
    pushSubscription: {
      count: pushSubCountMock,
      upsert: pushSubUpsertMock,
      deleteMany: pushSubDeleteManyMock,
    },
    auditLog: {
      count: auditLogCountMock,
      findMany: auditLogFindManyMock,
    },
    user: { count: userCountMock },
    subject: { count: subjectCountMock },
    subjectEnrollment: { count: subjectEnrollmentCountMock },
  },
}));

describe("Phase 6 Notifications, Web Push & Admin AuditLog APIs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires authentication for notifications and push endpoints", async () => {
    getCurrentUserMock.mockResolvedValue(null);

    const { GET: getNotifications } = await import(
      "@/app/api/notifications/route"
    );
    const { PATCH: markRead } = await import(
      "@/app/api/notifications/read/route"
    );
    const { POST: subscribePush } = await import(
      "@/app/api/push/subscribe/route"
    );

    expect((await getNotifications()).status).toBe(401);
    expect(
      (
        await markRead(
          new Request("http://localhost/api/notifications/read", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ all: true }),
          })
        )
      ).status
    ).toBe(401);
    expect(
      (
        await subscribePush(
          new Request("http://localhost/api/push/subscribe", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              endpoint: "https://push.example/1",
              keys: { p256dh: "p", auth: "a" },
            }),
          })
        )
      ).status
    ).toBe(401);
  });

  it("returns user notifications and marks all read scoped to userId", async () => {
    getCurrentUserMock.mockResolvedValue({
      id: "student-1",
      email: "s1@classpulse.local",
      institutionalId: "2026-0001",
      fullName: "Student 1",
      role: "STUDENT",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    notificationFindManyMock.mockResolvedValue([
      {
        id: "11111111-1111-4111-8111-111111111111",
        subjectId: "22222222-2222-4222-8222-222222222222",
        type: "MERIT_RECEIVED",
        title: "Merit Received",
        body: "+5 pts",
        linkUrl: "/subjects/22222222-2222-4222-8222-222222222222",
        isRead: false,
        createdAt: new Date(),
      },
    ]);
    notificationCountMock.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    notificationUpdateManyMock.mockResolvedValue({ count: 1 });

    const { GET } = await import("@/app/api/notifications/route");
    const listRes = await GET();
    expect(listRes.status).toBe(200);
    const listData = (await listRes.json()) as { unreadCount: number };
    expect(listData.unreadCount).toBe(1);

    const { PATCH } = await import("@/app/api/notifications/read/route");
    const readRes = await PATCH(
      new Request("http://localhost/api/notifications/read", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      })
    );
    expect(readRes.status).toBe(200);
    expect(notificationUpdateManyMock).toHaveBeenCalledWith({
      where: { userId: "student-1", isRead: false },
      data: { isRead: true },
    });
  });

  it("blocks STUDENT and TEACHER from admin audit logs and allows ADMIN with search filters", async () => {
    const { GET: getAuditLogs } = await import(
      "@/app/api/admin/audit-logs/route"
    );

    getCurrentUserMock.mockResolvedValue({
      id: "teacher-1",
      email: "t1@classpulse.local",
      institutionalId: "EMP-1",
      fullName: "Teacher 1",
      role: "TEACHER",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    const forbiddenRes = await getAuditLogs(
      new Request("http://localhost/api/admin/audit-logs")
    );
    expect(forbiddenRes.status).toBe(403);

    getCurrentUserMock.mockResolvedValue({
      id: "admin-1",
      email: "admin@classpulse.local",
      institutionalId: "ADM-1",
      fullName: "Admin",
      role: "ADMIN",
      status: "ACTIVE",
      sessionVersion: 1,
    });
    auditLogCountMock.mockResolvedValue(1);
    auditLogFindManyMock
      .mockResolvedValueOnce([
        {
          id: "log-1",
          action: "REDEMPTION_APPROVED",
          targetType: "RedemptionRequest",
          targetId: "red-1",
          beforeState: null,
          afterState: { status: "APPROVED" },
          ipAddress: "127.0.0.1",
          createdAt: new Date(),
          actor: {
            id: "teacher-1",
            fullName: "Prof. Elena",
            email: "t1@classpulse.local",
            role: "TEACHER",
          },
          subject: {
            id: "sub-1",
            code: "CS 101",
            title: "Intro",
            section: "1A",
          },
        },
      ])
      .mockResolvedValueOnce([{ action: "REDEMPTION_APPROVED" }]);
    userCountMock.mockResolvedValue(13);
    subjectCountMock.mockResolvedValue(2);
    subjectEnrollmentCountMock.mockResolvedValue(8);

    const adminRes = await getAuditLogs(
      new Request(
        "http://localhost/api/admin/audit-logs?q=Elena&action=REDEMPTION_APPROVED&page=1"
      )
    );
    expect(adminRes.status).toBe(200);
    const body = (await adminRes.json()) as {
      total: number;
      summary: { totalUsers: number };
      logs: { action: string }[];
    };
    expect(body.total).toBe(1);
    expect(body.summary.totalUsers).toBe(13);
    expect(body.logs[0]?.action).toBe("REDEMPTION_APPROVED");
  });
});
