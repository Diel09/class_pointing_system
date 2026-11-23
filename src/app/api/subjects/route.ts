import { NextResponse } from "next/server";
import { getClientIp, recordAuditLog } from "@/lib/audit";
import { jsonError, requireAuth, requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { DEFAULT_SINGLE_TERM_CATEGORIES } from "@/lib/grading/default-scale";
import {
  createSubjectSchema,
  generateInviteCode,
} from "@/lib/validations/subject";

export async function GET(request: Request) {
  const auth = await requireAuth();
  if (!auth.ok) {
    return auth.response;
  }

  const user = auth.data;
  const { searchParams } = new URL(request.url);
  const archivedParam = searchParams.get("archived");
  const archivedFilter =
    archivedParam === "true" ? true : archivedParam === "false" ? false : undefined;

  if (user.role === "TEACHER") {
    const subjects = await db.subject.findMany({
      where: {
        OR: [
          { teacherId: user.id },
          { coTeachers: { some: { teacherId: user.id } } },
        ],
        ...(archivedFilter !== undefined ? { isArchived: archivedFilter } : {}),
      },
      orderBy: [{ isArchived: "asc" }, { createdAt: "desc" }],
      include: {
        teacher: { select: { id: true, fullName: true, email: true } },
        coTeachers: {
          orderBy: { addedAt: "asc" },
          include: {
            teacher: {
              select: {
                id: true,
                fullName: true,
                email: true,
                institutionalId: true,
              },
            },
          },
        },
        term: { select: { id: true, name: true, isActive: true } },
        _count: { select: { enrollments: true } },
      },
    });
    return NextResponse.json({ role: user.role, subjects });
  }

  if (user.role === "STUDENT") {
    const enrollments = await db.subjectEnrollment.findMany({
      where: {
        studentId: user.id,
        subject:
          archivedFilter !== undefined
            ? { isArchived: archivedFilter }
            : { isArchived: false },
      },
      orderBy: { enrolledAt: "desc" },
      include: {
        subject: {
          include: {
            teacher: { select: { id: true, fullName: true, email: true } },
            coTeachers: {
              orderBy: { addedAt: "asc" },
              include: {
                teacher: {
                  select: {
                    id: true,
                    fullName: true,
                    email: true,
                    institutionalId: true,
                  },
                },
              },
            },
            term: { select: { id: true, name: true, isActive: true } },
          },
        },
      },
    });

    const subjects = enrollments.map((enrollment) => ({
      ...enrollment.subject,
      enrollment: {
        id: enrollment.id,
        availableBalance: enrollment.availableBalance,
        escrowedBalance: enrollment.escrowedBalance,
        manualStandingOverride: enrollment.manualStandingOverride,
        enrolledAt: enrollment.enrolledAt,
      },
    }));

    return NextResponse.json({ role: user.role, subjects });
  }

  // ADMIN oversight view
  const subjects = await db.subject.findMany({
    where: archivedFilter !== undefined ? { isArchived: archivedFilter } : {},
    orderBy: { createdAt: "desc" },
    include: {
      teacher: { select: { id: true, fullName: true, email: true } },
      coTeachers: {
        orderBy: { addedAt: "asc" },
        include: {
          teacher: {
            select: {
              id: true,
              fullName: true,
              email: true,
              institutionalId: true,
            },
          },
        },
      },
      term: { select: { id: true, name: true, isActive: true } },
      _count: { select: { enrollments: true } },
    },
  });

  return NextResponse.json({ role: user.role, subjects });
}

export async function POST(request: Request) {
  const roleCheck = await requireRole(["TEACHER"]);
  if (!roleCheck.ok) {
    return roleCheck.response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON request body.", 400, "ERR_INVALID_JSON");
  }

  const parsed = createSubjectSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid subject input.",
      400,
      "ERR_VALIDATION"
    );
  }

  let termId = parsed.data.termId;
  if (termId) {
    const termExists = await db.academicTerm.findUnique({
      where: { id: termId },
      select: { id: true },
    });
    if (!termExists) {
      return jsonError("Selected academic term not found.", 404, "ERR_TERM_NOT_FOUND");
    }
  } else {
    const activeTerm = await db.academicTerm.findFirst({
      where: { isActive: true },
      orderBy: { startDate: "desc" },
      select: { id: true },
    });
    if (!activeTerm) {
      return jsonError(
        "No active academic term is configured. Ask an administrator to create one.",
        400,
        "ERR_NO_ACTIVE_TERM"
      );
    }
    termId = activeTerm.id;
  }

  // Generate a collision-free invite code.
  let inviteCode = generateInviteCode(8);
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const clash = await db.subject.findUnique({
      where: { inviteCode },
      select: { id: true },
    });
    if (!clash) break;
    inviteCode = generateInviteCode(8);
  }

  const ipAddress = getClientIp(request);

  const subject = await db.$transaction(async (tx) => {
    const created = await tx.subject.create({
      data: {
        teacherId: roleCheck.data.id,
        termId,
        code: parsed.data.code,
        title: parsed.data.title,
        section: parsed.data.section,
        ...(parsed.data.startDate !== undefined
          ? { startDate: parsed.data.startDate }
          : {}),
        ...(parsed.data.endDate !== undefined
          ? { endDate: parsed.data.endDate }
          : {}),
        ...(parsed.data.pointsEnabled !== undefined
          ? { pointsEnabled: parsed.data.pointsEnabled }
          : {}),
        inviteCode,
      },
      include: {
        term: { select: { id: true, name: true, isActive: true } },
        _count: { select: { enrollments: true } },
      },
    });

    if (typeof tx.gradeCategory?.createMany === "function") {
      await tx.gradeCategory.createMany({
        data: DEFAULT_SINGLE_TERM_CATEGORIES.map((category) => ({
          subjectId: created.id,
          termKey: category.termKey,
          name: category.name,
          categoryType: category.categoryType,
          weightPct: category.weightPct,
          aggregationMethod: category.aggregationMethod,
          targetPointsCap: category.targetPointsCap,
          sortOrder: category.sortOrder,
        })),
      });
    }

    await recordAuditLog(
      {
        actorUserId: roleCheck.data.id,
        subjectId: created.id,
        action: "SUBJECT_CREATED",
        targetType: "Subject",
        targetId: created.id,
        afterState: {
          code: created.code,
          title: created.title,
          section: created.section,
          startDate: created.startDate?.toISOString() ?? null,
          endDate: created.endDate?.toISOString() ?? null,
          pointsEnabled: created.pointsEnabled,
          inviteCode: created.inviteCode,
        },
        ipAddress,
      },
      tx
    );

    return created;
  });

  return NextResponse.json({ subject }, { status: 201 });
}
