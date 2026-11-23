import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError, requireTeacherSubjectOwner } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { updateGroupSetSchema } from "@/lib/validations/groups";

const uuidSchema = z.string().uuid();

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; groupSetId: string }> }
) {
  const { id, groupSetId } = await context.params;
  const owner = await requireTeacherSubjectOwner(id);
  if (!owner.ok) {
    return owner.response;
  }

  if (owner.data.subject.isArchived) {
    return jsonError(
      "Cannot edit group sets on an archived subject.",
      400,
      "ERR_SUBJECT_ARCHIVED"
    );
  }

  if (!uuidSchema.safeParse(groupSetId).success) {
    return jsonError("Group set not found.", 404, "ERR_NOT_FOUND");
  }

  const groupSet = await db.groupSet.findUnique({
    where: { id: groupSetId },
  });
  if (!groupSet || groupSet.subjectId !== id) {
    return jsonError("Group set not found.", 404, "ERR_NOT_FOUND");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = updateGroupSetSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid group set update.",
      400,
      "ERR_VALIDATION"
    );
  }

  const duplicate = await db.groupSet.findFirst({
    where: {
      subjectId: id,
      id: { not: groupSetId },
      name: { equals: parsed.data.name, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (duplicate) {
    return jsonError(
      `A group set named "${parsed.data.name}" already exists in this class.`,
      409,
      "ERR_GROUP_SET_EXISTS"
    );
  }

  const ipAddress = getClientIp(request);

  try {
    const updated = await db.$transaction(async (tx) => {
      const next = await tx.groupSet.update({
        where: { id: groupSetId },
        data: { name: parsed.data.name },
      });

      await recordAuditLog(
        {
          actorUserId: owner.data.user.id,
          subjectId: id,
          action: "GROUP_SET_UPDATED",
          targetType: "GroupSet",
          targetId: groupSetId,
          beforeState: { name: groupSet.name },
          afterState: { name: next.name },
          ipAddress,
        },
        tx
      );

      return next;
    });

    return NextResponse.json({ groupSet: updated });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError(
        `A group set named "${parsed.data.name}" already exists in this class.`,
        409,
        "ERR_GROUP_SET_EXISTS"
      );
    }
    throw error;
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; groupSetId: string }> }
) {
  const { id, groupSetId } = await context.params;
  const owner = await requireTeacherSubjectOwner(id);
  if (!owner.ok) {
    return owner.response;
  }

  if (owner.data.subject.isArchived) {
    return jsonError(
      "Cannot delete group sets on an archived subject.",
      400,
      "ERR_SUBJECT_ARCHIVED"
    );
  }

  if (!uuidSchema.safeParse(groupSetId).success) {
    return jsonError("Group set not found.", 404, "ERR_NOT_FOUND");
  }

  const groupSet = await db.groupSet.findUnique({
    where: { id: groupSetId },
  });
  if (!groupSet || groupSet.subjectId !== id) {
    return jsonError("Group set not found.", 404, "ERR_NOT_FOUND");
  }

  const linkedCount = await db.assessment.count({
    where: { groupSetId },
  });
  if (linkedCount > 0) {
    return jsonError(
      "Cannot delete this group set while it is assigned to one or more assessments.",
      409,
      "ERR_GROUP_SET_IN_USE"
    );
  }

  const ipAddress = getClientIp(request);

  await db.$transaction(async (tx) => {
    await tx.groupSet.delete({ where: { id: groupSetId } });

    await recordAuditLog(
      {
        actorUserId: owner.data.user.id,
        subjectId: id,
        action: "GROUP_SET_DELETED",
        targetType: "GroupSet",
        targetId: groupSetId,
        beforeState: { name: groupSet.name },
        ipAddress,
      },
      tx
    );
  });

  return NextResponse.json({ ok: true });
}
