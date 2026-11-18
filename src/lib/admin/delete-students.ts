import type { Prisma } from "@prisma/client";
import { recordAuditLog } from "@/lib/audit";

export interface StudentDeletionTarget {
  id: string;
  email: string;
  institutionalId: string | null;
  fullName: string;
  status: string;
  enrollments: {
    id: string;
    subjectId: string;
    availableBalance: number;
    escrowedBalance: number;
  }[];
}

export interface DeleteStudentsResult {
  deletedCount: number;
  unenrolledCount: number;
  clearedPointsTotal: number;
}

/**
 * Permanently deletes one or more STUDENT accounts inside an active Prisma transaction,
 * removing their subject enrollments (and cascading class attendance/scores/redemptions/ledgers),
 * clearing notifications/subscriptions/reset tokens, and preserving peer P2P ledger entries
 * via nullable actorUserId (onDelete: SetNull).
 */
export async function deleteStudentsInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    students: StudentDeletionTarget[];
    actorUserId: string | null;
    ipAddress: string | null;
  }
): Promise<DeleteStudentsResult> {
  const { students, actorUserId, ipAddress } = params;
  if (students.length === 0) {
    return {
      deletedCount: 0,
      unenrolledCount: 0,
      clearedPointsTotal: 0,
    };
  }

  const studentIds = students.map((s) => s.id);
  const allEnrollments = students.flatMap((s) => s.enrollments);
  const clearedPointsTotal = allEnrollments.reduce(
    (sum, item) => sum + item.availableBalance + item.escrowedBalance,
    0
  );

  // Remove enrollments first so student-owned ledger entries cascade cleanly before deleting User.
  await tx.subjectEnrollment.deleteMany({
    where: { studentId: { in: studentIds } },
  });
  await tx.notification.deleteMany({
    where: { userId: { in: studentIds } },
  });
  await tx.pushSubscription.deleteMany({
    where: { userId: { in: studentIds } },
  });
  await tx.passwordResetToken.deleteMany({
    where: { userId: { in: studentIds } },
  });

  if (students.length === 1) {
    const prev = students[0]!;
    await recordAuditLog(
      {
        actorUserId,
        action: "ADMIN_STUDENT_DELETED",
        targetType: "User",
        targetId: prev.id,
        beforeState: {
          email: prev.email,
          institutionalId: prev.institutionalId,
          fullName: prev.fullName,
          status: prev.status,
          unenrolledCount: allEnrollments.length,
          clearedPointsTotal,
        },
        ipAddress,
      },
      tx
    );
  } else {
    await recordAuditLog(
      {
        actorUserId,
        action: "ADMIN_STUDENTS_BULK_DELETED",
        targetType: "User",
        targetId: "BULK",
        beforeState: {
          deletedCount: students.length,
          unenrolledCount: allEnrollments.length,
          clearedPointsTotal,
          students: students.map((s) => ({
            id: s.id,
            email: s.email,
            institutionalId: s.institutionalId,
            fullName: s.fullName,
            enrollmentCount: s.enrollments.length,
          })),
        },
        ipAddress,
      },
      tx
    );
  }

  await tx.user.deleteMany({
    where: { id: { in: studentIds }, role: "STUDENT" },
  });

  return {
    deletedCount: students.length,
    unenrolledCount: allEnrollments.length,
    clearedPointsTotal,
  };
}
