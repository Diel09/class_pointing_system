import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import {
  jsonError,
  pointsDisabledError,
  requireTeacherSubjectOwner,
} from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { resolveSignedPointsDelta } from "@/lib/points/merit-math";
import { updateMeritPresetSchema } from "@/lib/validations/points";

const uuidSchema = z.string().uuid();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; presetId: string }> }
) {
  const { id, presetId } = await context.params;
  const owner = await requireTeacherSubjectOwner(id);
  if (!owner.ok) {
    return owner.response;
  }
  if (owner.data.subject.pointsEnabled === false) {
    return pointsDisabledError();
  }

  if (!uuidSchema.safeParse(presetId).success) {
    return jsonError("Merit preset not found.", 404, "ERR_NOT_FOUND");
  }

  const existing = await db.meritPreset.findUnique({
    where: { id: presetId },
  });
  if (!existing || existing.subjectId !== id) {
    return jsonError("Merit preset not found.", 404, "ERR_NOT_FOUND");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = updateMeritPresetSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid preset update.",
      400,
      "ERR_VALIDATION"
    );
  }

  const nextType = parsed.data.type ?? existing.type;
  const nextDelta = resolveSignedPointsDelta(
    nextType,
    parsed.data.pointsDelta ?? existing.pointsDelta
  );
  const ipAddress = getClientIp(request);

  const preset = await db.$transaction(async (tx) => {
    const updated = await tx.meritPreset.update({
      where: { id: presetId },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.type !== undefined || parsed.data.pointsDelta !== undefined
          ? { type: nextType, pointsDelta: nextDelta }
          : {}),
        ...(parsed.data.description !== undefined
          ? { description: parsed.data.description || null }
          : {}),
        ...(parsed.data.isArchived !== undefined
          ? { isArchived: parsed.data.isArchived }
          : {}),
      },
    });

    await recordAuditLog(
      {
        actorUserId: owner.data.user.id,
        subjectId: id,
        action: "MERIT_PRESET_UPDATED",
        targetType: "MeritPreset",
        targetId: updated.id,
        beforeState: {
          name: existing.name,
          type: existing.type,
          pointsDelta: existing.pointsDelta,
          description: existing.description,
          isArchived: existing.isArchived,
        },
        afterState: {
          name: updated.name,
          type: updated.type,
          pointsDelta: updated.pointsDelta,
          description: updated.description,
          isArchived: updated.isArchived,
        },
        ipAddress,
      },
      tx
    );

    return updated;
  });

  return NextResponse.json({ preset });
}
