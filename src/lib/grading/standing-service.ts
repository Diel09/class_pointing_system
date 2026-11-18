import { db } from "@/lib/db";
import {
  computeStanding,
  type ComputeStandingResult,
  type TermSplitConfig,
} from "@/lib/grading/computeStanding";
import {
  DEFAULT_PH_GRADE_SCALE,
  type GradeScaleRuleInput,
} from "@/lib/grading/default-scale";

export interface StudentStandingSummary {
  enrollmentId: string;
  student: {
    id: string;
    fullName: string;
    email: string;
    institutionalId: string | null;
  };
  standing: ComputeStandingResult;
}

export function parseTermSplitConfig(raw: unknown): TermSplitConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as { enabled?: unknown; terms?: unknown };
  if (typeof candidate.enabled !== "boolean" || !Array.isArray(candidate.terms)) {
    return null;
  }
  const terms = candidate.terms
    .filter(
      (item): item is { key: string; label: string; weightPct: number } =>
        Boolean(item) &&
        typeof item === "object" &&
        typeof (item as { key?: unknown }).key === "string" &&
        typeof (item as { label?: unknown }).label === "string" &&
        typeof (item as { weightPct?: unknown }).weightPct === "number"
    )
    .map((t) => ({
      key: t.key,
      label: t.label,
      weightPct: t.weightPct,
    }));
  return { enabled: candidate.enabled, terms };
}

/**
 * Loads subject grading configuration and computes standing for one enrollment or the entire class.
 */
export async function computeSubjectStandings(options: {
  subjectId: string;
  enrollmentId?: string;
}): Promise<{
  usingDefaultScale: boolean;
  gradeScaleRules: GradeScaleRuleInput[];
  standings: StudentStandingSummary[];
}> {
  const { subjectId, enrollmentId } = options;

  const [subject, categories, assessments, scaleRules, enrollments, activityCount] =
    await Promise.all([
      db.subject.findUnique({
        where: { id: subjectId },
        select: {
          id: true,
          lateAttendanceCreditPct: true,
          termSplitConfig: true,
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
    return {
      usingDefaultScale: true,
      gradeScaleRules: DEFAULT_PH_GRADE_SCALE,
      standings: [],
    };
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

  const assessmentInputs = assessments.map((a) => ({
    id: a.id,
    categoryId: a.categoryId,
    title: a.title,
    maxScore: Number(a.maxScore),
  }));

  const standings: StudentStandingSummary[] = enrollments.map((enrollment) => {
    const studentScores = scoresByEnrollment.get(enrollment.id) ?? [];
    const studentAttendance = attendanceByEnrollment.get(enrollment.id) ?? [];
    const earnedPts = earnedPtsByEnrollment.get(enrollment.id) ?? 0;

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
      hasSubjectPointActivity: activityCount > 0,
      termSplitConfig,
      gradeScaleRules: effectiveScale,
      manualStandingOverride: enrollment.manualStandingOverride,
    });

    return {
      enrollmentId: enrollment.id,
      student: enrollment.student,
      standing,
    };
  });

  return {
    usingDefaultScale,
    gradeScaleRules: effectiveScale,
    standings,
  };
}
