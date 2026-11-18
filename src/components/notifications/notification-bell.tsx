"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bell,
  BellOff,
  BellRing,
  CheckCheck,
  ExternalLink,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface NotificationDto {
  id: string;
  subjectId: string | null;
  type: string;
  title: string;
  body: string;
  linkUrl: string | null;
  isRead: boolean;
  createdAt: string;
}

interface NotificationsResponse {
  notifications: NotificationDto[];
  unreadCount: number;
}

interface PushStatusResponse {
  configured: boolean;
  vapidPublicKey: string | null;
  subscribed: boolean;
  subscriptionCount: number;
}

function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const buffer = new ArrayBuffer(rawData.length);
  const outputArray = new Uint8Array(buffer);
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function formatRelativeTime(iso: string): string {
  const diffSec = Math.max(
    0,
    Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  );
  if (diffSec < 60) return "Just now";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return new Date(iso).toLocaleDateString();
}

export function NotificationBell() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const containerRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [pushHint, setPushHint] = useState<string | null>(null);
  const [browserSubscribed, setBrowserSubscribed] = useState(false);

  const { data } = useQuery<NotificationsResponse>({
    queryKey: ["notifications"],
    queryFn: async () => {
      const res = await fetch("/api/notifications", {
        credentials: "same-origin",
      });
      if (!res.ok) {
        return { notifications: [], unreadCount: 0 };
      }
      return (await res.json()) as NotificationsResponse;
    },
    refetchInterval: 15_000,
    refetchOnWindowFocus: true,
  });

  const { data: pushStatus } = useQuery<PushStatusResponse>({
    queryKey: ["push-status"],
    queryFn: async () => {
      const res = await fetch("/api/push/subscribe", {
        credentials: "same-origin",
      });
      if (!res.ok) {
        return {
          configured: false,
          vapidPublicKey: null,
          subscribed: false,
          subscriptionCount: 0,
        };
      }
      return (await res.json()) as PushStatusResponse;
    },
    enabled: open,
  });

  useEffect(() => {
    if (!open) return;

    function handleOutsideClick(event: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [open]);

  useEffect(() => {
    if (!open || typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    void navigator.serviceWorker.getRegistration().then(async (reg) => {
      if (!reg?.pushManager) return;
      const existing = await reg.pushManager.getSubscription();
      setBrowserSubscribed(Boolean(existing));
    });
  }, [open]);

  async function handleMarkAllRead() {
    await fetch("/api/notifications/read", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    await queryClient.invalidateQueries({ queryKey: ["notifications"] });
  }

  async function handleNotificationClick(item: NotificationDto) {
    if (!item.isRead) {
      await fetch("/api/notifications/read", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationIds: [item.id] }),
      });
      await queryClient.invalidateQueries({ queryKey: ["notifications"] });
    }
    setOpen(false);
    if (item.linkUrl) {
      router.push(item.linkUrl);
    }
  }

  async function handleTogglePush() {
    setPushHint(null);
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      setPushHint(
        "Web Push is unavailable here. On iOS, install Puento to your Home Screen first."
      );
      return;
    }

    setPushBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      if (!registration) {
        setPushHint(
          "Service Worker is active in production builds. In-app alerts remain active."
        );
        return;
      }

      const existing = await registration.pushManager.getSubscription();
      if (existing) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
        await existing.unsubscribe();
        setBrowserSubscribed(false);
        await queryClient.invalidateQueries({ queryKey: ["push-status"] });
        return;
      }

      if (!pushStatus?.configured || !pushStatus.vapidPublicKey) {
        setPushHint("Server VAPID push keys are not configured yet.");
        return;
      }

      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setPushHint("Notification permission was denied in browser settings.");
        return;
      }

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(pushStatus.vapidPublicKey),
      });

      const subJson = subscription.toJSON();
      if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) {
        setPushHint("Browser returned an incomplete push subscription.");
        return;
      }

      const res = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          endpoint: subJson.endpoint,
          keys: {
            p256dh: subJson.keys.p256dh,
            auth: subJson.keys.auth,
          },
        }),
      });
      if (!res.ok) {
        setPushHint("Failed to register push subscription with server.");
        return;
      }
      setBrowserSubscribed(true);
      await queryClient.invalidateQueries({ queryKey: ["push-status"] });
    } catch {
      setPushHint("Unable to update push notification settings.");
    } finally {
      setPushBusy(false);
    }
  }

  const unreadCount = data?.unreadCount ?? 0;
  const notifications = data?.notifications ?? [];

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label="Notifications"
        aria-expanded={open}
        className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 transition-colors"
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span
            data-testid="notification-unread-badge"
            className="absolute -top-1 -right-1 inline-flex min-w-[18px] h-[18px] items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white"
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Notification Center"
          className="fixed sm:absolute right-2 sm:right-0 top-14 sm:top-11 z-50 w-[calc(100vw-1rem)] sm:w-96 rounded-2xl border border-slate-200 bg-white shadow-xl overflow-hidden"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900">Notifications</h3>
              <p className="text-[11px] text-slate-500">
                {unreadCount > 0
                  ? `${unreadCount} unread alert${unreadCount === 1 ? "" : "s"}`
                  : "All caught up"}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => void handleMarkAllRead()}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100"
                >
                  <CheckCheck className="h-3.5 w-3.5" />
                  <span>Mark all read</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close notifications"
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Web Push Subscription Strip */}
          <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-2.5 space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-medium text-slate-600">
                Background Web Push
              </span>
              <button
                type="button"
                disabled={pushBusy}
                onClick={() => void handleTogglePush()}
                className={cn(
                  "inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors disabled:opacity-60",
                  browserSubscribed
                    ? "bg-emerald-100 text-emerald-800 hover:bg-emerald-200"
                    : "bg-indigo-600 text-white hover:bg-indigo-700"
                )}
              >
                {browserSubscribed ? (
                  <>
                    <BellRing className="h-3 w-3" />
                    <span>Push Enabled</span>
                  </>
                ) : (
                  <>
                    <BellOff className="h-3 w-3" />
                    <span>{pushBusy ? "Updating..." : "Enable Push"}</span>
                  </>
                )}
              </button>
            </div>
            {pushHint && (
              <p className="text-[11px] text-amber-700">{pushHint}</p>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto divide-y divide-slate-100">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-xs text-slate-500">
                No notifications yet. Attendance, merits, transfers, redemptions,
                and score updates will appear here.
              </div>
            ) : (
              notifications.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => void handleNotificationClick(item)}
                  className={cn(
                    "w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors flex items-start gap-2.5",
                    !item.isRead && "bg-indigo-50/40"
                  )}
                >
                  <span
                    className={cn(
                      "mt-1.5 h-2 w-2 rounded-full shrink-0",
                      item.isRead ? "bg-slate-300" : "bg-indigo-600"
                    )}
                  />
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex items-center justify-between gap-2">
                      <p
                        className={cn(
                          "text-xs truncate",
                          item.isRead
                            ? "font-medium text-slate-700"
                            : "font-bold text-slate-900"
                        )}
                      >
                        {item.title}
                      </p>
                      <span className="text-[10px] text-slate-400 shrink-0">
                        {formatRelativeTime(item.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 line-clamp-2">
                      {item.body}
                    </p>
                    {item.linkUrl && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-indigo-600 pt-0.5">
                        <span>View details</span>
                        <ExternalLink className="h-2.5 w-2.5" />
                      </span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
