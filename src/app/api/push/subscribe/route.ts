import { NextResponse } from "next/server";
import { jsonError, requireAuth } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { getVapidConfig } from "@/lib/env";
import {
  pushSubscribeSchema,
  pushUnsubscribeSchema,
} from "@/lib/validations/notifications";

export async function GET() {
  const auth = await requireAuth();
  if (!auth.ok) {
    return auth.response;
  }

  const vapid = getVapidConfig();
  const count = await db.pushSubscription.count({
    where: { userId: auth.data.id },
  });

  return NextResponse.json({
    configured: Boolean(vapid),
    vapidPublicKey: vapid?.publicKey ?? null,
    subscribed: count > 0,
    subscriptionCount: count,
  });
}

export async function POST(request: Request) {
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

  const parsed = pushSubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid push subscription.",
      400,
      "ERR_VALIDATION"
    );
  }

  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? null;

  const subscription = await db.pushSubscription.upsert({
    where: { endpoint: parsed.data.endpoint },
    update: {
      userId: auth.data.id,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userAgent,
    },
    create: {
      userId: auth.data.id,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      userAgent,
    },
    select: {
      id: true,
      endpoint: true,
      createdAt: true,
    },
  });

  return NextResponse.json({ ok: true, subscription }, { status: 201 });
}

export async function DELETE(request: Request) {
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

  const parsed = pushUnsubscribeSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid unsubscribe request.",
      400,
      "ERR_VALIDATION"
    );
  }

  await db.pushSubscription.deleteMany({
    where: {
      userId: auth.data.id,
      endpoint: parsed.data.endpoint,
    },
  });

  return NextResponse.json({ ok: true });
}
