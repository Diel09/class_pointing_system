import { NextResponse } from "next/server";
import { jsonError, requireAuth } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { markNotificationsReadSchema } from "@/lib/validations/notifications";

export async function PATCH(request: Request) {
  const auth = await requireAuth();
  if (!auth.ok) {
    return auth.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = markNotificationsReadSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid mark-read request.",
      400,
      "ERR_VALIDATION"
    );
  }

  if (parsed.data.all) {
    await db.notification.updateMany({
      where: { userId: auth.data.id, isRead: false },
      data: { isRead: true },
    });
  } else if (parsed.data.notificationIds?.length) {
    await db.notification.updateMany({
      where: {
        userId: auth.data.id,
        id: { in: parsed.data.notificationIds },
      },
      data: { isRead: true },
    });
  }

  const unreadCount = await db.notification.count({
    where: { userId: auth.data.id, isRead: false },
  });

  return NextResponse.json({ ok: true, unreadCount });
}
