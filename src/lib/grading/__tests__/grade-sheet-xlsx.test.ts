import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { computeStanding } from "@/lib/grading/computeStanding";
import { DEFAULT_PH_GRADE_SCALE } from "@/lib/grading/default-scale";
import type { SubjectGradeSheetData } from "@/lib/grading/grade-sheet-service";
import {
  buildClassGradeSheetWorkbook,
  buildGradeSheetFilename,
  buildStudentGradeSheetWorkbook,
  sanitizeSpreadsheetCell,
} from "@/lib/grading/grade-sheet-xlsx";

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

function sheetToRows(sheet: ExcelJS.Worksheet): unknown[][] {
  const rows: unknown[][] = [];
  sheet.eachRow((row) => {
    const vals = row.values as unknown[];
    rows.push(vals.slice(1));
  });
  return rows;
}

describe("grade-sheet-xlsx helpers", () => {
  it("neutralizes spreadsheet formula injection on string cells", () => {
    expect(sanitizeSpreadsheetCell("plain")).toBe("plain");
    expect(sanitizeSpreadsheetCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(sanitizeSpreadsheetCell("+1+1")).toBe("'+1+1");
    expect(sanitizeSpreadsheetCell("-cmd")).toBe("'-cmd");
    expect(sanitizeSpreadsheetCell("@HYPERLINK")).toBe("'@HYPERLINK");
    expect(sanitizeSpreadsheetCell("-5")).toBe("-5");
    expect(sanitizeSpreadsheetCell("95.50%")).toBe("95.50%");
    expect(sanitizeSpreadsheetCell(42)).toBe(42);
    expect(sanitizeSpreadsheetCell(true)).toBe("Yes");
    expect(sanitizeSpreadsheetCell(false)).toBe("No");
    expect(sanitizeSpreadsheetCell(null)).toBe("");
  });

  it("builds safe .xlsx filenames for full class and single student exports", () => {
    const data = buildFixtureData();
    expect(buildGradeSheetFilename(data)).toBe(
      "CS-101-1A-grade-sheet-2026-11-18.xlsx"
    );
    expect(buildGradeSheetFilename(data, data.students[0])).toBe(
      "CS-101-1A-2026-0001-Dela-Cruz-Juan-grade-sheet-2026-11-18.xlsx"
    );
  });

  it("builds a two-tab class workbook with Summary (Name, Grade, Grade Equivalent) and zero point columns", async () => {
    const data = buildFixtureData();
    const bytes = await buildClassGradeSheetWorkbook(data);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes.buffer as ArrayBuffer);

    expect(workbook.worksheets.map((ws) => ws.name)).toEqual([
      "Full Grade Sheet",
      "Summary",
    ]);

    const fullSheet = workbook.getWorksheet("Full Grade Sheet")!;
    const fullText = sheetToRows(fullSheet)
      .map((r) => r.join("|"))
      .join("\n");

    expect(fullText).toContain("Full Class Grade Sheet");
    expect(fullText).toContain("CS 101");
    expect(fullText).toContain("Dela Cruz, Juan");
    expect(fullText).toContain("91.80%|1.50|Very Good|Passing|NONE|91.80%|1.50");
    // Effective score (45 + 3 = 48) is shown without Boost Pts or Raw Score columns
    expect(fullText).toContain("GRADED|48|96.00%|'=cmd|' /C calc'!A0 Great boost");
    expect(fullText).toContain("Reyes, Maria");
    expect(fullText).toContain("0.00%|INC|Incomplete|Not Passing|INC|0.00%|5.00");

    // Zero point/boost columns anywhere
    expect(fullText).not.toContain("Wallet Available");
    expect(fullText).not.toContain("Wallet Escrowed");
    expect(fullText).not.toContain("Earned Merit");
    expect(fullText).not.toContain("Boost Pts");

    const summarySheet = workbook.getWorksheet("Summary")!;
    const summaryRows = sheetToRows(summarySheet);
    expect(summaryRows).toEqual([
      ["Student Name", "Grade", "Grade Equivalent"],
      ["Dela Cruz, Juan", "91.80%", "1.50"],
      ["Reyes, Maria", "0.00%", "INC"],
    ]);
  });

  it("supports multi-term splits and empty classes cleanly", async () => {
    const multiTermData = buildFixtureData({ multiTerm: true });
    const multiBytes = await buildClassGradeSheetWorkbook(multiTermData);
    const multiWb = new ExcelJS.Workbook();
    await multiWb.xlsx.load(multiBytes.buffer as ArrayBuffer);
    const multiText = sheetToRows(multiWb.getWorksheet("Full Grade Sheet")!)
      .map((r) => r.join("|"))
      .join("\n");

    expect(multiText).toContain("Midterm (40%) / Finals (60%)");
    expect(multiText).toContain("Midterm (Wt 40%) - %");
    expect(multiText).toContain("Finals (Wt 60%) - %");

    const emptyData = buildFixtureData({ emptyStudents: true });
    const emptyBytes = await buildClassGradeSheetWorkbook(emptyData);
    const emptyWb = new ExcelJS.Workbook();
    await emptyWb.xlsx.load(emptyBytes.buffer as ArrayBuffer);
    expect(sheetToRows(emptyWb.getWorksheet("Summary")!)).toEqual([
      ["Student Name", "Grade", "Grade Equivalent"],
    ]);
  });

  it("builds a two-tab individual student workbook with Summary tab and zero points rows", async () => {
    const data = buildFixtureData({ multiTerm: true });
    const bytes = await buildStudentGradeSheetWorkbook(data, data.students[0]!);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes.buffer as ArrayBuffer);

    expect(workbook.worksheets.map((ws) => ws.name)).toEqual([
      "Student Grade Sheet",
      "Summary",
    ]);

    const detailText = sheetToRows(workbook.getWorksheet("Student Grade Sheet")!)
      .map((r) => r.join("|"))
      .join("\n");

    expect(detailText).toContain("Individual Student Grade Sheet");
    expect(detailText).toContain("Student Name|Dela Cruz, Juan");
    expect(detailText).toContain("ATTENDANCE SUMMARY");
    expect(detailText).toContain(
      "Midterm|Quizzes|Quiz 1, Intro|2026-09-10|50|GRADED|48|96.00%|Yes|'=cmd|' /C calc'!A0 Great boost"
    );
    expect(detailText).not.toContain("Wallet Available");
    expect(detailText).not.toContain("Wallet Escrowed");
    expect(detailText).not.toContain("Total Earned Points");
    expect(detailText).not.toContain("Boost Points");

    expect(sheetToRows(workbook.getWorksheet("Summary")!)).toEqual([
      ["Student Name", "Grade", "Grade Equivalent"],
      ["Dela Cruz, Juan", "90.72%", "1.75"],
    ]);
  });
});
