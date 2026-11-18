import { NextResponse } from "next/server";
import { z } from "zod";
import { jsonError, requireSubjectMember } from "@/lib/auth/guards";
import { db } from "@/lib/db";

const uuidSchema = z.string().uuid();

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const member = await requireSubjectMember(id);
  if (!member.ok) {
    return member.response;
  }

  const { user, subject, enrollment } = member.data;
  const { searchParams } = new URL(request.url);
  const requestedEnrollmentId = searchParams.get("enrollmentId");

  if (user.role === "STUDENT") {
    if (
      requestedEnrollmentId &&
      requestedEnrollmentId !== enrollment?.id
    ) {
      return jsonError(
        "You can only view your own wallet.",
        403,
        "ERR_FORBIDDEN"
      );
    }
    if (!enrollment) {
      return jsonError("Enrollment not found.", 404, "ERR_ENROLLMENT_NOT_FOUND");
    }

    const entries = await db.pointLedgerEntry.findMany({
      where: { enrollmentId: enrollment.id },
      select: { entryType: true, availableDelta: true, escrowDelta: true },
    });

    let totalEarned = 0;
    let totalDemerits = 0;
    let totalSpent = 0;
    let meritCount = 0;
    let demeritCount = 0;
    let attendanceCount = 0;

    for (const entry of entries) {
      if (
        entry.entryType === "MERIT" ||
        entry.entryType === "ATTENDANCE" ||
        entry.entryType === "P2P_RECEIVE" ||
        (entry.entryType === "ATTENDANCE_ADJUSTMENT" && entry.availableDelta > 0)
      ) {
        totalEarned += Math.max(0, entry.availableDelta);
      }
      if (entry.entryType === "MERIT") {
        meritCount += 1;
      }
      if (entry.entryType === "DEMERIT") {
        demeritCount += 1;
        totalDemerits += Math.abs(entry.availableDelta);
      }
      if (entry.entryType === "ATTENDANCE") {
        attendanceCount += 1;
      }
      if (entry.entryType === "REDEMPTION_FINALIZE") {
        totalSpent += Math.abs(entry.escrowDelta);
      } else if (entry.entryType === "P2P_SEND") {
        totalSpent += Math.abs(entry.availableDelta);
      }
    }

    return NextResponse.json({
      wallet: {
        enrollmentId: enrollment.id,
        availableBalance: enrollment.availableBalance,
        escrowedBalance: enrollment.escrowedBalance,
        manualStandingOverride: enrollment.manualStandingOverride,
        allowNegativeBalance: subject.allowNegativeBalance,
        totalEarned,
        totalDemerits,
        totalSpent,
        meritCount,
        demeritCount,
        attendanceCount,
      },
    });
  }

  if (requestedEnrollmentId) {
    if (!uuidSchema.safeParse(requestedEnrollmentId).success) {
      return jsonError("Enrollment not found.", 404, "ERR_ENROLLMENT_NOT_FOUND");
    }
    const targetEnrollment = await db.subjectEnrollment.findUnique({
      where: { id: requestedEnrollmentId },
      include: {
        student: { select: { id: true, fullName: true, institutionalId: true } },
      },
    });
    if (!targetEnrollment || targetEnrollment.subjectId !== id) {
      return jsonError("Enrollment not found.", 404, "ERR_ENROLLMENT_NOT_FOUND");
    }
    const entries = await db.pointLedgerEntry.findMany({
      where: { enrollmentId: targetEnrollment.id },
      select: { entryType: true, availableDelta: true },
    });

    let totalEarned = 0;
    let totalDemerits = 0;
    let meritCount = 0;
    let demeritCount = 0;
    for (const entry of entries) {
      if (entry.availableDelta > 0) totalEarned += entry.availableDelta;
      if (entry.entryType === "MERIT") meritCount += 1;
      if (entry.entryType === "DEMERIT") {
        demeritCount += 1;
        totalDemerits += Math.abs(entry.availableDelta);
      }
    }

    return NextResponse.json({
      wallet: {
        enrollmentId: targetEnrollment.id,
        student: targetEnrollment.student,
        availableBalance: targetEnrollment.availableBalance,
        escrowedBalance: targetEnrollment.escrowedBalance,
        allowNegativeBalance: subject.allowNegativeBalance,
        totalEarned,
        totalDemerits,
        meritCount,
        demeritCount,
      },
    });
  }

  const [aggregates, meritCount, demeritCount] = await Promise.all([
    db.subjectEnrollment.aggregate({
      where: { subjectId: id },
      _sum: { availableBalance: true, escrowedBalance: true },
      _count: { _all: true },
    }),
    db.pointLedgerEntry.count({
      where: { subjectId: id, entryType: "MERIT" },
    }),
    db.pointLedgerEntry.count({
      where: { subjectId: id, entryType: "DEMERIT" },
    }),
  ]);

  return NextResponse.json({
    subjectSummary: {
      enrolledStudents: aggregates._count._all,
      totalAvailableBalance: aggregates._sum.availableBalance ?? 0,
      totalEscrowedBalance: aggregates._sum.escrowedBalance ?? 0,
      meritCount,
      demeritCount,
      allowNegativeBalance: subject.allowNegativeBalance,
    },
  });
}
