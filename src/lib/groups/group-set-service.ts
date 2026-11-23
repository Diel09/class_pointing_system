import { db } from "@/lib/db";

/**
 * Returns a shuffled copy of an array using Fisher-Yates.
 */
export function shuffleItems<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/**
 * Computes the target number of groups for count-based or size-based auto-generation.
 */
export function computeTargetGroupCount(
  studentCount: number,
  mode: "count" | "size",
  value: number
): number {
  if (mode === "count") {
    return Math.max(1, value);
  }
  if (studentCount <= 0) {
    return 1;
  }
  return Math.max(1, Math.ceil(studentCount / Math.max(1, value)));
}

/**
 * Generates non-colliding group names such as "Group 1", "Group 2", etc.
 */
export function generateUniqueGroupNames(
  count: number,
  prefix: string,
  existingNames: Set<string>
): string[] {
  const names: string[] = [];
  let index = 1;
  while (names.length < count) {
    const candidate = `${prefix} ${index}`;
    const normalized = candidate.toLowerCase();
    if (!existingNames.has(normalized)) {
      existingNames.add(normalized);
      names.push(candidate);
    }
    index += 1;
  }
  return names;
}

export interface GroupSetMemberDto {
  enrollmentId: string;
  student: {
    id: string;
    fullName: string;
    email: string;
    institutionalId: string | null;
  };
}

export interface StudentGroupDto {
  id: string;
  name: string;
  sortOrder: number;
  members: GroupSetMemberDto[];
}

export interface GroupSetDto {
  id: string;
  subjectId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  groups: StudentGroupDto[];
  unassignedStudents: GroupSetMemberDto[];
  assessmentsUsing: {
    id: string;
    title: string;
    hasRecordedWork: boolean;
  }[];
  hasRecordedWork: boolean;
}

/**
 * Fetches all group sets for a subject along with group memberships, unassigned roster students,
 * and linked assessments so the UI can warn before editing in-use sets.
 */
export async function fetchSubjectGroupSets(subjectId: string): Promise<{
  groupSets: GroupSetDto[];
  totalEnrolled: number;
}> {
  const [enrollments, groupSets] = await Promise.all([
    db.subjectEnrollment.findMany({
      where: { subjectId },
      orderBy: { student: { fullName: "asc" } },
      select: {
        id: true,
        student: {
          select: {
            id: true,
            fullName: true,
            email: true,
            institutionalId: true,
          },
        },
      },
    }),
    db.groupSet.findMany({
      where: { subjectId },
      orderBy: [{ createdAt: "asc" }],
      include: {
        groups: {
          orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
          include: {
            memberships: {
              include: {
                enrollment: {
                  select: {
                    id: true,
                    student: {
                      select: {
                        id: true,
                        fullName: true,
                        email: true,
                        institutionalId: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
        assessments: {
          select: {
            id: true,
            title: true,
            _count: {
              select: {
                groupSubmissions: true,
                groupScores: true,
                scores: true,
              },
            },
          },
        },
      },
    }),
  ]);

  const mapped: GroupSetDto[] = groupSets.map((gs) => {
    const assignedIds = new Set<string>();
    const groups: StudentGroupDto[] = gs.groups.map((g) => {
      const members = g.memberships
        .map((m) => {
          assignedIds.add(m.enrollment.id);
          return {
            enrollmentId: m.enrollment.id,
            student: m.enrollment.student,
          };
        })
        .sort((a, b) => a.student.fullName.localeCompare(b.student.fullName));

      return {
        id: g.id,
        name: g.name,
        sortOrder: g.sortOrder,
        members,
      };
    });

    const unassignedStudents: GroupSetMemberDto[] = enrollments
      .filter((e) => !assignedIds.has(e.id))
      .map((e) => ({
        enrollmentId: e.id,
        student: e.student,
      }));

    const assessmentsUsing = gs.assessments.map((a) => ({
      id: a.id,
      title: a.title,
      hasRecordedWork:
        a._count.groupSubmissions > 0 ||
        a._count.groupScores > 0 ||
        a._count.scores > 0,
    }));

    return {
      id: gs.id,
      subjectId: gs.subjectId,
      name: gs.name,
      createdAt: gs.createdAt,
      updatedAt: gs.updatedAt,
      groups,
      unassignedStudents,
      assessmentsUsing,
      hasRecordedWork: assessmentsUsing.some((a) => a.hasRecordedWork),
    };
  });

  return {
    groupSets: mapped,
    totalEnrolled: enrollments.length,
  };
}
