import type { Prisma } from "@prisma/client";
import { recordAuditLog } from "@/lib/audit";

export interface EnrollmentRemovalTarget {
  id: string;
  studentId: string;
  availableBalance: number;
  escrowedBalance: number;
  student: {
    id: string;
    fullName: string;
    email: string;
    institutionalId: string | null;
  };
}

export interface UnenrollStudentsResult {
  unenrolledCount: number;
  clearedPointsTotal: number;
  notificationsDeleted: number;
}

/**
 * Permanently unenrolls one or more students from a single subject inside an active
 * Prisma transaction, clearing their subject-scoped attendance, scores, point ledgers,
 * redemptions, and notifications while keeping their user accounts and other subjects intact.
 */
export async function unenrollStudentsInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    subjectId: string;
    enrollments: EnrollmentRemovalTarget[];
    actorUserId: string;
    ipAddress: string | null;
  }
): Promise<UnenrollStudentsResult> {
  const { subjectId, enrollments, actorUserId, ipAddress } = params;
  if (enrollments.length === 0) {
    return {
      unenrolledCount: 0,
      clearedPointsTotal: 0,
      notificationsDeleted: 0,
    };
  }

  const enrollmentIds = enrollments.map((e) => e.id);
  const studentIds = Array.from(new Set(enrollments.map((e) => e.studentId)));
  const clearedPointsTotal = enrollments.reduce(
    (sum, item) => sum + item.availableBalance + item.escrowedBalance,
    0
  );

  await tx.subjectEnrollment.deleteMany({
    where: { id: { in: enrollmentIds }, subjectId },
  });

  const deletedNotifications = await tx.notification.deleteMany({
    where: { subjectId, userId: { in: studentIds } },
  });
  const notificationsDeleted = deletedNotifications?.count ?? 0;

  if (enrollments.length === 1) {
    const prev = enrollments[0]!;
    await recordAuditLog(
      {
        actorUserId,
        subjectId,
        action: "ROSTER_STUDENT_REMOVED",
        targetType: "SubjectEnrollment",
        targetId: prev.id,
        beforeState: {
          studentId: prev.student.id,
          fullName: prev.student.fullName,
          email: prev.student.email,
          institutionalId: prev.student.institutionalId,
          availableBalance: prev.availableBalance,
          escrowedBalance: prev.escrowedBalance,
          notificationsDeleted,
        },
        ipAddress,
      },
      tx
    );
  } else {
    await recordAuditLog(
      {
        actorUserId,
        subjectId,
        action: "ROSTER_STUDENTS_BULK_REMOVED",
        targetType: "Subject",
        targetId: subjectId,
        beforeState: {
          unenrolledCount: enrollments.length,
          clearedPointsTotal,
          notificationsDeleted,
          students: enrollments.map((item) => ({
            enrollmentId: item.id,
            studentId: item.student.id,
            fullName: item.student.fullName,
            email: item.student.email,
            institutionalId: item.student.institutionalId,
            availableBalance: item.availableBalance,
            escrowedBalance: item.escrowedBalance,
          })),
        },
        ipAddress,
      },
      tx
    );
  }

  return {
    unenrolledCount: enrollments.length,
    clearedPointsTotal,
    notificationsDeleted,
  };
}
