export interface GradeScaleRuleInput {
  minPct: number;
  maxPct: number;
  gradeEquivalent: string;
  label: string;
  isPassing: boolean;
  sortOrder?: number;
}

export interface GradeCategoryTemplate {
  termKey: string;
  name: string;
  categoryType: "ASSESSMENT" | "ATTENDANCE" | "POINTS_PARTICIPATION";
  weightPct: number;
  aggregationMethod: "TOTAL_POINTS" | "EQUAL_AVERAGE";
  targetPointsCap: number | null;
  sortOrder: number;
}

/**
 * Standard Philippine collegiate 1.00–5.00 grading scale (gap-free, 2-decimal precision).
 */
export const DEFAULT_PH_GRADE_SCALE: GradeScaleRuleInput[] = [
  {
    minPct: 97.0,
    maxPct: 100.0,
    gradeEquivalent: "1.00",
    label: "Excellent",
    isPassing: true,
    sortOrder: 0,
  },
  {
    minPct: 94.0,
    maxPct: 96.99,
    gradeEquivalent: "1.25",
    label: "Superior",
    isPassing: true,
    sortOrder: 1,
  },
  {
    minPct: 91.0,
    maxPct: 93.99,
    gradeEquivalent: "1.50",
    label: "Very Good",
    isPassing: true,
    sortOrder: 2,
  },
  {
    minPct: 88.0,
    maxPct: 90.99,
    gradeEquivalent: "1.75",
    label: "Good",
    isPassing: true,
    sortOrder: 3,
  },
  {
    minPct: 85.0,
    maxPct: 87.99,
    gradeEquivalent: "2.00",
    label: "Very Satisfactory",
    isPassing: true,
    sortOrder: 4,
  },
  {
    minPct: 82.0,
    maxPct: 84.99,
    gradeEquivalent: "2.25",
    label: "Satisfactory",
    isPassing: true,
    sortOrder: 5,
  },
  {
    minPct: 79.0,
    maxPct: 81.99,
    gradeEquivalent: "2.50",
    label: "Fairly Satisfactory",
    isPassing: true,
    sortOrder: 6,
  },
  {
    minPct: 76.0,
    maxPct: 78.99,
    gradeEquivalent: "2.75",
    label: "Fair",
    isPassing: true,
    sortOrder: 7,
  },
  {
    minPct: 75.0,
    maxPct: 75.99,
    gradeEquivalent: "3.00",
    label: "Passed",
    isPassing: true,
    sortOrder: 8,
  },
  {
    minPct: 0.0,
    maxPct: 74.99,
    gradeEquivalent: "5.00",
    label: "Failed",
    isPassing: false,
    sortOrder: 9,
  },
];

/**
 * Default single-term category weights summing to 100%.
 */
export const DEFAULT_SINGLE_TERM_CATEGORIES: GradeCategoryTemplate[] = [
  {
    termKey: "DEFAULT",
    name: "Activities & Labs",
    categoryType: "ASSESSMENT",
    weightPct: 20,
    aggregationMethod: "TOTAL_POINTS",
    targetPointsCap: null,
    sortOrder: 0,
  },
  {
    termKey: "DEFAULT",
    name: "Quizzes",
    categoryType: "ASSESSMENT",
    weightPct: 20,
    aggregationMethod: "TOTAL_POINTS",
    targetPointsCap: null,
    sortOrder: 1,
  },
  {
    termKey: "DEFAULT",
    name: "Major Exams",
    categoryType: "ASSESSMENT",
    weightPct: 50,
    aggregationMethod: "TOTAL_POINTS",
    targetPointsCap: null,
    sortOrder: 2,
  },
  {
    termKey: "DEFAULT",
    name: "Attendance",
    categoryType: "ATTENDANCE",
    weightPct: 10,
    aggregationMethod: "TOTAL_POINTS",
    targetPointsCap: null,
    sortOrder: 3,
  },
];
