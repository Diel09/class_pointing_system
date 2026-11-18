import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { db } from "@/lib/db";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  const roleCheck = await requireRole(["ADMIN"]);
  if (!roleCheck.ok) {
    return roleCheck.response;
  }

  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const actionFilter = (searchParams.get("action") ?? "").trim();
  const subjectIdParam = (searchParams.get("subjectId") ?? "").trim();
  const pageRaw = Number.parseInt(searchParams.get("page") ?? "1", 10);
  const limitRaw = Number.parseInt(searchParams.get("limit") ?? "25", 10);

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 25;

  const where: Prisma.AuditLogWhereInput = {};

  if (actionFilter) {
    where.action = actionFilter;
  }

  if (subjectIdParam && UUID_REGEX.test(subjectIdParam)) {
    where.subjectId = subjectIdParam;
  }

  if (q) {
    where.OR = [
      { action: { contains: q, mode: "insensitive" } },
      { targetType: { contains: q, mode: "insensitive" } },
      { targetId: { contains: q, mode: "insensitive" } },
      { ipAddress: { contains: q, mode: "insensitive" } },
      {
        actor: {
          is: {
            OR: [
              { fullName: { contains: q, mode: "insensitive" } },
              { email: { contains: q, mode: "insensitive" } },
            ],
          },
        },
      },
      {
        subject: {
          is: {
            OR: [
              { code: { contains: q, mode: "insensitive" } },
              { title: { contains: q, mode: "insensitive" } },
            ],
          },
        },
      },
    ];
  }

  const [
    total,
    logs,
    distinctActionRows,
    totalUsers,
    pendingTeachers,
    activeSubjects,
    totalEnrollments,
  ] = await Promise.all([
    db.auditLog.count({ where }),
    db.auditLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * limit,
      take: limit,
      select: {
        id: true,
        action: true,
        targetType: true,
        targetId: true,
        beforeState: true,
        afterState: true,
        ipAddress: true,
        createdAt: true,
        actor: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
          },
        },
        subject: {
          select: {
            id: true,
            code: true,
            title: true,
            section: true,
          },
        },
      },
    }),
    db.auditLog.findMany({
      distinct: ["action"],
      orderBy: { action: "asc" },
      select: { action: true },
    }),
    db.user.count(),
    db.user.count({ where: { role: "TEACHER", status: "PENDING" } }),
    db.subject.count({ where: { isArchived: false } }),
    db.subjectEnrollment.count(),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / limit));

  return NextResponse.json({
    logs,
    total,
    page,
    limit,
    totalPages,
    actions: distinctActionRows.map((row) => row.action),
    summary: {
      totalUsers,
      pendingTeachers,
      activeSubjects,
      totalEnrollments,
    },
  });
}
