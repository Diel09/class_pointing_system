import { describe, expect, it } from "vitest";
import { DEFAULT_PH_GRADE_SCALE } from "@/lib/grading/default-scale";
import {
  findGradeScaleGaps,
  parseCsvScores,
  updateComputationSchema,
  updateGradeScaleSchema,
  validateGradeScaleRules,
} from "@/lib/validations/grading";

describe("Phase 5 grading validations", () => {
  it("rejects category weights that do not sum to 100% and multi-term mismatches", () => {
    const badSum = updateComputationSchema.safeParse({
      lateAttendanceCreditPct: 50,
      termSplitConfig: null,
      categories: [
        {
          termKey: "DEFAULT",
          name: "Quizzes",
          categoryType: "ASSESSMENT",
          weightPct: 40,
          aggregationMethod: "TOTAL_POINTS",
        },
        {
          termKey: "DEFAULT",
          name: "Exams",
          categoryType: "ASSESSMENT",
          weightPct: 50,
          aggregationMethod: "TOTAL_POINTS",
        },
      ],
    });
    expect(badSum.success).toBe(false);

    const goodMulti = updateComputationSchema.safeParse({
      lateAttendanceCreditPct: 50,
      termSplitConfig: {
        enabled: true,
        terms: [
          { key: "MIDTERM", label: "Midterm", weightPct: 40 },
          { key: "FINALS", label: "Finals", weightPct: 60 },
        ],
      },
      categories: [
        {
          termKey: "MIDTERM",
          name: "Midterm Exam",
          categoryType: "ASSESSMENT",
          weightPct: 100,
          aggregationMethod: "TOTAL_POINTS",
        },
        {
          termKey: "FINALS",
          name: "Final Exam",
          categoryType: "ASSESSMENT",
          weightPct: 100,
          aggregationMethod: "TOTAL_POINTS",
        },
      ],
    });
    expect(goodMulti.success).toBe(true);
  });

  it("validates gap-free and overlap-free grade scales", () => {
    expect(validateGradeScaleRules(DEFAULT_PH_GRADE_SCALE)).toBeNull();

    const withGap = [
      { minPct: 0, maxPct: 74.99, gradeEquivalent: "5.00", label: "Failed", isPassing: false },
      { minPct: 76, maxPct: 100, gradeEquivalent: "3.00", label: "Passed", isPassing: true },
    ];
    expect(validateGradeScaleRules(withGap)).toContain("gap");

    const withOverlap = [
      { minPct: 0, maxPct: 75.5, gradeEquivalent: "5.00", label: "Failed", isPassing: false },
      { minPct: 75, maxPct: 100, gradeEquivalent: "3.00", label: "Passed", isPassing: true },
    ];
    expect(validateGradeScaleRules(withOverlap)).toContain("overlap");
  });

  it("allows unequal gaps between brackets when requireGapFree is false while still rejecting overlaps", () => {
    const unequalGaps = [
      { minPct: 0, maxPct: 74, gradeEquivalent: "5.00", label: "Failed", isPassing: false },
      { minPct: 75, maxPct: 84.5, gradeEquivalent: "3.00", label: "Passed", isPassing: true },
      { minPct: 85, maxPct: 96, gradeEquivalent: "1.50", label: "Very Good", isPassing: true },
      { minPct: 97, maxPct: 100, gradeEquivalent: "1.00", label: "Excellent", isPassing: true },
    ];

    expect(validateGradeScaleRules(unequalGaps, { requireGapFree: true })).toContain("gap");
    expect(validateGradeScaleRules(unequalGaps, { requireGapFree: false })).toBeNull();
    expect(findGradeScaleGaps(unequalGaps)).toEqual([
      { fromPct: 74, toPct: 75, prevGrade: "5.00", nextGrade: "3.00" },
      { fromPct: 84.5, toPct: 85, prevGrade: "3.00", nextGrade: "1.50" },
      { fromPct: 96, toPct: 97, prevGrade: "1.50", nextGrade: "1.00" },
    ]);

    expect(
      updateGradeScaleSchema.safeParse({
        requireGapFree: false,
        rules: unequalGaps,
      }).success
    ).toBe(true);

    const overlapWithGapsAllowed = [
      { minPct: 0, maxPct: 75, gradeEquivalent: "5.00", label: "Failed", isPassing: false },
      { minPct: 75, maxPct: 100, gradeEquivalent: "3.00", label: "Passed", isPassing: true },
    ];
    expect(
      validateGradeScaleRules(overlapWithGapsAllowed, { requireGapFree: false })
    ).toContain("overlap");
    expect(
      updateGradeScaleSchema.safeParse({
        requireGapFree: false,
        rules: overlapWithGapsAllowed,
      }).success
    ).toBe(false);
  });

  it("parses CSV score rows including numeric scores and MISSING/EXCUSED statuses", () => {
    const parsed = parseCsvScores(
      [
        "email, score, remarks",
        "student1@classpulse.local, 45, Great job",
        "2026-0002, MISSING, Absent on quiz day",
        "2026-0003, excused",
      ].join("\n")
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.rows).toEqual([
      {
        identifier: "student1@classpulse.local",
        status: "GRADED",
        rawScore: 45,
        remarks: "Great job",
        lineNumber: 2,
      },
      {
        identifier: "2026-0002",
        status: "MISSING",
        rawScore: null,
        remarks: "Absent on quiz day",
        lineNumber: 3,
      },
      {
        identifier: "2026-0003",
        status: "EXCUSED",
        rawScore: null,
        remarks: null,
        lineNumber: 4,
      },
    ]);
  });
});
