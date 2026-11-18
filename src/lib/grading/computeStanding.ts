import type { GradeScaleRuleInput } from "./default-scale";

export type GradeCategoryTypeValue =
  | "ASSESSMENT"
  | "ATTENDANCE"
  | "POINTS_PARTICIPATION";

export type AggregationMethodValue = "TOTAL_POINTS" | "EQUAL_AVERAGE";

export type AssessmentScoreStatusValue =
  | "PENDING"
  | "GRADED"
  | "MISSING"
  | "EXCUSED";

export type AttendanceStatusValue = "PRESENT" | "LATE" | "ABSENT" | "EXCUSED";

export type StandingOverrideValue = "NONE" | "INC" | "DRP";

export interface TermSplitEntry {
  key: string;
  label: string;
  weightPct: number;
}

export interface TermSplitConfig {
  enabled: boolean;
  terms: TermSplitEntry[];
}

export interface GradeCategoryInput {
  id: string;
  termKey: string;
  name: string;
  categoryType: GradeCategoryTypeValue;
  weightPct: number;
  aggregationMethod: AggregationMethodValue;
  targetPointsCap: number | null;
  sortOrder?: number;
}

export interface AssessmentInput {
  id: string;
  categoryId: string;
  title: string;
  maxScore: number;
}

export interface AssessmentScoreInput {
  assessmentId: string;
  status: AssessmentScoreStatusValue;
  rawScore: number | null;
  bonusPoints: number;
  allowExtraCredit: boolean;
  remarks?: string | null;
}

export interface AttendanceRecordInput {
  status: AttendanceStatusValue;
}

export interface ComputeStandingInput {
  categories: GradeCategoryInput[];
  assessments: AssessmentInput[];
  scores: AssessmentScoreInput[];
  attendanceRecords: AttendanceRecordInput[];
  lateAttendanceCreditPct: number;
  earnedMeritAndAttendancePts: number;
  hasSubjectPointActivity: boolean;
  termSplitConfig: TermSplitConfig | null;
  gradeScaleRules: GradeScaleRuleInput[];
  manualStandingOverride: StandingOverrideValue;
}

export interface AssessmentItemResult {
  assessmentId: string;
  title: string;
  maxScore: number;
  status: AssessmentScoreStatusValue;
  rawScore: number | null;
  bonusPoints: number;
  allowExtraCredit: boolean;
  effectiveScore: number | null;
  pct: number | null;
  includedInStanding: boolean;
}

export interface CategoryBreakdown {
  categoryId: string;
  termKey: string;
  name: string;
  categoryType: GradeCategoryTypeValue;
  aggregationMethod: AggregationMethodValue;
  configuredWeightPct: number;
  normalizedWeightPct: number;
  isActive: boolean;
  categoryPct: number | null;
  weightedContribution: number;
  earnedTotal: number;
  possibleTotal: number;
  activeItemCount: number;
  totalItemCount: number;
  items: AssessmentItemResult[];
}

export interface TermBreakdown {
  key: string;
  label: string;
  configuredWeightPct: number;
  normalizedWeightPct: number;
  isActive: boolean;
  termPct: number | null;
  activeWeightSum: number;
  categories: CategoryBreakdown[];
}

export interface ComputeStandingResult {
  hasGradedItems: boolean;
  overallPct: number | null;
  rawGradeEquivalent: string | null;
  rawStatusLabel: string;
  effectiveGradeEquivalent: string | null;
  effectiveStatusLabel: string;
  isPassing: boolean | null;
  isOverridden: boolean;
  manualStandingOverride: StandingOverrideValue;
  activeTermWeightSum: number;
  terms: TermBreakdown[];
  categories: CategoryBreakdown[];
}

/**
 * Rounds a floating-point number to 2 decimal places safely.
 */
export function round2(value: number): number {
  return Math.round((value + 1e-9) * 100) / 100;
}

/**
 * Resolves a rounded percentage against configured grade scale brackets.
 */
export function resolveGradeScale(
  pct: number,
  rules: GradeScaleRuleInput[]
): GradeScaleRuleInput | null {
  if (rules.length === 0) {
    return null;
  }

  const rounded = round2(pct);
  const sorted = [...rules].sort((a, b) => a.minPct - b.minPct);

  for (const rule of sorted) {
    if (rounded >= round2(rule.minPct) && rounded <= round2(rule.maxPct)) {
      return rule;
    }
  }

  // Fallback for percentages above highest.maxPct or inside an allowed gap:
  // pick the highest bracket whose minPct <= rounded.
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    if (rounded >= round2(sorted[i]!.minPct)) {
      return sorted[i]!;
    }
  }

  return sorted[0]!;
}

function computeAssessmentCategory(
  category: GradeCategoryInput,
  assessments: AssessmentInput[],
  scoreByAssessmentId: Map<string, AssessmentScoreInput>
): Omit<
  CategoryBreakdown,
  "normalizedWeightPct" | "weightedContribution"
> {
  const categoryAssessments = assessments.filter(
    (a) => a.categoryId === category.id
  );

  const items: AssessmentItemResult[] = [];
  let earnedTotal = 0;
  let possibleTotal = 0;
  let pctSum = 0;
  let activeItemCount = 0;

  for (const assessment of categoryAssessments) {
    const score = scoreByAssessmentId.get(assessment.id);
    const status: AssessmentScoreStatusValue = score?.status ?? "PENDING";
    const rawScore = score?.rawScore ?? null;
    const bonusPoints = score?.bonusPoints ?? 0;
    const allowExtraCredit = score?.allowExtraCredit ?? false;

    if (
      status === "PENDING" ||
      status === "EXCUSED" ||
      assessment.maxScore <= 0
    ) {
      items.push({
        assessmentId: assessment.id,
        title: assessment.title,
        maxScore: assessment.maxScore,
        status,
        rawScore,
        bonusPoints,
        allowExtraCredit,
        effectiveScore: null,
        pct: null,
        includedInStanding: false,
      });
      continue;
    }

    let effectiveScore = 0;
    if (status === "MISSING") {
      effectiveScore = 0;
    } else {
      const base = rawScore ?? 0;
      const combined = base + bonusPoints;
      effectiveScore = allowExtraCredit
        ? combined
        : Math.min(assessment.maxScore, combined);
    }

    const itemPct = (effectiveScore / assessment.maxScore) * 100;
    earnedTotal += effectiveScore;
    possibleTotal += assessment.maxScore;
    pctSum += itemPct;
    activeItemCount += 1;

    items.push({
      assessmentId: assessment.id,
      title: assessment.title,
      maxScore: assessment.maxScore,
      status,
      rawScore,
      bonusPoints,
      allowExtraCredit,
      effectiveScore: round2(effectiveScore),
      pct: round2(itemPct),
      includedInStanding: true,
    });
  }

  let categoryPct: number | null = null;
  if (activeItemCount > 0 && possibleTotal > 0) {
    if (category.aggregationMethod === "EQUAL_AVERAGE") {
      categoryPct = pctSum / activeItemCount;
    } else {
      categoryPct = (earnedTotal / possibleTotal) * 100;
    }
  }

  return {
    categoryId: category.id,
    termKey: category.termKey,
    name: category.name,
    categoryType: category.categoryType,
    aggregationMethod: category.aggregationMethod,
    configuredWeightPct: category.weightPct,
    isActive: categoryPct !== null,
    categoryPct: categoryPct !== null ? round2(categoryPct) : null,
    earnedTotal: round2(earnedTotal),
    possibleTotal: round2(possibleTotal),
    activeItemCount,
    totalItemCount: categoryAssessments.length,
    items,
  };
}

function computeAttendanceCategory(
  category: GradeCategoryInput,
  attendanceRecords: AttendanceRecordInput[],
  lateAttendanceCreditPct: number
): Omit<
  CategoryBreakdown,
  "normalizedWeightPct" | "weightedContribution"
> {
  const clampedLateCredit = Math.max(0, Math.min(100, lateAttendanceCreditPct));
  let earnedCredits = 0;
  let countableRecords = 0;

  for (const record of attendanceRecords) {
    if (record.status === "EXCUSED") {
      continue;
    }
    countableRecords += 1;
    if (record.status === "PRESENT") {
      earnedCredits += 100;
    } else if (record.status === "LATE") {
      earnedCredits += clampedLateCredit;
    }
  }

  const categoryPct =
    countableRecords > 0 ? earnedCredits / countableRecords : null;

  return {
    categoryId: category.id,
    termKey: category.termKey,
    name: category.name,
    categoryType: category.categoryType,
    aggregationMethod: category.aggregationMethod,
    configuredWeightPct: category.weightPct,
    isActive: categoryPct !== null,
    categoryPct: categoryPct !== null ? round2(categoryPct) : null,
    earnedTotal: round2(earnedCredits),
    possibleTotal: countableRecords * 100,
    activeItemCount: countableRecords,
    totalItemCount: attendanceRecords.length,
    items: [],
  };
}

function computeParticipationCategory(
  category: GradeCategoryInput,
  earnedMeritAndAttendancePts: number,
  hasSubjectPointActivity: boolean
): Omit<
  CategoryBreakdown,
  "normalizedWeightPct" | "weightedContribution"
> {
  const cap = category.targetPointsCap ?? 0;
  const safeEarned = Math.max(0, earnedMeritAndAttendancePts);

  if (!hasSubjectPointActivity || cap <= 0) {
    return {
      categoryId: category.id,
      termKey: category.termKey,
      name: category.name,
      categoryType: category.categoryType,
      aggregationMethod: category.aggregationMethod,
      configuredWeightPct: category.weightPct,
      isActive: false,
      categoryPct: null,
      earnedTotal: safeEarned,
      possibleTotal: cap,
      activeItemCount: 0,
      totalItemCount: 0,
      items: [],
    };
  }

  const categoryPct = Math.min(100, (safeEarned / cap) * 100);
  return {
    categoryId: category.id,
    termKey: category.termKey,
    name: category.name,
    categoryType: category.categoryType,
    aggregationMethod: category.aggregationMethod,
    configuredWeightPct: category.weightPct,
    isActive: true,
    categoryPct: round2(categoryPct),
    earnedTotal: safeEarned,
    possibleTotal: cap,
    activeItemCount: 1,
    totalItemCount: 1,
    items: [],
  };
}

function computeTermBreakdown(
  term: TermSplitEntry,
  categories: GradeCategoryInput[],
  assessments: AssessmentInput[],
  scoreByAssessmentId: Map<string, AssessmentScoreInput>,
  attendanceRecords: AttendanceRecordInput[],
  lateAttendanceCreditPct: number,
  earnedMeritAndAttendancePts: number,
  hasSubjectPointActivity: boolean
): Omit<TermBreakdown, "normalizedWeightPct"> {
  const termCategories = [...categories]
    .filter((c) => c.termKey === term.key)
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  const rawCategories = termCategories.map((category) => {
    if (category.categoryType === "ATTENDANCE") {
      return computeAttendanceCategory(
        category,
        attendanceRecords,
        lateAttendanceCreditPct
      );
    }
    if (category.categoryType === "POINTS_PARTICIPATION") {
      return computeParticipationCategory(
        category,
        earnedMeritAndAttendancePts,
        hasSubjectPointActivity
      );
    }
    return computeAssessmentCategory(category, assessments, scoreByAssessmentId);
  });

  const activeWeightSum = rawCategories
    .filter((c) => c.isActive && c.categoryPct !== null)
    .reduce((sum, c) => sum + c.configuredWeightPct, 0);

  let termPctSum = 0;
  const finalizedCategories: CategoryBreakdown[] = rawCategories.map((cat) => {
    if (!cat.isActive || cat.categoryPct === null || activeWeightSum <= 0) {
      return {
        ...cat,
        normalizedWeightPct: 0,
        weightedContribution: 0,
      };
    }
    const ratio = cat.configuredWeightPct / activeWeightSum;
    const weightedContribution = cat.categoryPct * ratio;
    termPctSum += weightedContribution;

    return {
      ...cat,
      normalizedWeightPct: round2(ratio * 100),
      weightedContribution: round2(weightedContribution),
    };
  });

  const isActive = activeWeightSum > 0;
  return {
    key: term.key,
    label: term.label,
    configuredWeightPct: term.weightPct,
    isActive,
    termPct: isActive ? round2(termPctSum) : null,
    activeWeightSum: round2(activeWeightSum),
    categories: finalizedCategories,
  };
}

/**
 * Pure deterministic standing calculator for a student enrollment within a subject.
 */
export function computeStanding(
  input: ComputeStandingInput
): ComputeStandingResult {
  const scoreByAssessmentId = new Map<string, AssessmentScoreInput>();
  for (const score of input.scores) {
    scoreByAssessmentId.set(score.assessmentId, score);
  }

  const termsToEvaluate: TermSplitEntry[] =
    input.termSplitConfig?.enabled && input.termSplitConfig.terms.length > 0
      ? input.termSplitConfig.terms
      : [{ key: "DEFAULT", label: "Overall", weightPct: 100 }];

  const rawTerms = termsToEvaluate.map((term) =>
    computeTermBreakdown(
      term,
      input.categories,
      input.assessments,
      scoreByAssessmentId,
      input.attendanceRecords,
      input.lateAttendanceCreditPct,
      input.earnedMeritAndAttendancePts,
      input.hasSubjectPointActivity
    )
  );

  const activeTermWeightSum = rawTerms
    .filter((t) => t.isActive && t.termPct !== null)
    .reduce((sum, t) => sum + t.configuredWeightPct, 0);

  let overallPctRaw = 0;
  const finalizedTerms: TermBreakdown[] = rawTerms.map((term) => {
    if (!term.isActive || term.termPct === null || activeTermWeightSum <= 0) {
      return {
        ...term,
        normalizedWeightPct: 0,
      };
    }
    const ratio = term.configuredWeightPct / activeTermWeightSum;
    overallPctRaw += term.termPct * ratio;
    return {
      ...term,
      normalizedWeightPct: round2(ratio * 100),
    };
  });

  const hasGradedItems = activeTermWeightSum > 0;
  const overallPct = hasGradedItems ? round2(overallPctRaw) : null;
  const matchedRule =
    overallPct !== null
      ? resolveGradeScale(overallPct, input.gradeScaleRules)
      : null;

  const rawGradeEquivalent = matchedRule ? matchedRule.gradeEquivalent : null;
  const rawStatusLabel = !hasGradedItems
    ? "No Graded Items Yet"
    : matchedRule
    ? matchedRule.label
    : "No Grade Scale";

  const isOverridden = input.manualStandingOverride !== "NONE";
  const effectiveGradeEquivalent = isOverridden
    ? input.manualStandingOverride
    : rawGradeEquivalent;
  const effectiveStatusLabel =
    input.manualStandingOverride === "INC"
      ? "Incomplete"
      : input.manualStandingOverride === "DRP"
      ? "Dropped"
      : rawStatusLabel;
  const isPassing = isOverridden
    ? false
    : matchedRule
    ? matchedRule.isPassing
    : null;

  return {
    hasGradedItems,
    overallPct,
    rawGradeEquivalent,
    rawStatusLabel,
    effectiveGradeEquivalent,
    effectiveStatusLabel,
    isPassing,
    isOverridden,
    manualStandingOverride: input.manualStandingOverride,
    activeTermWeightSum: round2(activeTermWeightSum),
    terms: finalizedTerms,
    categories: finalizedTerms.flatMap((t) => t.categories),
  };
}
