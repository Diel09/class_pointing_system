import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/guards";
import { db } from "@/lib/db";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) {
    return auth.response;
  }

  const [notifications, unreadCount] = await Promise.all([
    db.notification.findMany({
      where: { userId: auth.data.id },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        subjectId: true,
        type: true,
        title: true,
        body: true,
        linkUrl: true,
        isRead: true,
        createdAt: true,
      },
    }),
    db.notification.count({
      where: { userId: auth.data.id, isRead: false },
    }),
  ]);

  return NextResponse.json({ notifications, unreadCount });
}
