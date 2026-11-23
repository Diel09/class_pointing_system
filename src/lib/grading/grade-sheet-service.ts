import { db } from "@/lib/db";
import {
  computeStanding,
  round2,
  type ComputeStandingResult,
  type TermSplitConfig,
} from "@/lib/grading/computeStanding";
import {
  DEFAULT_PH_GRADE_SCALE,
  type GradeScaleRuleInput,
} from "@/lib/grading/default-scale";
import { parseTermSplitConfig } from "@/lib/grading/standing-service";

export interface GradeSheetSubjectMeta {
  id: string;
  code: string;
  title: string;
  section: string;
  termName: string;
  teacherName: string;
  teacherEmail: string;
  startDate: Date | null;
  endDate: Date | null;
  standingVisible: boolean;
  lateAttendanceCreditPct: number;
  termSplitConfig: TermSplitConfig | null;
  usingDefaultScale: boolean;
  gradeScaleRules: GradeScaleRuleInput[];
}

export interface GradeSheetCategoryMeta {
  id: string;
  termKey: string;
  termLabel: string;
  name: string;
  categoryType: "ASSESSMENT" | "ATTENDANCE" | "POINTS_PARTICIPATION";
  weightPct: number;
  aggregationMethod: "TOTAL_POINTS" | "EQUAL_AVERAGE";
  targetPointsCap: number | null;
}

export interface GradeSheetAssessmentMeta {
  id: string;
  categoryId: string;
  categoryName: string;
  termKey: string;
  title: string;
  maxScore: number;
  assessmentDate: Date | null;
}

export interface AttendanceSummary {
  present: number;
  late: number;
  absent: number;
  excused: number;
  totalRecorded: number;
  countable: number;
  ratePct: number | null;
}

export interface GradeSheetStudentRow {
  enrollmentId: string;
  enrolledAt: Date;
  student: {
    id: string;
    fullName: string;
    email: string;
    institutionalId: string | null;
  };
  attendanceSummary: AttendanceSummary;
  remarksByAssessmentId: Record<string, string | null>;
  standing: ComputeStandingResult;
}

export interface SubjectGradeSheetData {
  subject: GradeSheetSubjectMeta;
  categories: GradeSheetCategoryMeta[];
  assessments: GradeSheetAssessmentMeta[];
  students: GradeSheetStudentRow[];
  exportedAt: Date;
}

function summarizeAttendance(
  records: { status: "PRESENT" | "LATE" | "ABSENT" | "EXCUSED" }[],
  lateAttendanceCreditPct: number
): AttendanceSummary {
  let present = 0;
  let late = 0;
  let absent = 0;
  let excused = 0;

  for (const record of records) {
    if (record.status === "PRESENT") present += 1;
    else if (record.status === "LATE") late += 1;
    else if (record.status === "ABSENT") absent += 1;
    else if (record.status === "EXCUSED") excused += 1;
  }

  const countable = present + late + absent;
  const clampedLateCredit = Math.max(0, Math.min(100, lateAttendanceCreditPct));
  const ratePct =
    countable > 0
      ? round2((present * 100 + late * clampedLateCredit) / countable)
      : null;

  return {
    present,
    late,
    absent,
    excused,
    totalRecorded: records.length,
    countable,
    ratePct,
  };
}

/**
 * Loads subject metadata, grading configuration, assessments, attendance, points,
 * and computed standings for either the full class or a single enrolled student.
 */
export async function buildSubjectGradeSheetData(options: {
  subjectId: string;
  enrollmentId?: string;
}): Promise<SubjectGradeSheetData | null> {
  const { subjectId, enrollmentId } = options;

  const [subject, categories, assessments, scaleRules, enrollments, activityCount] =
    await Promise.all([
      db.subject.findUnique({
        where: { id: subjectId },
        select: {
          id: true,
          code: true,
          title: true,
          section: true,
          startDate: true,
          endDate: true,
          pointsEnabled: true,
          standingVisible: true,
          lateAttendanceCreditPct: true,
          termSplitConfig: true,
          teacher: {
            select: {
              fullName: true,
              email: true,
            },
          },
          term: {
            select: {
              name: true,
            },
          },
        },
      }),
      db.gradeCategory.findMany({
        where: { subjectId },
        orderBy: [{ termKey: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
      }),
      db.assessment.findMany({
        where: { subjectId },
        orderBy: [{ assessmentDate: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          categoryId: true,
          title: true,
          maxScore: true,
          assessmentDate: true,
        },
      }),
      db.gradeScaleRule.findMany({
        where: { subjectId },
        orderBy: [{ sortOrder: "asc" }, { minPct: "asc" }],
      }),
      db.subjectEnrollment.findMany({
        where: {
          subjectId,
          ...(enrollmentId ? { id: enrollmentId } : {}),
        },
        orderBy: { student: { fullName: "asc" } },
        select: {
          id: true,
          enrolledAt: true,
          manualStandingOverride: true,
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
      db.pointLedgerEntry.count({
        where: {
          subjectId,
          entryType: { in: ["ATTENDANCE", "ATTENDANCE_ADJUSTMENT", "MERIT"] },
        },
      }),
    ]);

  if (!subject) {
    return null;
  }

  if (enrollmentId && enrollments.length === 0) {
    return null;
  }

  const enrollmentIds = enrollments.map((e) => e.id);
  const [scores, attendanceRecords, earnedPointSums] =
    enrollmentIds.length > 0
      ? await Promise.all([
          db.assessmentScore.findMany({
            where: {
              enrollmentId: { in: enrollmentIds },
              assessment: { subjectId },
            },
            select: {
              enrollmentId: true,
              assessmentId: true,
              status: true,
              rawScore: true,
              bonusPoints: true,
              allowExtraCredit: true,
              remarks: true,
            },
          }),
          db.attendanceRecord.findMany({
            where: {
              enrollmentId: { in: enrollmentIds },
              session: { subjectId },
            },
            select: {
              enrollmentId: true,
              status: true,
            },
          }),
          db.pointLedgerEntry.groupBy({
            by: ["enrollmentId"],
            where: {
              subjectId,
              enrollmentId: { in: enrollmentIds },
              entryType: {
                in: ["ATTENDANCE", "ATTENDANCE_ADJUSTMENT", "MERIT"],
              },
            },
            _sum: { availableDelta: true },
          }),
        ])
      : [[], [], []];

  const scoresByEnrollment = new Map<string, typeof scores>();
  for (const score of scores) {
    const bucket = scoresByEnrollment.get(score.enrollmentId) ?? [];
    bucket.push(score);
    scoresByEnrollment.set(score.enrollmentId, bucket);
  }

  const attendanceByEnrollment = new Map<string, typeof attendanceRecords>();
  for (const record of attendanceRecords) {
    const bucket = attendanceByEnrollment.get(record.enrollmentId) ?? [];
    bucket.push(record);
    attendanceByEnrollment.set(record.enrollmentId, bucket);
  }

  const earnedPtsByEnrollment = new Map<string, number>();
  for (const row of earnedPointSums) {
    earnedPtsByEnrollment.set(row.enrollmentId, row._sum.availableDelta ?? 0);
  }

  const usingDefaultScale = scaleRules.length === 0;
  const effectiveScale: GradeScaleRuleInput[] = usingDefaultScale
    ? DEFAULT_PH_GRADE_SCALE
    : scaleRules.map((rule) => ({
        minPct: Number(rule.minPct),
        maxPct: Number(rule.maxPct),
        gradeEquivalent: rule.gradeEquivalent,
        label: rule.label,
        isPassing: rule.isPassing,
        sortOrder: rule.sortOrder,
      }));

  const termSplitConfig = parseTermSplitConfig(subject.termSplitConfig);
  const lateAttendanceCreditPct = Number(subject.lateAttendanceCreditPct);

  const categoryInputs = categories.map((c) => ({
    id: c.id,
    termKey: c.termKey,
    name: c.name,
    categoryType: c.categoryType,
    weightPct: Number(c.weightPct),
    aggregationMethod: c.aggregationMethod,
    targetPointsCap: c.targetPointsCap,
    sortOrder: c.sortOrder,
  }));

  const termLabelByKey = new Map<string, string>([["DEFAULT", "Overall"]]);
  if (termSplitConfig?.enabled) {
    for (const t of termSplitConfig.terms) {
      termLabelByKey.set(t.key, t.label);
    }
  }

  const categoryMetas: GradeSheetCategoryMeta[] = categoryInputs.map((c) => ({
    id: c.id,
    termKey: c.termKey,
    termLabel: termLabelByKey.get(c.termKey) ?? c.termKey,
    name: c.name,
    categoryType: c.categoryType,
    weightPct: c.weightPct,
    aggregationMethod: c.aggregationMethod,
    targetPointsCap: c.targetPointsCap,
  }));

  const categoryById = new Map(categoryInputs.map((c) => [c.id, c]));

  const assessmentInputs = assessments.map((a) => ({
    id: a.id,
    categoryId: a.categoryId,
    title: a.title,
    maxScore: Number(a.maxScore),
  }));

  const assessmentMetas: GradeSheetAssessmentMeta[] = assessments.map((a) => {
    const cat = categoryById.get(a.categoryId);
    return {
      id: a.id,
      categoryId: a.categoryId,
      categoryName: cat?.name ?? "Uncategorized",
      termKey: cat?.termKey ?? "DEFAULT",
      title: a.title,
      maxScore: Number(a.maxScore),
      assessmentDate: a.assessmentDate,
    };
  });

  const students: GradeSheetStudentRow[] = enrollments.map((enrollment) => {
    const studentScores = scoresByEnrollment.get(enrollment.id) ?? [];
    const studentAttendance = attendanceByEnrollment.get(enrollment.id) ?? [];
    const earnedPts = earnedPtsByEnrollment.get(enrollment.id) ?? 0;

    const remarksByAssessmentId: Record<string, string | null> = {};
    for (const s of studentScores) {
      remarksByAssessmentId[s.assessmentId] = s.remarks ?? null;
    }

    const standing = computeStanding({
      categories: categoryInputs,
      assessments: assessmentInputs,
      scores: studentScores.map((s) => ({
        assessmentId: s.assessmentId,
        status: s.status,
        rawScore: s.rawScore !== null ? Number(s.rawScore) : null,
        bonusPoints: Number(s.bonusPoints),
        allowExtraCredit: s.allowExtraCredit,
        remarks: s.remarks,
      })),
      attendanceRecords: studentAttendance.map((r) => ({
        status: r.status,
      })),
      lateAttendanceCreditPct,
      earnedMeritAndAttendancePts: earnedPts,
      hasSubjectPointActivity:
        subject.pointsEnabled !== false && activityCount > 0,
      termSplitConfig,
      gradeScaleRules: effectiveScale,
      manualStandingOverride: enrollment.manualStandingOverride,
    });

    return {
      enrollmentId: enrollment.id,
      enrolledAt: enrollment.enrolledAt,
      student: enrollment.student,
      attendanceSummary: summarizeAttendance(
        studentAttendance,
        lateAttendanceCreditPct
      ),
      remarksByAssessmentId,
      standing,
    };
  });

  return {
    subject: {
      id: subject.id,
      code: subject.code,
      title: subject.title,
      section: subject.section,
      termName: subject.term.name,
      teacherName: subject.teacher.fullName,
      teacherEmail: subject.teacher.email,
      startDate: subject.startDate,
      endDate: subject.endDate,
      standingVisible: subject.standingVisible,
      lateAttendanceCreditPct,
      termSplitConfig,
      usingDefaultScale,
      gradeScaleRules: effectiveScale,
    },
    categories: categoryMetas,
    assessments: assessmentMetas,
    students,
    exportedAt: new Date(),
  };
}
