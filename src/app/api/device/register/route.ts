import { NextResponse } from "next/server";
import { jsonError } from "@/lib/auth/guards";
import { ensureDeviceCookie } from "@/lib/device/token";
import { deviceRegisterSchema } from "@/lib/validations/auth";

export async function POST(request: Request) {
  let rawBody: unknown = {};
  const text = await request.text();
  if (text.trim().length > 0) {
    try {
      rawBody = JSON.parse(text);
    } catch {
      return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
    }
  }

  const parsed = deviceRegisterSchema.safeParse(rawBody);
  if (!parsed.success) {
    return jsonError("Invalid device mirror payload.", 400, "ERR_VALIDATION");
  }

  const { token } = await ensureDeviceCookie(parsed.data.mirrorToken);

  return NextResponse.json({
    mirrorToken: token,
    synced: true,
  });
}
