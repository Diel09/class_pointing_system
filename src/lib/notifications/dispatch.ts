import type { NotificationType } from "@prisma/client";
import { sendNotification, setVapidDetails } from "web-push";
import { db } from "@/lib/db";
import { getVapidConfig } from "@/lib/env";

export interface NotificationDispatchItem {
  userId: string;
  subjectId?: string | null;
  type: NotificationType;
  title: string;
  body: string;
  linkUrl?: string | null;
}

interface StoredSubscription {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
}

let vapidInitializedForKey: string | null = null;

function ensureVapidConfigured(): boolean {
  const vapid = getVapidConfig();
  if (!vapid || typeof setVapidDetails !== "function") {
    return false;
  }
  const cacheKey = `${vapid.publicKey}:${vapid.subject}`;
  if (vapidInitializedForKey !== cacheKey) {
    try {
      setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
      vapidInitializedForKey = cacheKey;
    } catch (err) {
      if (process.env.NODE_ENV !== "test") {
        console.warn("Web Push VAPID setup failed:", err);
      }
      return false;
    }
  }
  return true;
}

function getPushStatusCode(err: unknown): number | null {
  if (typeof err === "object" && err !== null && "statusCode" in err) {
    const statusCode = (err as { statusCode?: unknown }).statusCode;
    return typeof statusCode === "number" ? statusCode : null;
  }
  return null;
}

/**
 * Persists in-app notifications and delivers best-effort Web Push alerts via VAPID.
 * Designed to run after database transactions commit so external push latency or
 * unmocked unit-test DB stubs never disrupt core transactional operations.
 */
export async function dispatchNotifications(
  items: NotificationDispatchItem[]
): Promise<{ createdCount: number; pushAttempted: number; prunedCount: number }> {
  if (items.length === 0) {
    return { createdCount: 0, pushAttempted: 0, prunedCount: 0 };
  }

  let createdCount = 0;
  const notificationRepo = (
    db as unknown as {
      notification?: {
        createMany?: (args: {
          data: {
            userId: string;
            subjectId: string | null;
            type: NotificationType;
            title: string;
            body: string;
            linkUrl: string | null;
          }[];
        }) => Promise<{ count?: number }>;
      };
    }
  ).notification;

  if (typeof notificationRepo?.createMany === "function") {
    try {
      const res = await notificationRepo.createMany({
        data: items.map((item) => ({
          userId: item.userId,
          subjectId: item.subjectId ?? null,
          type: item.type,
          title: item.title,
          body: item.body,
          linkUrl: item.linkUrl ?? null,
        })),
      });
      createdCount = res?.count ?? items.length;
    } catch (err) {
      if (process.env.NODE_ENV !== "test") {
        console.warn("Failed to persist notifications:", err);
      }
    }
  }

  try {
    if (!ensureVapidConfigured() || typeof sendNotification !== "function") {
      return { createdCount, pushAttempted: 0, prunedCount: 0 };
    }

    const pushRepo = (
      db as unknown as {
        pushSubscription?: {
          findMany?: (args: {
            where: { userId: { in: string[] } };
            select: {
              id: true;
              userId: true;
              endpoint: true;
              p256dh: true;
              auth: true;
            };
          }) => Promise<StoredSubscription[]>;
          deleteMany?: (args: {
            where: { id: { in: string[] } };
          }) => Promise<unknown>;
        };
      }
    ).pushSubscription;

    if (typeof pushRepo?.findMany !== "function") {
      return { createdCount, pushAttempted: 0, prunedCount: 0 };
    }

    const uniqueUserIds = Array.from(new Set(items.map((item) => item.userId)));
    const subscriptions = await pushRepo.findMany({
      where: { userId: { in: uniqueUserIds } },
      select: {
        id: true,
        userId: true,
        endpoint: true,
        p256dh: true,
        auth: true,
      },
    });

    if (subscriptions.length === 0) {
      return { createdCount, pushAttempted: 0, prunedCount: 0 };
    }

    const subsByUser = new Map<string, StoredSubscription[]>();
    for (const sub of subscriptions) {
      const existing = subsByUser.get(sub.userId) ?? [];
      existing.push(sub);
      subsByUser.set(sub.userId, existing);
    }

    const staleSubscriptionIds = new Set<string>();
    const deliveries: Promise<void>[] = [];

    for (const item of items) {
      const userSubs = subsByUser.get(item.userId) ?? [];
      const payload = JSON.stringify({
        title: item.title,
        body: item.body,
        linkUrl: item.linkUrl ?? "/dashboard",
        tag: `${item.type}:${item.subjectId ?? "global"}`,
      });

      for (const sub of userSubs) {
        deliveries.push(
          sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            payload
          )
            .then(() => undefined)
            .catch((err: unknown) => {
              const status = getPushStatusCode(err);
              if (status === 404 || status === 410) {
                staleSubscriptionIds.add(sub.id);
              } else if (process.env.NODE_ENV !== "test") {
                console.warn("Web Push delivery failed:", err);
              }
            })
        );
      }
    }

    await Promise.allSettled(deliveries);

    if (staleSubscriptionIds.size > 0 && typeof pushRepo.deleteMany === "function") {
      try {
        await pushRepo.deleteMany({
          where: { id: { in: Array.from(staleSubscriptionIds) } },
        });
      } catch {
        // Ignore cleanup errors for expired subscriptions.
      }
    }

    return {
      createdCount,
      pushAttempted: deliveries.length,
      prunedCount: staleSubscriptionIds.size,
    };
  } catch (err) {
    if (process.env.NODE_ENV !== "test") {
      console.warn("Web Push dispatch error:", err);
    }
    return { createdCount, pushAttempted: 0, prunedCount: 0 };
  }
}
