import { describe, expect, it } from "vitest";
import { computeStanding } from "@/lib/grading/computeStanding";
import { DEFAULT_PH_GRADE_SCALE } from "@/lib/grading/default-scale";
import {
  buildGradeSheetFilename,
  escapeCsvCell,
  formatClassGradeSheetCsv,
  formatStudentGradeSheetCsv,
} from "@/lib/grading/grade-sheet-csv";
import type { SubjectGradeSheetData } from "@/lib/grading/grade-sheet-service";

function buildFixtureData(options?: {
  emptyStudents?: boolean;
  multiTerm?: boolean;
}): SubjectGradeSheetData {
  const multiTerm = options?.multiTerm ?? false;
  const categories = multiTerm
    ? [
        {
          id: "cat-mid-quiz",
          termKey: "MIDTERM",
          termLabel: "Midterm",
          name: "Quizzes",
          categoryType: "ASSESSMENT" as const,
          weightPct: 80,
          aggregationMethod: "TOTAL_POINTS" as const,
          targetPointsCap: null,
        },
        {
          id: "cat-mid-att",
          termKey: "MIDTERM",
          termLabel: "Midterm",
          name: "Attendance",
          categoryType: "ATTENDANCE" as const,
          weightPct: 20,
          aggregationMethod: "TOTAL_POINTS" as const,
          targetPointsCap: null,
        },
        {
          id: "cat-fin-exam",
          termKey: "FINALS",
          termLabel: "Finals",
          name: "Final Exam",
          categoryType: "ASSESSMENT" as const,
          weightPct: 100,
          aggregationMethod: "TOTAL_POINTS" as const,
          targetPointsCap: null,
        },
      ]
    : [
        {
          id: "cat-quiz",
          termKey: "DEFAULT",
          termLabel: "Overall",
          name: "Quizzes",
          categoryType: "ASSESSMENT" as const,
          weightPct: 80,
          aggregationMethod: "TOTAL_POINTS" as const,
          targetPointsCap: null,
        },
        {
          id: "cat-att",
          termKey: "DEFAULT",
          termLabel: "Overall",
          name: "Attendance",
          categoryType: "ATTENDANCE" as const,
          weightPct: 20,
          aggregationMethod: "TOTAL_POINTS" as const,
          targetPointsCap: null,
        },
      ];

  const assessments = [
    {
      id: "assess-1",
      categoryId: multiTerm ? "cat-mid-quiz" : "cat-quiz",
      categoryName: "Quizzes",
      termKey: multiTerm ? "MIDTERM" : "DEFAULT",
      title: "Quiz 1, Intro",
      maxScore: 50,
      assessmentDate: new Date("2026-09-10T00:00:00.000Z"),
    },
    ...(multiTerm
      ? [
          {
            id: "assess-2",
            categoryId: "cat-fin-exam",
            categoryName: "Final Exam",
            termKey: "FINALS",
            title: "Finals Exam",
            maxScore: 100,
            assessmentDate: new Date("2026-12-05T00:00:00.000Z"),
          },
        ]
      : []),
  ];

  const termSplitConfig = multiTerm
    ? {
        enabled: true,
        terms: [
          { key: "MIDTERM", label: "Midterm", weightPct: 40 },
          { key: "FINALS", label: "Finals", weightPct: 60 },
        ],
      }
    : null;

  const standing1 = computeStanding({
    categories,
    assessments,
    scores: [
      {
        assessmentId: "assess-1",
        status: "GRADED",
        rawScore: 45,
        bonusPoints: 3,
        allowExtraCredit: false,
        remarks: "=cmd|' /C calc'!A0 Great boost",
      },
      ...(multiTerm
        ? [
            {
              assessmentId: "assess-2",
              status: "GRADED" as const,
              rawScore: 90,
              bonusPoints: 0,
              allowExtraCredit: false,
              remarks: "Solid work",
            },
          ]
        : []),
    ],
    attendanceRecords: [{ status: "PRESENT" }, { status: "LATE" }],
    lateAttendanceCreditPct: 50,
    earnedMeritAndAttendancePts: 35,
    hasSubjectPointActivity: true,
    termSplitConfig,
    gradeScaleRules: DEFAULT_PH_GRADE_SCALE,
    manualStandingOverride: "NONE",
  });

  const standing2 = computeStanding({
    categories,
    assessments,
    scores: [
      {
        assessmentId: "assess-1",
        status: "MISSING",
        rawScore: null,
        bonusPoints: 0,
        allowExtraCredit: false,
        remarks: "Absent during quiz",
      },
    ],
    attendanceRecords: [],
    lateAttendanceCreditPct: 50,
    earnedMeritAndAttendancePts: 0,
    hasSubjectPointActivity: false,
    termSplitConfig,
    gradeScaleRules: DEFAULT_PH_GRADE_SCALE,
    manualStandingOverride: "INC",
  });

  return {
    subject: {
      id: "11111111-1111-4111-8111-111111111111",
      code: "CS 101",
      title: "Intro to Computing",
      section: "1A",
      termName: "AY 2026-2027 1st Sem",
      teacherName: "Prof. Santos",
      teacherEmail: "santos@puento.local",
      startDate: new Date("2026-08-18T00:00:00.000Z"),
      endDate: new Date("2026-12-18T00:00:00.000Z"),
      standingVisible: true,
      lateAttendanceCreditPct: 50,
      termSplitConfig,
      usingDefaultScale: true,
      gradeScaleRules: DEFAULT_PH_GRADE_SCALE,
    },
    categories,
    assessments,
    students: options?.emptyStudents
      ? []
      : [
          {
            enrollmentId: "enroll-1",
            enrolledAt: new Date("2026-08-19T00:00:00.000Z"),
            availableBalance: 25,
            escrowedBalance: 10,
            earnedMeritAndAttendancePts: 35,
            student: {
              id: "student-1",
              fullName: "Dela Cruz, Juan",
              email: "juan@puento.local",
              institutionalId: "2026-0001",
            },
            attendanceSummary: {
              present: 1,
              late: 1,
              absent: 0,
              excused: 0,
              totalRecorded: 2,
              countable: 2,
              ratePct: 75,
            },
            remarksByAssessmentId: {
              "assess-1": "=cmd|' /C calc'!A0 Great boost",
              ...(multiTerm ? { "assess-2": "Solid work" } : {}),
            },
            standing: standing1,
          },
          {
            enrollmentId: "enroll-2",
            enrolledAt: new Date("2026-08-20T00:00:00.000Z"),
            availableBalance: 0,
            escrowedBalance: 0,
            earnedMeritAndAttendancePts: 0,
            student: {
              id: "student-2",
              fullName: "Reyes, Maria",
              email: "maria@puento.local",
              institutionalId: "2026-0002",
            },
            attendanceSummary: {
              present: 0,
              late: 0,
              absent: 0,
              excused: 0,
              totalRecorded: 0,
              countable: 0,
              ratePct: null,
            },
            remarksByAssessmentId: {
              "assess-1": "Absent during quiz",
            },
            standing: standing2,
          },
        ],
    exportedAt: new Date("2026-11-18T05:30:00.000Z"),
  };
}

describe("grade-sheet-csv helpers", () => {
  it("escapes RFC 4180 characters and neutralizes spreadsheet formula injection", () => {
    expect(escapeCsvCell("plain")).toBe("plain");
    expect(escapeCsvCell('a, "b"')).toBe('"a, ""b"""');
    expect(escapeCsvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(escapeCsvCell("+1+1")).toBe("'+1+1");
    expect(escapeCsvCell("-cmd")).toBe("'-cmd");
    expect(escapeCsvCell("@HYPERLINK")).toBe("'@HYPERLINK");
    expect(escapeCsvCell("-5")).toBe("-5");
    expect(escapeCsvCell("95.50%")).toBe("95.50%");
    expect(escapeCsvCell(42)).toBe("42");
    expect(escapeCsvCell(true)).toBe("Yes");
    expect(escapeCsvCell(false)).toBe("No");
    expect(escapeCsvCell(null)).toBe("");
  });

  it("builds safe filenames for full class and single student exports", () => {
    const data = buildFixtureData();
    expect(buildGradeSheetFilename(data)).toBe(
      "CS-101-1A-grade-sheet-2026-11-18.csv"
    );
    expect(buildGradeSheetFilename(data, data.students[0])).toBe(
      "CS-101-1A-2026-0001-Dela-Cruz-Juan-grade-sheet-2026-11-18.csv"
    );
  });

  it("formats full class CSV with UTF-8 BOM, standings, overrides, assessments, and scale reference", () => {
    const data = buildFixtureData();
    const csv = formatClassGradeSheetCsv(data);

    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("Grade Sheet Report,Full Class Grade Sheet");
    expect(csv).toContain("Subject Code,CS 101");
    expect(csv).toContain("Grading Scale,Default Philippine 1.00–5.00");
    expect(csv).toContain("Enrolled Students,2");

    // Student 1: Quizzes 48/50 = 96% (weight 80), Attendance 75% (weight 20) -> 91.80% -> 1.50
    expect(csv).toContain('"Dela Cruz, Juan"');
    expect(csv).toContain("91.80%,1.50,Very Good,Passing,NONE,91.80%,1.50");
    // Boosted score 45 + 3 = 48 / 50 (96.00%) and neutralized formula remark
    expect(csv).toContain("GRADED,45,3,48,96.00%,'=cmd|' /C calc'!A0 Great boost");

    // Student 2: INC override preserves pre-override computed 0.00% / 5.00
    expect(csv).toContain('"Reyes, Maria"');
    expect(csv).toContain("0.00%,INC,Incomplete,Not Passing,INC,0.00%,5.00");

    // Grade scale reference block
    expect(csv).toContain("ACTIVE GRADING SCALE REFERENCE");
    expect(csv).toContain("97.00%,100.00%,1.00,Excellent,Yes");
    expect(csv).toContain("0.00%,74.99%,5.00,Failed,No");
  });

  it("supports multi-term splits and empty classes cleanly", () => {
    const multiTermData = buildFixtureData({ multiTerm: true });
    const multiCsv = formatClassGradeSheetCsv(multiTermData);
    expect(multiCsv).toContain("Term Split,Midterm (40%) / Finals (60%)");
    expect(multiCsv).toContain("Midterm (Wt 40%) - %");
    expect(multiCsv).toContain("Finals (Wt 60%) - %");
    expect(multiCsv).toContain("Quizzes [Midterm] (Wt 80%) - %");

    const emptyData = buildFixtureData({ emptyStudents: true });
    const emptyCsv = formatClassGradeSheetCsv(emptyData);
    expect(emptyCsv).toContain("Enrolled Students,0");
    expect(emptyCsv).toContain("Institutional ID,Student Name,Email");
    expect(emptyCsv).toContain("ACTIVE GRADING SCALE REFERENCE");
  });

  it("formats individual student CSV as a structured report card", () => {
    const data = buildFixtureData({ multiTerm: true });
    const studentCsv = formatStudentGradeSheetCsv(data, data.students[0]!);

    expect(studentCsv.startsWith("\uFEFF")).toBe(true);
    expect(studentCsv).toContain(
      "Grade Sheet Report,Individual Student Grade Sheet"
    );
    expect(studentCsv).toContain('Student Name,"Dela Cruz, Juan"');
    expect(studentCsv).toContain("Institutional ID,2026-0001");
    expect(studentCsv).toContain("OVERALL CLASS STANDING");
    expect(studentCsv).toContain("ATTENDANCE & POINTS SUMMARY");
    expect(studentCsv).toContain("Wallet Available Points,25");
    expect(studentCsv).toContain("Wallet Escrowed Points,10");
    expect(studentCsv).toContain("Total Earned Points (Merits + Attendance),35");
    expect(studentCsv).toContain("TERM & CATEGORY BREAKDOWN");
    expect(studentCsv).toContain("ASSESSMENT SCORES DETAIL");
    expect(studentCsv).toContain(
      'Midterm,Quizzes,"Quiz 1, Intro",2026-09-10,50,GRADED,45,3,No,48,96.00%,Yes,\'=cmd|\' /C calc\'!A0 Great boost'
    );
    expect(studentCsv).toContain("ACTIVE GRADING SCALE REFERENCE");
  });
});
