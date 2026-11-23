import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import {
  jsonError,
  requireSubjectInstructor,
  requireTeacherSubjectOwner,
} from "@/lib/auth/guards";
import { db } from "@/lib/db";
import {
  computeTargetGroupCount,
  fetchSubjectGroupSets,
  generateUniqueGroupNames,
  shuffleItems,
} from "@/lib/groups/group-set-service";
import { createGroupSetSchema } from "@/lib/validations/groups";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const instructor = await requireSubjectInstructor(id);
  if (!instructor.ok) {
    return instructor.response;
  }

  const data = await fetchSubjectGroupSets(id);
  return NextResponse.json(data);
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

  if (owner.data.subject.isArchived) {
    return jsonError(
      "Cannot create group sets on an archived subject.",
      400,
      "ERR_SUBJECT_ARCHIVED"
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = createGroupSetSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid group set payload.",
      400,
      "ERR_VALIDATION"
    );
  }

  const existing = await db.groupSet.findFirst({
    where: {
      subjectId: id,
      name: { equals: parsed.data.name, mode: "insensitive" },
    },
    select: { id: true },
  });
  if (existing) {
    return jsonError(
      `A group set named "${parsed.data.name}" already exists in this class.`,
      409,
      "ERR_GROUP_SET_EXISTS"
    );
  }

  const ipAddress = getClientIp(request);

  try {
    const createdId = await db.$transaction(async (tx) => {
      const groupSet = await tx.groupSet.create({
        data: {
          subjectId: id,
          name: parsed.data.name,
        },
      });

      let groupsCreated = 0;
      let membersAssigned = 0;

      if (parsed.data.autoGenerate) {
        const enrollments = await tx.subjectEnrollment.findMany({
          where: { subjectId: id },
          orderBy: { student: { fullName: "asc" } },
          select: { id: true },
        });
        const orderedIds = parsed.data.autoGenerate.shuffle
          ? shuffleItems(enrollments.map((e) => e.id))
          : enrollments.map((e) => e.id);

        const groupCount = computeTargetGroupCount(
          orderedIds.length,
          parsed.data.autoGenerate.mode,
          parsed.data.autoGenerate.value
        );
        const names = generateUniqueGroupNames(
          groupCount,
          parsed.data.autoGenerate.namePrefix,
          new Set<string>()
        );

        const createdGroups = await Promise.all(
          names.map((groupName, index) =>
            tx.studentGroup.create({
              data: {
                groupSetId: groupSet.id,
                name: groupName,
                sortOrder: index,
              },
            })
          )
        );
        groupsCreated = createdGroups.length;

        if (orderedIds.length > 0 && createdGroups.length > 0) {
          await tx.studentGroupMembership.createMany({
            data: orderedIds.map((enrollmentId, idx) => ({
              groupSetId: groupSet.id,
              groupId: createdGroups[idx % createdGroups.length]!.id,
              enrollmentId,
            })),
          });
          membersAssigned = orderedIds.length;
        }
      }

      await recordAuditLog(
        {
          actorUserId: owner.data.user.id,
          subjectId: id,
          action: "GROUP_SET_CREATED",
          targetType: "GroupSet",
          targetId: groupSet.id,
          afterState: {
            name: groupSet.name,
            groupsCreated,
            membersAssigned,
          },
          ipAddress,
        },
        tx
      );

      return groupSet.id;
    });

    const { groupSets } = await fetchSubjectGroupSets(id);
    const created = groupSets.find((gs) => gs.id === createdId) ?? null;

    return NextResponse.json({ groupSet: created }, { status: 201 });
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
