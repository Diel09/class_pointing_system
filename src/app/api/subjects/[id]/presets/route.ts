import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import {
  jsonError,
  pointsDisabledError,
  requireSubjectInstructor,
  requireTeacherSubjectOwner,
} from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { resolveSignedPointsDelta } from "@/lib/points/merit-math";
import { createMeritPresetSchema } from "@/lib/validations/points";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const owner = await requireSubjectInstructor(id);
  if (!owner.ok) {
    return owner.response;
  }

  const { searchParams } = new URL(request.url);
  const includeArchived = searchParams.get("includeArchived") === "true";

  const presets = await db.meritPreset.findMany({
    where: {
      subjectId: id,
      ...(includeArchived ? {} : { isArchived: false }),
    },
    orderBy: [{ isArchived: "asc" }, { type: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({ presets });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const owner = await requireTeacherSubjectOwner(id);
  if (!owner.ok) {
    return owner.response;
  }
  if (owner.data.subject.pointsEnabled === false) {
    return pointsDisabledError();
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = createMeritPresetSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid merit preset input.",
      400,
      "ERR_VALIDATION"
    );
  }

  const signedDelta = resolveSignedPointsDelta(
    parsed.data.type,
    parsed.data.pointsDelta
  );
  const ipAddress = getClientIp(request);

  const preset = await db.$transaction(async (tx) => {
    const created = await tx.meritPreset.create({
      data: {
        subjectId: id,
        name: parsed.data.name,
        type: parsed.data.type,
        pointsDelta: signedDelta,
        description: parsed.data.description || null,
      },
    });

    await recordAuditLog(
      {
        actorUserId: owner.data.user.id,
        subjectId: id,
        action: "MERIT_PRESET_CREATED",
        targetType: "MeritPreset",
        targetId: created.id,
        afterState: {
          name: created.name,
          type: created.type,
          pointsDelta: created.pointsDelta,
          description: created.description,
        },
        ipAddress,
      },
      tx
    );

    return created;
  });

  return NextResponse.json({ preset }, { status: 201 });
}
