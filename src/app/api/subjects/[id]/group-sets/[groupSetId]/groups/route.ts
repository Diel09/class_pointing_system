import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError, requireTeacherSubjectOwner } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { createGroupSchema, groupPatchSchema } from "@/lib/validations/groups";

const uuidSchema = z.string().uuid();

async function requireOwnedGroupSet(subjectId: string, groupSetId: string) {
  const owner = await requireTeacherSubjectOwner(subjectId);
  if (!owner.ok) {
    return owner;
  }

  if (owner.data.subject.isArchived) {
    return {
      ok: false as const,
      response: jsonError(
        "Cannot modify groups on an archived subject.",
        400,
        "ERR_SUBJECT_ARCHIVED"
      ),
    };
  }

  if (!uuidSchema.safeParse(groupSetId).success) {
    return {
      ok: false as const,
      response: jsonError("Group set not found.", 404, "ERR_NOT_FOUND"),
    };
  }

  const groupSet = await db.groupSet.findUnique({
    where: { id: groupSetId },
  });
  if (!groupSet || groupSet.subjectId !== subjectId) {
    return {
      ok: false as const,
      response: jsonError("Group set not found.", 404, "ERR_NOT_FOUND"),
    };
  }

  return {
    ok: true as const,
    data: { ...owner.data, groupSet },
  };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; groupSetId: string }> }
) {
  const { id, groupSetId } = await context.params;
  const ctx = await requireOwnedGroupSet(id, groupSetId);
  if (!ctx.ok) {
    return ctx.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = createGroupSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid group payload.",
      400,
      "ERR_VALIDATION"
    );
  }

  const duplicate = await db.studentGroup.findFirst({
    where: {
      groupSetId,
      name: { equals: parsed.data.name, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (duplicate) {
    return jsonError(
      `A group named "${parsed.data.name}" already exists in this set.`,
      409,
      "ERR_GROUP_EXISTS"
    );
  }

  const ipAddress = getClientIp(request);

  try {
    const created = await db.$transaction(async (tx) => {
      const maxSort = await tx.studentGroup.aggregate({
        where: { groupSetId },
        _max: { sortOrder: true },
      });

      const group = await tx.studentGroup.create({
        data: {
          groupSetId,
          name: parsed.data.name,
          sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
        },
      });

      await recordAuditLog(
        {
          actorUserId: ctx.data.user.id,
          subjectId: id,
          action: "GROUP_CREATED",
          targetType: "StudentGroup",
          targetId: group.id,
          afterState: { groupSetId, name: group.name },
          ipAddress,
        },
        tx
      );

      return group;
    });

    return NextResponse.json({ group: created }, { status: 201 });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return jsonError(
        `A group named "${parsed.data.name}" already exists in this set.`,
        409,
        "ERR_GROUP_EXISTS"
      );
    }
    throw error;
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string; groupSetId: string }> }
) {
  const { id, groupSetId } = await context.params;
  const ctx = await requireOwnedGroupSet(id, groupSetId);
  if (!ctx.ok) {
    return ctx.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = groupPatchSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid group update payload.",
      400,
      "ERR_VALIDATION"
    );
  }

  const ipAddress = getClientIp(request);

  if (parsed.data.action === "rename") {
    const group = await db.studentGroup.findUnique({
      where: { id: parsed.data.groupId },
    });
    if (!group || group.groupSetId !== groupSetId) {
      return jsonError("Group not found in this set.", 404, "ERR_NOT_FOUND");
    }

    const duplicate = await db.studentGroup.findFirst({
      where: {
        groupSetId,
        id: { not: group.id },
        name: { equals: parsed.data.name, mode: "insensitive" },
      },
      select: { id: true },
    });
    if (duplicate) {
      return jsonError(
        `A group named "${parsed.data.name}" already exists in this set.`,
        409,
        "ERR_GROUP_EXISTS"
      );
    }

    const nextName = parsed.data.name;
    const renamed = await db.$transaction(async (tx) => {
      const next = await tx.studentGroup.update({
        where: { id: group.id },
        data: { name: nextName },
      });

      await recordAuditLog(
        {
          actorUserId: ctx.data.user.id,
          subjectId: id,
          action: "GROUP_RENAMED",
          targetType: "StudentGroup",
          targetId: group.id,
          beforeState: { name: group.name },
          afterState: { name: next.name },
          ipAddress,
        },
        tx
      );

      return next;
    });

    return NextResponse.json({ group: renamed });
  }

  const { enrollmentId, targetGroupId } = parsed.data;
  const enrollment = await db.subjectEnrollment.findUnique({
    where: { id: enrollmentId },
    select: { id: true, subjectId: true },
  });
  if (!enrollment || enrollment.subjectId !== id) {
    return jsonError(
      "Student is not enrolled in this subject.",
      404,
      "ERR_NOT_ENROLLED"
    );
  }

  if (targetGroupId !== null) {
    const targetGroup = await db.studentGroup.findUnique({
      where: { id: targetGroupId },
      select: { id: true, groupSetId: true },
    });
    if (!targetGroup || targetGroup.groupSetId !== groupSetId) {
      return jsonError(
        "Target group not found in this group set.",
        404,
        "ERR_NOT_FOUND"
      );
    }
  }

  await db.$transaction(async (tx) => {
    const prevMembership = await tx.studentGroupMembership.findUnique({
      where: {
        groupSetId_enrollmentId: {
          groupSetId,
          enrollmentId,
        },
      },
      select: { groupId: true },
    });

    if (targetGroupId === null) {
      if (prevMembership) {
        await tx.studentGroupMembership.delete({
          where: {
            groupSetId_enrollmentId: {
              groupSetId,
              enrollmentId,
            },
          },
        });
      }
    } else {
      await tx.studentGroupMembership.upsert({
        where: {
          groupSetId_enrollmentId: {
            groupSetId,
            enrollmentId,
          },
        },
        update: { groupId: targetGroupId },
        create: {
          groupSetId,
          groupId: targetGroupId,
          enrollmentId,
        },
      });
    }

    await recordAuditLog(
      {
        actorUserId: ctx.data.user.id,
        subjectId: id,
        action: "GROUP_MEMBERSHIP_UPDATED",
        targetType: "GroupSet",
        targetId: groupSetId,
        beforeState: { enrollmentId, groupId: prevMembership?.groupId ?? null },
        afterState: { enrollmentId, groupId: targetGroupId },
        ipAddress,
      },
      tx
    );
  });

  return NextResponse.json({ ok: true });
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; groupSetId: string }> }
) {
  const { id, groupSetId } = await context.params;
  const ctx = await requireOwnedGroupSet(id, groupSetId);
  if (!ctx.ok) {
    return ctx.response;
  }

  const url = new URL(request.url);
  let groupId = url.searchParams.get("groupId");
  if (!groupId) {
    try {
      const body = (await request.json()) as { groupId?: string };
      groupId = body?.groupId ?? null;
    } catch {
      groupId = null;
    }
  }

  if (!groupId || !uuidSchema.safeParse(groupId).success) {
    return jsonError("Valid groupId is required.", 400, "ERR_VALIDATION");
  }

  const group = await db.studentGroup.findUnique({
    where: { id: groupId },
  });
  if (!group || group.groupSetId !== groupSetId) {
    return jsonError("Group not found in this set.", 404, "ERR_NOT_FOUND");
  }

  const ipAddress = getClientIp(request);

  await db.$transaction(async (tx) => {
    await tx.studentGroup.delete({ where: { id: groupId } });

    await recordAuditLog(
      {
        actorUserId: ctx.data.user.id,
        subjectId: id,
        action: "GROUP_DELETED",
        targetType: "StudentGroup",
        targetId: groupId,
        beforeState: { groupSetId, name: group.name },
        ipAddress,
      },
      tx
    );
  });

  return NextResponse.json({ ok: true });
}
