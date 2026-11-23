import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import {
  jsonError,
  requireSubjectMember,
  requireTeacherSubjectOwner,
} from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { dispatchNotifications } from "@/lib/notifications/dispatch";
import {
  addCoTeachersSchema,
  parseRosterEntries,
} from "@/lib/validations/subject";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const member = await requireSubjectMember(id);
  if (!member.ok) {
    return member.response;
  }

  const coTeachers =
    typeof db.subjectCoTeacher?.findMany === "function"
      ? await db.subjectCoTeacher.findMany({
          where: { subjectId: id },
          orderBy: { addedAt: "asc" },
          select: {
            id: true,
            teacherId: true,
            addedAt: true,
            teacher: {
              select: {
                id: true,
                fullName: true,
                email: true,
                institutionalId: true,
                status: true,
              },
            },
          },
        })
      : [];

  return NextResponse.json({ coTeachers });
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = addCoTeachersSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid co-teacher payload.",
      400,
      "ERR_VALIDATION"
    );
  }

  const entries = parseRosterEntries(parsed.data.rawText);
  if (entries.length === 0) {
    return jsonError(
      "No valid teacher email or institutional ID entries were found.",
      400,
      "ERR_EMPTY_ENTRIES"
    );
  }
  if (entries.length > 50) {
    return jsonError(
      "You can add at most 50 co-teachers per request.",
      400,
      "ERR_TOO_MANY_ENTRIES"
    );
  }

  const emailLookups = entries.map((e) => e.toLowerCase());
  const idLookups = entries.map((e) => e.toUpperCase());

  const matchedTeachers = await db.user.findMany({
    where: {
      role: "TEACHER",
      status: "ACTIVE",
      OR: [
        { email: { in: emailLookups } },
        { institutionalId: { in: idLookups } },
      ],
    },
    select: {
      id: true,
      email: true,
      institutionalId: true,
      fullName: true,
    },
  });

  const existingCoTeachers = await db.subjectCoTeacher.findMany({
    where: {
      subjectId: id,
      teacherId: { in: matchedTeachers.map((t) => t.id) },
    },
    select: { teacherId: true },
  });
  const existingIds = new Set(existingCoTeachers.map((c) => c.teacherId));

  const primaryOwnerId = owner.data.subject.teacherId;

  const toAdd = matchedTeachers.filter(
    (t) => t.id !== primaryOwnerId && !existingIds.has(t.id)
  );
  const alreadyCoTeacher = matchedTeachers.filter(
    (t) => t.id === primaryOwnerId || existingIds.has(t.id)
  );

  const matchedKeys = new Set<string>();
  for (const t of matchedTeachers) {
    matchedKeys.add(t.email.toLowerCase());
    if (t.institutionalId) {
      matchedKeys.add(t.institutionalId.toUpperCase());
    }
  }
  const notFound = entries.filter(
    (entry) =>
      !matchedKeys.has(entry.toLowerCase()) &&
      !matchedKeys.has(entry.toUpperCase())
  );

  const ipAddress = getClientIp(request);

  if (toAdd.length > 0) {
    await db.$transaction(async (tx) => {
      await tx.subjectCoTeacher.createMany({
        data: toAdd.map((teacher) => ({
          subjectId: id,
          teacherId: teacher.id,
          addedByUserId: owner.data.user.id,
        })),
        skipDuplicates: true,
      });

      await recordAuditLog(
        {
          actorUserId: owner.data.user.id,
          subjectId: id,
          action: "CO_TEACHERS_ADDED",
          targetType: "Subject",
          targetId: id,
          afterState: {
            addedTeacherIds: toAdd.map((t) => t.id),
            count: toAdd.length,
          },
          ipAddress,
        },
        tx
      );
    });

    await dispatchNotifications(
      toAdd.map((teacher) => ({
        userId: teacher.id,
        subjectId: id,
        type: "CO_TEACHER_ADDED" as const,
        title: `Added as Co-Teacher (${owner.data.subject.code})`,
        body: `${owner.data.user.fullName} added you as a co-teacher in ${owner.data.subject.code} • ${owner.data.subject.section} (${owner.data.subject.title}).`,
        linkUrl: `/subjects/${id}`,
      }))
    );
  }

  return NextResponse.json({
    added: toAdd,
    alreadyCoTeacher,
    notFound,
  });
}
