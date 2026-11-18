import type { PointLedgerEntryType, Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { jsonError, requireSubjectMember } from "@/lib/auth/guards";
import { db } from "@/lib/db";
import { ledgerQuerySchema, type LedgerFilterType } from "@/lib/validations/points";

function mapFilterToEntryTypes(
  filter: LedgerFilterType
): PointLedgerEntryType[] | null {
  switch (filter) {
    case "ATTENDANCE":
      return ["ATTENDANCE", "ATTENDANCE_ADJUSTMENT"];
    case "MERIT":
      return ["MERIT"];
    case "DEMERIT":
      return ["DEMERIT"];
    case "P2P":
      return ["P2P_SEND", "P2P_RECEIVE"];
    case "REDEMPTION":
      return ["REDEMPTION_ESCROW", "REDEMPTION_REFUND", "REDEMPTION_FINALIZE"];
    case "ALL":
    default:
      return null;
  }
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const member = await requireSubjectMember(id);
  if (!member.ok) {
    return member.response;
  }

  const { user, enrollment } = member.data;
  const { searchParams } = new URL(request.url);
  const parsed = ledgerQuerySchema.safeParse({
    filter: searchParams.get("filter") ?? undefined,
    enrollmentId: searchParams.get("enrollmentId") ?? undefined,
    page: searchParams.get("page") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
  });

  if (!parsed.success) {
    return jsonError(
      parsed.error.issues[0]?.message ?? "Invalid ledger query parameters.",
      400,
      "ERR_VALIDATION"
    );
  }

  let scopedEnrollmentId: string | undefined;
  if (user.role === "STUDENT") {
    if (
      parsed.data.enrollmentId &&
      parsed.data.enrollmentId !== enrollment?.id
    ) {
      return jsonError(
        "You can only view your own point ledger.",
        403,
        "ERR_FORBIDDEN"
      );
    }
    if (!enrollment) {
      return jsonError("Enrollment not found.", 404, "ERR_ENROLLMENT_NOT_FOUND");
    }
    scopedEnrollmentId = enrollment.id;
  } else if (parsed.data.enrollmentId) {
    const target = await db.subjectEnrollment.findUnique({
      where: { id: parsed.data.enrollmentId },
      select: { id: true, subjectId: true },
    });
    if (!target || target.subjectId !== id) {
      return jsonError("Enrollment not found.", 404, "ERR_ENROLLMENT_NOT_FOUND");
    }
    scopedEnrollmentId = target.id;
  }

  const types = mapFilterToEntryTypes(parsed.data.filter);
  const where: Prisma.PointLedgerEntryWhereInput = {
    subjectId: id,
    ...(scopedEnrollmentId ? { enrollmentId: scopedEnrollmentId } : {}),
    ...(types ? { entryType: { in: types } } : {}),
  };

  const skip = (parsed.data.page - 1) * parsed.data.limit;

  const [total, entries] = await Promise.all([
    db.pointLedgerEntry.count({ where }),
    db.pointLedgerEntry.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: parsed.data.limit,
      select: {
        id: true,
        enrollmentId: true,
        entryType: true,
        availableDelta: true,
        escrowDelta: true,
        availableAfter: true,
        escrowAfter: true,
        referenceType: true,
        referenceId: true,
        note: true,
        createdAt: true,
        actor: {
          select: {
            id: true,
            fullName: true,
            role: true,
          },
        },
        ...(user.role !== "STUDENT"
          ? {
              enrollment: {
                select: {
                  id: true,
                  student: {
                    select: {
                      id: true,
                      fullName: true,
                      institutionalId: true,
                    },
                  },
                },
              },
            }
          : {}),
      },
    }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / parsed.data.limit));

  return NextResponse.json({
    entries,
    pagination: {
      page: parsed.data.page,
      limit: parsed.data.limit,
      total,
      totalPages,
    },
  });
}
