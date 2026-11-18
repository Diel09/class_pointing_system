import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError, requireTeacherSubjectOwner } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import {
  addRosterSchema,
  parseRosterEntries,
} from "@/lib/validations/subject";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const owner = await requireTeacherSubjectOwner(id);
  if (!owner.ok) {
    return owner.response;
  }

  const roster = await db.subjectEnrollment.findMany({
    where: { subjectId: id },
    orderBy: { student: { fullName: "asc" } },
    select: {
      id: true,
      availableBalance: true,
      escrowedBalance: true,
      manualStandingOverride: true,
      enrolledAt: true,
      student: {
        select: {
          id: true,
          fullName: true,
          email: true,
          institutionalId: true,
          status: true,
        },
      },
    },
  });

  return NextResponse.json({ roster });
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

  const parsed = addRosterSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid roster payload.",
      400,
      "ERR_VALIDATION"
    );
  }

  const entries = parseRosterEntries(parsed.data.rawText);
  if (entries.length === 0) {
    return jsonError(
      "No valid email or student ID entries were found.",
      400,
      "ERR_EMPTY_ROSTER"
    );
  }
  if (entries.length > 200) {
    return jsonError(
      "You can import at most 200 entries per request.",
      400,
      "ERR_TOO_MANY_ENTRIES"
    );
  }

  const emailLookups = entries.map((e) => e.toLowerCase());
  const idLookups = entries.map((e) => e.toUpperCase());

  const matchedStudents = await db.user.findMany({
    where: {
      role: "STUDENT",
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

  const existingEnrollments = await db.subjectEnrollment.findMany({
    where: {
      subjectId: id,
      studentId: { in: matchedStudents.map((s) => s.id) },
    },
    select: { studentId: true },
  });
  const enrolledIds = new Set(existingEnrollments.map((e) => e.studentId));

  const toEnroll = matchedStudents.filter((s) => !enrolledIds.has(s.id));
  const alreadyEnrolled = matchedStudents.filter((s) => enrolledIds.has(s.id));

  const matchedKeys = new Set<string>();
  for (const s of matchedStudents) {
    matchedKeys.add(s.email.toLowerCase());
    if (s.institutionalId) {
      matchedKeys.add(s.institutionalId.toUpperCase());
    }
  }
  const notFound = entries.filter(
    (entry) =>
      !matchedKeys.has(entry.toLowerCase()) &&
      !matchedKeys.has(entry.toUpperCase())
  );

  const ipAddress = getClientIp(request);

  if (toEnroll.length > 0) {
    await db.$transaction(async (tx) => {
      await tx.subjectEnrollment.createMany({
        data: toEnroll.map((student) => ({
          subjectId: id,
          studentId: student.id,
          availableBalance: 0,
          escrowedBalance: 0,
        })),
        skipDuplicates: true,
      });

      await recordAuditLog(
        {
          actorUserId: owner.data.user.id,
          subjectId: id,
          action: "ROSTER_STUDENTS_ADDED",
          targetType: "Subject",
          targetId: id,
          afterState: {
            addedStudentIds: toEnroll.map((s) => s.id),
            count: toEnroll.length,
          },
          ipAddress,
        },
        tx
      );
    });
  }

  return NextResponse.json({
    added: toEnroll,
    alreadyEnrolled,
    notFound,
  });
}
