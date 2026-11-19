import ExcelJS from "exceljs";
import { formatSubjectDateRange, toDateInputValue } from "@/lib/utils";
import type {
  GradeSheetStudentRow,
  SubjectGradeSheetData,
} from "./grade-sheet-service";

export type SpreadsheetCell = string | number | boolean | null | undefined;

/**
 * Normalizes a spreadsheet cell value while neutralizing formula injection on strings.
 */
export function sanitizeSpreadsheetCell(value: SpreadsheetCell): string | number {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : "";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  const text = String(value);
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?%?$/.test(text)) {
    return `'${text}`;
  }
  return text;
}

function formatPct(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "";
  }
  return `${value.toFixed(2)}%`;
}

function formatPassingLabel(isPassing: boolean | null): string {
  if (isPassing === null) return "N/A";
  return isPassing ? "Passing" : "Not Passing";
}

function sanitizeFilenameSlug(raw: string, fallback: string): string {
  const cleaned = raw
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || fallback;
}

/**
 * Generates a safe attachment filename for class or individual student Excel grade sheet downloads.
 */
export function buildGradeSheetFilename(
  data: SubjectGradeSheetData,
  student?: GradeSheetStudentRow
): string {
  const codeSlug = sanitizeFilenameSlug(data.subject.code, "subject");
  const sectionSlug = sanitizeFilenameSlug(data.subject.section, "section");
  const dateSlug = data.exportedAt.toISOString().slice(0, 10);

  if (student) {
    const idPart = student.student.institutionalId
      ? `${sanitizeFilenameSlug(student.student.institutionalId, "id")}-`
      : "";
    const nameSlug = sanitizeFilenameSlug(student.student.fullName, "student");
    return `${codeSlug}-${sectionSlug}-${idPart}${nameSlug}-grade-sheet-${dateSlug}.xlsx`;
  }

  return `${codeSlug}-${sectionSlug}-grade-sheet-${dateSlug}.xlsx`;
}

function appendRow(
  sheet: ExcelJS.Worksheet,
  cells: SpreadsheetCell[],
  options?: { header?: boolean; section?: boolean }
) {
  const row = sheet.addRow(cells.map(sanitizeSpreadsheetCell));
  if (options?.header) {
    row.font = { bold: true };
    row.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE2E8F0" },
      };
    });
  } else if (options?.section) {
    row.font = { bold: true };
  }
  return row;
}

function autoSizeColumns(sheet: ExcelJS.Worksheet) {
  sheet.columns.forEach((column) => {
    let maxLen = 12;
    column.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? "").length;
      if (len + 2 > maxLen) {
        maxLen = len + 2;
      }
    });
    column.width = Math.min(42, maxLen);
  });
}

function appendSubjectMetadataRows(
  sheet: ExcelJS.Worksheet,
  data: SubjectGradeSheetData,
  reportType: string
) {
  const { subject, exportedAt } = data;
  const schedule =
    formatSubjectDateRange(subject.startDate, subject.endDate) ?? "Not set";
  const termSplitLabel =
    subject.termSplitConfig?.enabled && subject.termSplitConfig.terms.length > 0
      ? subject.termSplitConfig.terms
          .map((t) => `${t.label} (${t.weightPct}%)`)
          .join(" / ")
      : "Single Term (100%)";

  const rows: [string, SpreadsheetCell][] = [
    ["Grade Sheet Report", reportType],
    ["Subject Code", subject.code],
    ["Subject Title", subject.title],
    ["Section", subject.section],
    ["Academic Term", subject.termName],
    ["Instructor", `${subject.teacherName} (${subject.teacherEmail})`],
    ["Class Schedule", schedule],
    [
      "Grading Scale",
      subject.usingDefaultScale
        ? "Default Philippine 1.00–5.00"
        : "Custom Subject Scale",
    ],
    ["Standing Visible to Students", subject.standingVisible],
    ["Late Attendance Credit", `${subject.lateAttendanceCreditPct}%`],
    ["Term Split", termSplitLabel],
    ["Exported At (UTC)", exportedAt.toISOString()],
  ];

  for (const [label, value] of rows) {
    appendRow(sheet, [label, value]);
  }
}

function appendGradeScaleReferenceRows(
  sheet: ExcelJS.Worksheet,
  data: SubjectGradeSheetData
) {
  const sortedRules = [...data.subject.gradeScaleRules].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || b.minPct - a.minPct
  );

  appendRow(sheet, ["ACTIVE GRADING SCALE REFERENCE"], { section: true });
  appendRow(
    sheet,
    ["Min %", "Max %", "Grade Equivalent", "Label", "Passing"],
    { header: true }
  );

  for (const rule of sortedRules) {
    appendRow(sheet, [
      `${rule.minPct.toFixed(2)}%`,
      `${rule.maxPct.toFixed(2)}%`,
      rule.gradeEquivalent,
      rule.label,
      rule.isPassing,
    ]);
  }
}

function buildCategoryHeaderPrefix(
  name: string,
  termKey: string,
  termLabel: string,
  weightPct: number,
  splitEnabled: boolean
): string {
  const termTag = splitEnabled && termKey !== "DEFAULT" ? ` [${termLabel}]` : "";
  return `${name}${termTag} (Wt ${weightPct}%)`;
}

function appendSummaryWorksheet(
  workbook: ExcelJS.Workbook,
  students: GradeSheetStudentRow[]
) {
  const summarySheet = workbook.addWorksheet("Summary");
  appendRow(summarySheet, ["Student Name", "Grade", "Grade Equivalent"], {
    header: true,
  });

  for (const row of students) {
    appendRow(summarySheet, [
      row.student.fullName,
      formatPct(row.standing.overallPct),
      row.standing.effectiveGradeEquivalent ?? "",
    ]);
  }

  autoSizeColumns(summarySheet);
}

/**
 * Generates a multi-tab Excel (.xlsx) workbook for the full class:
 * Tab 1: "Full Grade Sheet" (without wallet, merit, or boost point columns)
 * Tab 2: "Summary" (Student Name, Grade, Grade Equivalent)
 */
export async function buildClassGradeSheetWorkbook(
  data: SubjectGradeSheetData
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Puento";
  workbook.created = data.exportedAt;

  const sheet = workbook.addWorksheet("Full Grade Sheet");

  const splitEnabled = Boolean(data.subject.termSplitConfig?.enabled);
  const terms =
    splitEnabled && data.subject.termSplitConfig?.terms.length
      ? data.subject.termSplitConfig.terms
      : [];

  appendSubjectMetadataRows(sheet, data, "Full Class Grade Sheet");
  appendRow(sheet, ["Enrolled Students", data.students.length]);
  appendRow(sheet, []);

  const activeTermKeys = splitEnabled
    ? new Set(terms.map((t) => t.key))
    : new Set(["DEFAULT"]);
  const activeCategories = data.categories.filter((c) =>
    activeTermKeys.has(c.termKey)
  );

  const headers: string[] = [
    "Institutional ID",
    "Student Name",
    "Email",
    "Enrolled At",
    "Overall %",
    "Grade Equivalent",
    "Status Label",
    "Passing",
    "Manual Override",
    "Computed % (Pre-Override)",
    "Computed Grade (Pre-Override)",
    "Attendance Present",
    "Attendance Late",
    "Attendance Absent",
    "Attendance Excused",
    "Attendance Rate %",
  ];

  for (const term of terms) {
    headers.push(`${term.label} (Wt ${term.weightPct}%) - %`);
  }

  for (const cat of activeCategories) {
    const prefix = buildCategoryHeaderPrefix(
      cat.name,
      cat.termKey,
      cat.termLabel,
      cat.weightPct,
      splitEnabled
    );
    if (cat.categoryType === "POINTS_PARTICIPATION") {
      headers.push(
        `${prefix} - %`,
        `${prefix} - Normalized Wt %`,
        `${prefix} - Weighted Contrib %`
      );
    } else {
      headers.push(
        `${prefix} - %`,
        `${prefix} - Earned / Possible`,
        `${prefix} - Normalized Wt %`,
        `${prefix} - Weighted Contrib %`
      );
    }
  }

  for (const assessment of data.assessments) {
    const label = `${assessment.title} [${assessment.categoryName}] (/${assessment.maxScore})`;
    headers.push(
      `${label} - Status`,
      `${label} - Score`,
      `${label} - %`,
      `${label} - Remarks`
    );
  }

  appendRow(sheet, headers, { header: true });

  for (const row of data.students) {
    const termByKey = new Map(row.standing.terms.map((t) => [t.key, t]));
    const catById = new Map(row.standing.categories.map((c) => [c.categoryId, c]));
    const itemByAssessmentId = new Map(
      row.standing.categories
        .flatMap((c) => c.items)
        .map((item) => [item.assessmentId, item])
    );

    const cells: SpreadsheetCell[] = [
      row.student.institutionalId ?? "",
      row.student.fullName,
      row.student.email,
      toDateInputValue(row.enrolledAt),
      formatPct(row.standing.overallPct),
      row.standing.effectiveGradeEquivalent ?? "",
      row.standing.effectiveStatusLabel,
      formatPassingLabel(row.standing.isPassing),
      row.standing.manualStandingOverride,
      formatPct(row.standing.overallPct),
      row.standing.rawGradeEquivalent ?? "",
      row.attendanceSummary.present,
      row.attendanceSummary.late,
      row.attendanceSummary.absent,
      row.attendanceSummary.excused,
      formatPct(row.attendanceSummary.ratePct),
    ];

    for (const term of terms) {
      const termResult = termByKey.get(term.key);
      cells.push(formatPct(termResult?.termPct));
    }

    for (const cat of activeCategories) {
      const catResult = catById.get(cat.id);
      if (!catResult) {
        if (cat.categoryType === "POINTS_PARTICIPATION") {
          cells.push("", "", "");
        } else {
          cells.push("", "", "", "");
        }
        continue;
      }
      if (cat.categoryType === "POINTS_PARTICIPATION") {
        cells.push(
          formatPct(catResult.categoryPct),
          formatPct(catResult.normalizedWeightPct),
          formatPct(catResult.weightedContribution)
        );
      } else {
        cells.push(
          formatPct(catResult.categoryPct),
          `${catResult.earnedTotal} / ${catResult.possibleTotal}`,
          formatPct(catResult.normalizedWeightPct),
          formatPct(catResult.weightedContribution)
        );
      }
    }

    for (const assessment of data.assessments) {
      const item = itemByAssessmentId.get(assessment.id);
      const remarks = row.remarksByAssessmentId[assessment.id] ?? "";
      if (!item) {
        cells.push("PENDING", "", "", remarks);
        continue;
      }
      cells.push(
        item.status,
        item.effectiveScore !== null ? item.effectiveScore : "",
        formatPct(item.pct),
        remarks
      );
    }

    appendRow(sheet, cells);
  }

  appendRow(sheet, []);
  appendGradeScaleReferenceRows(sheet, data);
  autoSizeColumns(sheet);

  appendSummaryWorksheet(workbook, data.students);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}

/**
 * Generates a multi-tab Excel (.xlsx) workbook for an individual student:
 * Tab 1: "Student Grade Sheet" (without wallet, merit, or boost point fields)
 * Tab 2: "Summary" (Student Name, Grade, Grade Equivalent)
 */
export async function buildStudentGradeSheetWorkbook(
  data: SubjectGradeSheetData,
  studentRow: GradeSheetStudentRow
): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Puento";
  workbook.created = data.exportedAt;

  const sheet = workbook.addWorksheet("Student Grade Sheet");
  const { standing, attendanceSummary, student } = studentRow;
  const assessmentById = new Map(data.assessments.map((a) => [a.id, a]));
  const splitEnabled = Boolean(data.subject.termSplitConfig?.enabled);

  appendSubjectMetadataRows(sheet, data, "Individual Student Grade Sheet");
  appendRow(sheet, ["Student Name", student.fullName]);
  appendRow(sheet, ["Institutional ID", student.institutionalId ?? "N/A"]);
  appendRow(sheet, ["Student Email", student.email]);
  appendRow(sheet, ["Enrolled At", toDateInputValue(studentRow.enrolledAt)]);
  appendRow(sheet, []);

  appendRow(sheet, ["OVERALL CLASS STANDING"], { section: true });
  appendRow(sheet, [
    "Overall Percentage",
    standing.overallPct !== null ? formatPct(standing.overallPct) : "N/A",
  ]);
  appendRow(sheet, [
    "Grade Scale Equivalent",
    standing.effectiveGradeEquivalent ?? "N/A",
  ]);
  appendRow(sheet, ["Status Label", standing.effectiveStatusLabel]);
  appendRow(sheet, ["Passing Status", formatPassingLabel(standing.isPassing)]);
  appendRow(sheet, ["Manual Standing Override", standing.manualStandingOverride]);
  appendRow(sheet, [
    "Computed Percentage (Pre-Override)",
    standing.overallPct !== null ? formatPct(standing.overallPct) : "N/A",
  ]);
  appendRow(sheet, [
    "Computed Grade Equivalent (Pre-Override)",
    standing.rawGradeEquivalent ?? "N/A",
  ]);
  appendRow(sheet, []);

  appendRow(sheet, ["ATTENDANCE SUMMARY"], { section: true });
  appendRow(sheet, ["Present Sessions", attendanceSummary.present]);
  appendRow(sheet, ["Late Sessions", attendanceSummary.late]);
  appendRow(sheet, ["Absent Sessions", attendanceSummary.absent]);
  appendRow(sheet, ["Excused Sessions", attendanceSummary.excused]);
  appendRow(sheet, ["Total Recorded Sessions", attendanceSummary.totalRecorded]);
  appendRow(sheet, [
    "Attendance Rate",
    attendanceSummary.ratePct !== null
      ? formatPct(attendanceSummary.ratePct)
      : "N/A",
  ]);
  appendRow(sheet, []);

  appendRow(sheet, ["TERM & CATEGORY BREAKDOWN"], { section: true });
  appendRow(
    sheet,
    [
      "Term",
      "Term Weight %",
      "Term %",
      "Category",
      "Category Type",
      "Aggregation",
      "Configured Weight %",
      "Normalized Weight %",
      "Earned",
      "Possible",
      "Category %",
      "Weighted Contribution %",
      "Active in Standing",
    ],
    { header: true }
  );

  for (const term of standing.terms) {
    for (const cat of term.categories) {
      const hidePointTotals = cat.categoryType === "POINTS_PARTICIPATION";
      appendRow(sheet, [
        splitEnabled ? term.label : "Overall",
        `${term.configuredWeightPct}%`,
        term.termPct !== null ? formatPct(term.termPct) : "N/A",
        cat.name,
        cat.categoryType,
        cat.aggregationMethod,
        `${cat.configuredWeightPct}%`,
        formatPct(cat.normalizedWeightPct),
        hidePointTotals ? "" : cat.earnedTotal,
        hidePointTotals ? "" : cat.possibleTotal,
        cat.categoryPct !== null ? formatPct(cat.categoryPct) : "N/A",
        formatPct(cat.weightedContribution),
        cat.isActive,
      ]);
    }
  }

  appendRow(sheet, []);
  appendRow(sheet, ["ASSESSMENT SCORES DETAIL"], { section: true });
  appendRow(
    sheet,
    [
      "Term",
      "Category",
      "Assessment Title",
      "Date",
      "Max Score",
      "Status",
      "Score",
      "Score %",
      "Included in Standing",
      "Remarks",
    ],
    { header: true }
  );

  for (const term of standing.terms) {
    for (const cat of term.categories) {
      for (const item of cat.items) {
        const meta = assessmentById.get(item.assessmentId);
        const remarks = studentRow.remarksByAssessmentId[item.assessmentId] ?? "";
        appendRow(sheet, [
          splitEnabled ? term.label : "Overall",
          cat.name,
          item.title,
          toDateInputValue(meta?.assessmentDate),
          item.maxScore,
          item.status,
          item.effectiveScore !== null ? item.effectiveScore : "",
          item.pct !== null ? formatPct(item.pct) : "",
          item.includedInStanding,
          remarks,
        ]);
      }
    }
  }

  appendRow(sheet, []);
  appendGradeScaleReferenceRows(sheet, data);
  autoSizeColumns(sheet);

  appendSummaryWorksheet(workbook, [studentRow]);

  const buffer = await workbook.xlsx.writeBuffer();
  return new Uint8Array(buffer);
}
