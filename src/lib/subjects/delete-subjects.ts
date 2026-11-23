import type { Prisma } from "@prisma/client";
import { recordAuditLog } from "@/lib/audit";

export interface SubjectDeletionTarget {
  id: string;
  code: string;
  title: string;
  section: string;
  termId: string;
  isArchived: boolean;
  startDate: Date | null;
  endDate: Date | null;
  enrollments: {
    id: string;
    studentId: string;
    availableBalance: number;
    escrowedBalance: number;
  }[];
}

export interface DeleteSubjectsResult {
  deletedCount: number;
  unenrolledCount: number;
  clearedPointsTotal: number;
  notificationsDeleted: number;
}

/**
 * Permanently deletes one or more subjects/sections inside an active Prisma transaction,
 * unenrolling all students, clearing all accumulated points/ledgers and linked notifications,
 * and recording an immutable audit log entry.
 */
export async function deleteSubjectsInTransaction(
  tx: Prisma.TransactionClient,
  params: {
    subjects: SubjectDeletionTarget[];
    actorUserId: string | null;
    ipAddress: string | null;
  }
): Promise<DeleteSubjectsResult> {
  const { subjects, actorUserId, ipAddress } = params;
  if (subjects.length === 0) {
    return {
      deletedCount: 0,
      unenrolledCount: 0,
      clearedPointsTotal: 0,
      notificationsDeleted: 0,
    };
  }

  const subjectIds = subjects.map((s) => s.id);
  const allEnrollments = subjects.flatMap((s) => s.enrollments);
  const unenrolledStudentIds = Array.from(
    new Set(allEnrollments.map((e) => e.studentId))
  );
  const clearedPointsTotal = allEnrollments.reduce(
    (sum, item) => sum + item.availableBalance + item.escrowedBalance,
    0
  );

  // Delete assessments before GradeCategory/Subject cascade so Assessment.category (onDelete: Restrict) cannot block deletion.
  await tx.assessment.deleteMany({ where: { subjectId: { in: subjectIds } } });
  if (typeof tx.subjectMaterial?.deleteMany === "function") {
    await tx.subjectMaterial.deleteMany({
      where: { subjectId: { in: subjectIds } },
    });
  }
  if (typeof tx.subjectCoTeacher?.deleteMany === "function") {
    await tx.subjectCoTeacher.deleteMany({
      where: { subjectId: { in: subjectIds } },
    });
  }
  // Explicitly clear redemptions, point ledger entries, enrollments, and subject-linked notifications.
  await tx.redemptionRequest.deleteMany({
    where: { subjectId: { in: subjectIds } },
  });
  await tx.pointLedgerEntry.deleteMany({
    where: { subjectId: { in: subjectIds } },
  });
  await tx.subjectEnrollment.deleteMany({
    where: { subjectId: { in: subjectIds } },
  });
  const deletedNotifications = await tx.notification.deleteMany({
    where: { subjectId: { in: subjectIds } },
  });

  const notificationsDeleted = deletedNotifications?.count ?? 0;

  if (subjects.length === 1) {
    const prev = subjects[0]!;
    await recordAuditLog(
      {
        actorUserId,
        subjectId: null,
        action: "SUBJECT_DELETED",
        targetType: "Subject",
        targetId: prev.id,
        beforeState: {
          code: prev.code,
          title: prev.title,
          section: prev.section,
          startDate: prev.startDate?.toISOString() ?? null,
          endDate: prev.endDate?.toISOString() ?? null,
          isArchived: prev.isArchived,
          unenrolledCount: allEnrollments.length,
          unenrolledStudentIds,
          clearedPointsTotal,
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
        subjectId: null,
        action: "SUBJECTS_BULK_DELETED",
        targetType: "Subject",
        targetId: "BULK",
        beforeState: {
          deletedCount: subjects.length,
          unenrolledCount: allEnrollments.length,
          unenrolledStudentIds,
          clearedPointsTotal,
          notificationsDeleted,
          subjects: subjects.map((s) => ({
            id: s.id,
            code: s.code,
            title: s.title,
            section: s.section,
            enrollmentCount: s.enrollments.length,
          })),
        },
        ipAddress,
      },
      tx
    );
  }

  await tx.subject.deleteMany({ where: { id: { in: subjectIds } } });

  return {
    deletedCount: subjects.length,
    unenrolledCount: allEnrollments.length,
    clearedPointsTotal,
    notificationsDeleted,
  };
}
