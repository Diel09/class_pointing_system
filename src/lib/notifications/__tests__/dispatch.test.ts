import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const notificationCreateManyMock = vi.fn();
const pushSubFindManyMock = vi.fn();
const pushSubDeleteManyMock = vi.fn();
const setVapidDetailsMock = vi.fn();
const sendNotificationMock = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    notification: {
      createMany: notificationCreateManyMock,
    },
    pushSubscription: {
      findMany: pushSubFindManyMock,
      deleteMany: pushSubDeleteManyMock,
    },
  },
}));

vi.mock("web-push", () => ({
  default: {
    setVapidDetails: setVapidDetailsMock,
    sendNotification: sendNotificationMock,
  },
}));

describe("dispatchNotifications", () => {
  const origPublic = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const origPrivate = process.env.VAPID_PRIVATE_KEY;
  const origSubject = process.env.VAPID_SUBJECT;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "";
    process.env.VAPID_PRIVATE_KEY = "";
    process.env.VAPID_SUBJECT = "";
  });

  it("persists notifications and skips web push when VAPID keys are unconfigured", async () => {
    notificationCreateManyMock.mockResolvedValue({ count: 1 });

    const { dispatchNotifications } = await import(
      "@/lib/notifications/dispatch"
    );
    const result = await dispatchNotifications([
      {
        userId: "user-1",
        subjectId: "subj-1",
        type: "MERIT_RECEIVED",
        title: "Merit Received",
        body: "+5 pts",
        linkUrl: "/subjects/subj-1",
      },
    ]);

    expect(result).toEqual({ createdCount: 1, pushAttempted: 0, prunedCount: 0 });
    expect(notificationCreateManyMock).toHaveBeenCalledTimes(1);
    expect(sendNotificationMock).not.toHaveBeenCalled();
  });

  it("sends VAPID Web Push and prunes 404/410 expired subscriptions", async () => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "test-public-key";
    process.env.VAPID_PRIVATE_KEY = "test-private-key";
    process.env.VAPID_SUBJECT = "mailto:admin@classpulse.local";

    notificationCreateManyMock.mockResolvedValue({ count: 1 });
    pushSubFindManyMock.mockResolvedValue([
      {
        id: "sub-valid",
        userId: "user-1",
        endpoint: "https://push.example/valid",
        p256dh: "k1",
        auth: "a1",
      },
      {
        id: "sub-gone",
        userId: "user-1",
        endpoint: "https://push.example/gone",
        p256dh: "k2",
        auth: "a2",
      },
    ]);

    sendNotificationMock
      .mockResolvedValueOnce({ statusCode: 201 })
      .mockRejectedValueOnce({ statusCode: 410 });
    pushSubDeleteManyMock.mockResolvedValue({ count: 1 });

    const { dispatchNotifications } = await import(
      "@/lib/notifications/dispatch"
    );
    const result = await dispatchNotifications([
      {
        userId: "user-1",
        subjectId: "subj-1",
        type: "P2P_RECEIVED",
        title: "Points Received",
        body: "Student 2 sent +15 pts",
        linkUrl: "/subjects/subj-1",
      },
    ]);

    expect(setVapidDetailsMock).toHaveBeenCalledWith(
      "mailto:admin@classpulse.local",
      "test-public-key",
      "test-private-key"
    );
    expect(result).toEqual({ createdCount: 1, pushAttempted: 2, prunedCount: 1 });
    expect(pushSubDeleteManyMock).toHaveBeenCalledWith({
      where: { id: { in: ["sub-gone"] } },
    });
  });

  afterAll(() => {
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = origPublic;
    process.env.VAPID_PRIVATE_KEY = origPrivate;
    process.env.VAPID_SUBJECT = origSubject;
  });
});
