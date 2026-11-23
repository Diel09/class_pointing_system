import { NextResponse } from "next/server";
import { z } from "zod";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError, requireTeacherSubjectOwner } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import {
  computeTargetGroupCount,
  fetchSubjectGroupSets,
  generateUniqueGroupNames,
  shuffleItems,
} from "@/lib/groups/group-set-service";
import { autoAssignGroupsSchema } from "@/lib/validations/groups";

const uuidSchema = z.string().uuid();

export async function POST(
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
      "Cannot auto-assign groups on an archived subject.",
      400,
      "ERR_SUBJECT_ARCHIVED"
    );
  }

  if (!uuidSchema.safeParse(groupSetId).success) {
    return jsonError("Group set not found.", 404, "ERR_NOT_FOUND");
  }

  const groupSet = await db.groupSet.findUnique({
    where: { id: groupSetId },
    include: {
      groups: {
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      },
      memberships: {
        select: { groupId: true, enrollmentId: true },
      },
    },
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

  const parsed = autoAssignGroupsSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid auto-assign payload.",
      400,
      "ERR_VALIDATION"
    );
  }

  const enrollments = await db.subjectEnrollment.findMany({
    where: { subjectId: id },
    orderBy: { student: { fullName: "asc" } },
    select: { id: true },
  });

  if (enrollments.length === 0) {
    return jsonError(
      "No students are enrolled in this subject yet.",
      400,
      "ERR_EMPTY_ROSTER"
    );
  }

  const { scope, mode, value, shuffle, namePrefix } = parsed.data;
  const assignedEnrollmentIds = new Set(
    groupSet.memberships.map((m) => m.enrollmentId)
  );
  const candidateIds =
    scope === "all"
      ? enrollments.map((e) => e.id)
      : enrollments
          .filter((e) => !assignedEnrollmentIds.has(e.id))
          .map((e) => e.id);

  if (candidateIds.length === 0) {
    return jsonError(
      "All enrolled students are already assigned to a group in this set.",
      400,
      "ERR_NO_UNASSIGNED_STUDENTS"
    );
  }

  if (mode === "existing" && groupSet.groups.length === 0) {
    return jsonError(
      "Create at least one group first or choose a group count/size to auto-generate groups.",
      400,
      "ERR_NO_GROUPS"
    );
  }

  const orderedCandidates = shuffle ? shuffleItems(candidateIds) : candidateIds;
  const ipAddress = getClientIp(request);

  await db.$transaction(async (tx) => {
    const existingNames = new Set(
      groupSet.groups.map((g) => g.name.toLowerCase())
    );
    let targetGroups = [...groupSet.groups];

    if (mode === "count" || mode === "size") {
      const neededCount = computeTargetGroupCount(
        orderedCandidates.length,
        mode,
        value ?? 1
      );

      if (scope === "all") {
        // Reuse existing groups first so linked submissions/scores stay intact; create extra if needed.
        if (targetGroups.length < neededCount) {
          const extraNames = generateUniqueGroupNames(
            neededCount - targetGroups.length,
            namePrefix,
            existingNames
          );
          const startOrder =
            targetGroups.reduce((m, g) => Math.max(m, g.sortOrder), -1) + 1;
          const created = await Promise.all(
            extraNames.map((name, idx) =>
              tx.studentGroup.create({
                data: {
                  groupSetId,
                  name,
                  sortOrder: startOrder + idx,
                },
              })
            )
          );
          targetGroups = [...targetGroups, ...created];
        } else {
          targetGroups = targetGroups.slice(0, neededCount);
        }
      } else {
        const newNames = generateUniqueGroupNames(
          neededCount,
          namePrefix,
          existingNames
        );
        const startOrder =
          targetGroups.reduce((m, g) => Math.max(m, g.sortOrder), -1) + 1;
        targetGroups = await Promise.all(
          newNames.map((name, idx) =>
            tx.studentGroup.create({
              data: {
                groupSetId,
                name,
                sortOrder: startOrder + idx,
              },
            })
          )
        );
      }
    }

    if (scope === "all") {
      await tx.studentGroupMembership.deleteMany({
        where: { groupSetId },
      });
      await tx.studentGroupMembership.createMany({
        data: orderedCandidates.map((enrollmentId, idx) => ({
          groupSetId,
          groupId: targetGroups[idx % targetGroups.length]!.id,
          enrollmentId,
        })),
      });
    } else {
      // Balance unassigned students into target groups starting with the smallest group counts.
      const countByGroup = new Map<string, number>();
      for (const g of targetGroups) {
        countByGroup.set(g.id, 0);
      }
      if (mode === "existing") {
        for (const m of groupSet.memberships) {
          if (countByGroup.has(m.groupId)) {
            countByGroup.set(m.groupId, (countByGroup.get(m.groupId) ?? 0) + 1);
          }
        }
      }

      const assignments: {
        groupSetId: string;
        groupId: string;
        enrollmentId: string;
      }[] = [];

      for (const enrollmentId of orderedCandidates) {
        let bestGroupId = targetGroups[0]!.id;
        let bestCount = countByGroup.get(bestGroupId) ?? 0;
        for (const g of targetGroups) {
          const c = countByGroup.get(g.id) ?? 0;
          if (c < bestCount) {
            bestCount = c;
            bestGroupId = g.id;
          }
        }
        countByGroup.set(bestGroupId, bestCount + 1);
        assignments.push({
          groupSetId,
          groupId: bestGroupId,
          enrollmentId,
        });
      }

      await tx.studentGroupMembership.createMany({
        data: assignments,
      });
    }

    await recordAuditLog(
      {
        actorUserId: owner.data.user.id,
        subjectId: id,
        action: "GROUP_SET_AUTO_ASSIGNED",
        targetType: "GroupSet",
        targetId: groupSetId,
        afterState: {
          scope,
          mode,
          assignedCount: orderedCandidates.length,
        },
        ipAddress,
      },
      tx
    );
  });

  const { groupSets } = await fetchSubjectGroupSets(id);
  const updated = groupSets.find((gs) => gs.id === groupSetId) ?? null;

  return NextResponse.json({ groupSet: updated });
}
