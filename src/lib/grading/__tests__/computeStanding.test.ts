import { describe, expect, it } from "vitest";
import { computeStanding, resolveGradeScale } from "@/lib/grading/computeStanding";
import { DEFAULT_PH_GRADE_SCALE } from "@/lib/grading/default-scale";

const baseCategories = [
  {
    id: "cat-quiz",
    termKey: "DEFAULT",
    name: "Quizzes",
    categoryType: "ASSESSMENT" as const,
    weightPct: 40,
    aggregationMethod: "TOTAL_POINTS" as const,
    targetPointsCap: null,
  },
  {
    id: "cat-exam",
    termKey: "DEFAULT",
    name: "Exams",
    categoryType: "ASSESSMENT" as const,
    weightPct: 50,
    aggregationMethod: "TOTAL_POINTS" as const,
    targetPointsCap: null,
  },
  {
    id: "cat-att",
    termKey: "DEFAULT",
    name: "Attendance",
    categoryType: "ATTENDANCE" as const,
    weightPct: 10,
    aggregationMethod: "TOTAL_POINTS" as const,
    targetPointsCap: null,
  },
];

describe("computeStanding deterministic engine", () => {
  it("returns No Graded Items Yet when all assessments are PENDING and no attendance exists", () => {
    const result = computeStanding({
      categories: baseCategories,
      assessments: [
        { id: "q1", categoryId: "cat-quiz", title: "Quiz 1", maxScore: 20 },
      ],
      scores: [],
      attendanceRecords: [],
      lateAttendanceCreditPct: 50,
      earnedMeritAndAttendancePts: 0,
      hasSubjectPointActivity: false,
      termSplitConfig: null,
      gradeScaleRules: DEFAULT_PH_GRADE_SCALE,
      manualStandingOverride: "NONE",
    });

    expect(result.hasGradedItems).toBe(false);
    expect(result.overallPct).toBeNull();
    expect(result.effectiveGradeEquivalent).toBeNull();
    expect(result.effectiveStatusLabel).toBe("No Graded Items Yet");
  });

  it("excludes PENDING and EXCUSED while counting MISSING as 0 and re-normalizing active weights", () => {
    const result = computeStanding({
      categories: baseCategories,
      assessments: [
        { id: "q1", categoryId: "cat-quiz", title: "Quiz 1", maxScore: 20 },
        { id: "q2", categoryId: "cat-quiz", title: "Quiz 2", maxScore: 20 },
        { id: "q3", categoryId: "cat-quiz", title: "Quiz 3", maxScore: 20 },
        { id: "q4", categoryId: "cat-quiz", title: "Quiz 4", maxScore: 20 },
        { id: "e1", categoryId: "cat-exam", title: "Midterm", maxScore: 100 },
      ],
      scores: [
        // q1: 18/20
        {
          assessmentId: "q1",
          status: "GRADED",
          rawScore: 18,
          bonusPoints: 0,
          allowExtraCredit: false,
        },
        // q2: MISSING => 0/20
        {
          assessmentId: "q2",
          status: "MISSING",
          rawScore: null,
          bonusPoints: 0,
          allowExtraCredit: false,
        },
        // q3: EXCUSED => excluded
        {
          assessmentId: "q3",
          status: "EXCUSED",
          rawScore: null,
          bonusPoints: 0,
          allowExtraCredit: false,
        },
        // q4: PENDING => excluded
        // e1: PENDING => entire Exams category is inactive
      ],
      // Attendance: 1 PRESENT (100), 1 LATE (50), 1 EXCUSED (excluded) => 75%
      attendanceRecords: [
        { status: "PRESENT" },
        { status: "LATE" },
        { status: "EXCUSED" },
      ],
      lateAttendanceCreditPct: 50,
      earnedMeritAndAttendancePts: 0,
      hasSubjectPointActivity: false,
      termSplitConfig: null,
      gradeScaleRules: DEFAULT_PH_GRADE_SCALE,
      manualStandingOverride: "NONE",
    });

    // Quizzes: (18 + 0) / (20 + 20) = 45.00% (weight 40)
    // Attendance: (100 + 50) / 2 = 75.00% (weight 10)
    // Active weights sum = 50 -> 45*(40/50) + 75*(10/50) = 36 + 15 = 51.00%
    expect(result.hasGradedItems).toBe(true);
    expect(result.overallPct).toBe(51);
    expect(result.effectiveGradeEquivalent).toBe("5.00");
    const quizCat = result.categories.find((c) => c.categoryId === "cat-quiz");
    expect(quizCat?.normalizedWeightPct).toBe(80);
    expect(quizCat?.categoryPct).toBe(45);
    const examCat = result.categories.find((c) => c.categoryId === "cat-exam");
    expect(examCat?.isActive).toBe(false);
  });

  it("respects maxScore cap vs allowExtraCredit and EQUAL_AVERAGE vs TOTAL_POINTS", () => {
    const categories = [
      {
        id: "cat-eq",
        termKey: "DEFAULT",
        name: "Equal Avg Quizzes",
        categoryType: "ASSESSMENT" as const,
        weightPct: 100,
        aggregationMethod: "EQUAL_AVERAGE" as const,
        targetPointsCap: null,
      },
    ];

    const capped = computeStanding({
      categories,
      assessments: [
        { id: "a1", categoryId: "cat-eq", title: "A1", maxScore: 10 },
        { id: "a2", categoryId: "cat-eq", title: "A2", maxScore: 100 },
      ],
      scores: [
        // 9 + 4 bonus, capped at 10 => 100%
        {
          assessmentId: "a1",
          status: "GRADED",
          rawScore: 9,
          bonusPoints: 4,
          allowExtraCredit: false,
        },
        // 80/100 => 80%
        {
          assessmentId: "a2",
          status: "GRADED",
          rawScore: 80,
          bonusPoints: 0,
          allowExtraCredit: false,
        },
      ],
      attendanceRecords: [],
      lateAttendanceCreditPct: 50,
      earnedMeritAndAttendancePts: 0,
      hasSubjectPointActivity: false,
      termSplitConfig: null,
      gradeScaleRules: DEFAULT_PH_GRADE_SCALE,
      manualStandingOverride: "NONE",
    });

    // Equal average of 100% and 80% = 90.00% -> 1.75
    expect(capped.overallPct).toBe(90);
    expect(capped.effectiveGradeEquivalent).toBe("1.75");

    const extraCredit = computeStanding({
      categories,
      assessments: [
        { id: "a1", categoryId: "cat-eq", title: "A1", maxScore: 10 },
        { id: "a2", categoryId: "cat-eq", title: "A2", maxScore: 100 },
      ],
      scores: [
        // 9 + 4 bonus with extra credit => 13/10 => 130%
        {
          assessmentId: "a1",
          status: "GRADED",
          rawScore: 9,
          bonusPoints: 4,
          allowExtraCredit: true,
        },
        {
          assessmentId: "a2",
          status: "GRADED",
          rawScore: 80,
          bonusPoints: 0,
          allowExtraCredit: false,
        },
      ],
      attendanceRecords: [],
      lateAttendanceCreditPct: 50,
      earnedMeritAndAttendancePts: 0,
      hasSubjectPointActivity: false,
      termSplitConfig: null,
      gradeScaleRules: DEFAULT_PH_GRADE_SCALE,
      manualStandingOverride: "NONE",
    });

    // Equal average of 130% and 80% = 105.00% -> clamped to top bracket 1.00
    expect(extraCredit.overallPct).toBe(105);
    expect(extraCredit.effectiveGradeEquivalent).toBe("1.00");
  });

  it("handles exact boundary mappings (96.99% vs 97.00% and 74.99% vs 75.00%)", () => {
    const singleCat = [
      {
        id: "cat-all",
        termKey: "DEFAULT",
        name: "All",
        categoryType: "ASSESSMENT" as const,
        weightPct: 100,
        aggregationMethod: "TOTAL_POINTS" as const,
        targetPointsCap: null,
      },
    ];

    const runAtPct = (rawScore: number) =>
      computeStanding({
        categories: singleCat,
        assessments: [
          { id: "x", categoryId: "cat-all", title: "Exam", maxScore: 100 },
        ],
        scores: [
          {
            assessmentId: "x",
            status: "GRADED",
            rawScore,
            bonusPoints: 0,
            allowExtraCredit: false,
          },
        ],
        attendanceRecords: [],
        lateAttendanceCreditPct: 50,
        earnedMeritAndAttendancePts: 0,
        hasSubjectPointActivity: false,
        termSplitConfig: null,
        gradeScaleRules: DEFAULT_PH_GRADE_SCALE,
        manualStandingOverride: "NONE",
      });

    expect(runAtPct(96.99).effectiveGradeEquivalent).toBe("1.25");
    expect(runAtPct(97.0).effectiveGradeEquivalent).toBe("1.00");
    expect(runAtPct(74.99).effectiveGradeEquivalent).toBe("5.00");
    expect(runAtPct(74.99).isPassing).toBe(false);
    expect(runAtPct(75.0).effectiveGradeEquivalent).toBe("3.00");
    expect(runAtPct(75.0).isPassing).toBe(true);
  });

  it("supports multi-term split rollups, POINTS_PARTICIPATION cap, and INC/DRP overrides", () => {
    const multiTermCategories = [
      {
        id: "m-exam",
        termKey: "MIDTERM",
        name: "Midterm Exam",
        categoryType: "ASSESSMENT" as const,
        weightPct: 80,
        aggregationMethod: "TOTAL_POINTS" as const,
        targetPointsCap: null,
      },
      {
        id: "m-part",
        termKey: "MIDTERM",
        name: "Participation",
        categoryType: "POINTS_PARTICIPATION" as const,
        weightPct: 20,
        aggregationMethod: "TOTAL_POINTS" as const,
        targetPointsCap: 50,
      },
      {
        id: "f-exam",
        termKey: "FINALS",
        name: "Final Exam",
        categoryType: "ASSESSMENT" as const,
        weightPct: 100,
        aggregationMethod: "TOTAL_POINTS" as const,
        targetPointsCap: null,
      },
    ];

    const result = computeStanding({
      categories: multiTermCategories,
      assessments: [
        { id: "mid", categoryId: "m-exam", title: "Mid", maxScore: 100 },
        { id: "fin", categoryId: "f-exam", title: "Fin", maxScore: 100 },
      ],
      scores: [
        {
          assessmentId: "mid",
          status: "GRADED",
          rawScore: 80,
          bonusPoints: 0,
          allowExtraCredit: false,
        },
        {
          assessmentId: "fin",
          status: "GRADED",
          rawScore: 95,
          bonusPoints: 0,
          allowExtraCredit: false,
        },
      ],
      attendanceRecords: [],
      lateAttendanceCreditPct: 50,
      // 75 earned pts against cap 50 => capped at 100%
      earnedMeritAndAttendancePts: 75,
      hasSubjectPointActivity: true,
      termSplitConfig: {
        enabled: true,
        terms: [
          { key: "MIDTERM", label: "Midterm", weightPct: 40 },
          { key: "FINALS", label: "Finals", weightPct: 60 },
        ],
      },
      gradeScaleRules: DEFAULT_PH_GRADE_SCALE,
      manualStandingOverride: "INC",
    });

    // Midterm = 80*0.8 + 100*0.2 = 84%
    // Finals = 95%
    // Overall = 84*0.4 + 95*0.6 = 33.6 + 57 = 90.6%
    expect(result.overallPct).toBe(90.6);
    expect(result.rawGradeEquivalent).toBe("1.75");
    expect(result.effectiveGradeEquivalent).toBe("INC");
    expect(result.effectiveStatusLabel).toBe("Incomplete");
    expect(result.isOverridden).toBe(true);
    expect(result.isPassing).toBe(false);
  });

  it("maps percentages falling inside an allowed bracket gap to the highest lower bracket", () => {
    const gappedScale = [
      { minPct: 97, maxPct: 100, gradeEquivalent: "1.00", label: "Excellent", isPassing: true },
      { minPct: 94, maxPct: 96, gradeEquivalent: "1.25", label: "Superior", isPassing: true },
      { minPct: 75, maxPct: 93, gradeEquivalent: "3.00", label: "Passed", isPassing: true },
      { minPct: 0, maxPct: 74, gradeEquivalent: "5.00", label: "Failed", isPassing: false },
    ];

    expect(resolveGradeScale(96.5, gappedScale)?.gradeEquivalent).toBe("1.25");
    expect(resolveGradeScale(93.99, gappedScale)?.gradeEquivalent).toBe("3.00");
    expect(resolveGradeScale(74.5, gappedScale)?.gradeEquivalent).toBe("5.00");
    expect(resolveGradeScale(97, gappedScale)?.gradeEquivalent).toBe("1.00");
  });
});
