import { formatSubjectDateRange, toDateInputValue } from "@/lib/utils";
import type {
  GradeSheetStudentRow,
  SubjectGradeSheetData,
} from "./grade-sheet-service";

type CsvCell = string | number | boolean | null | undefined;

const UTF8_BOM = "\uFEFF";

/**
 * Escapes a single CSV cell per RFC 4180 while neutralizing spreadsheet formula injection.
 */
export function escapeCsvCell(value: CsvCell): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  let text = String(value);
  // Prefix leading formula trigger characters unless the value is a plain number/percentage.
  if (/^[=+\-@\t\r]/.test(text) && !/^-?\d+(\.\d+)?%?$/.test(text)) {
    text = `'${text}`;
  }

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function csvRow(cells: CsvCell[]): string {
  return cells.map(escapeCsvCell).join(",");
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
 * Generates a safe attachment filename for class or individual student grade sheet CSV downloads.
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
    return `${codeSlug}-${sectionSlug}-${idPart}${nameSlug}-grade-sheet-${dateSlug}.csv`;
  }

  return `${codeSlug}-${sectionSlug}-grade-sheet-${dateSlug}.csv`;
}

function buildSubjectMetadataRows(
  data: SubjectGradeSheetData,
  reportType: string
): string[] {
  const { subject, exportedAt } = data;
  const schedule =
    formatSubjectDateRange(subject.startDate, subject.endDate) ?? "Not set";
  const termSplitLabel =
    subject.termSplitConfig?.enabled && subject.termSplitConfig.terms.length > 0
      ? subject.termSplitConfig.terms
          .map((t) => `${t.label} (${t.weightPct}%)`)
          .join(" / ")
      : "Single Term (100%)";

  return [
    csvRow(["Grade Sheet Report", reportType]),
    csvRow(["Subject Code", subject.code]),
    csvRow(["Subject Title", subject.title]),
    csvRow(["Section", subject.section]),
    csvRow(["Academic Term", subject.termName]),
    csvRow(["Instructor", `${subject.teacherName} (${subject.teacherEmail})`]),
    csvRow(["Class Schedule", schedule]),
    csvRow([
      "Grading Scale",
      subject.usingDefaultScale
        ? "Default Philippine 1.00–5.00"
        : "Custom Subject Scale",
    ]),
    csvRow(["Standing Visible to Students", subject.standingVisible]),
    csvRow(["Late Attendance Credit", `${subject.lateAttendanceCreditPct}%`]),
    csvRow(["Term Split", termSplitLabel]),
    csvRow(["Exported At (UTC)", exportedAt.toISOString()]),
  ];
}

function buildGradeScaleReferenceRows(data: SubjectGradeSheetData): string[] {
  const sortedRules = [...data.subject.gradeScaleRules].sort(
    (a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || b.minPct - a.minPct
  );

  const lines: string[] = [
    csvRow(["ACTIVE GRADING SCALE REFERENCE"]),
    csvRow(["Min %", "Max %", "Grade Equivalent", "Label", "Passing"]),
  ];

  for (const rule of sortedRules) {
    lines.push(
      csvRow([
        `${rule.minPct.toFixed(2)}%`,
        `${rule.maxPct.toFixed(2)}%`,
        rule.gradeEquivalent,
        rule.label,
        rule.isPassing,
      ])
    );
  }

  return lines;
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

/**
 * Formats the complete class grade sheet CSV (all students, standings, categories, assessments, and scale).
 */
export function formatClassGradeSheetCsv(data: SubjectGradeSheetData): string {
  const splitEnabled = Boolean(data.subject.termSplitConfig?.enabled);
  const terms =
    splitEnabled && data.subject.termSplitConfig?.terms.length
      ? data.subject.termSplitConfig.terms
      : [];

  const lines: string[] = [
    ...buildSubjectMetadataRows(data, "Full Class Grade Sheet"),
    csvRow(["Enrolled Students", data.students.length]),
    "",
  ];

  // Filter categories to active term keys when term split is configured
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
    "Wallet Available Pts",
    "Wallet Escrowed Pts",
    "Earned Merit & Attendance Pts",
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
    headers.push(
      `${prefix} - %`,
      `${prefix} - Earned / Possible`,
      `${prefix} - Normalized Wt %`,
      `${prefix} - Weighted Contrib %`
    );
  }

  for (const assessment of data.assessments) {
    const label = `${assessment.title} [${assessment.categoryName}] (/${assessment.maxScore})`;
    headers.push(
      `${label} - Status`,
      `${label} - Raw Score`,
      `${label} - Boost Pts`,
      `${label} - Effective Score`,
      `${label} - %`,
      `${label} - Remarks`
    );
  }

  lines.push(csvRow(headers));

  for (const row of data.students) {
    const termByKey = new Map(row.standing.terms.map((t) => [t.key, t]));
    const catById = new Map(row.standing.categories.map((c) => [c.categoryId, c]));
    const itemByAssessmentId = new Map(
      row.standing.categories
        .flatMap((c) => c.items)
        .map((item) => [item.assessmentId, item])
    );

    const cells: CsvCell[] = [
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
      row.availableBalance,
      row.escrowedBalance,
      row.earnedMeritAndAttendancePts,
    ];

    for (const term of terms) {
      const termResult = termByKey.get(term.key);
      cells.push(formatPct(termResult?.termPct));
    }

    for (const cat of activeCategories) {
      const catResult = catById.get(cat.id);
      if (!catResult) {
        cells.push("", "", "", "");
        continue;
      }
      cells.push(
        formatPct(catResult.categoryPct),
        `${catResult.earnedTotal} / ${catResult.possibleTotal}`,
        formatPct(catResult.normalizedWeightPct),
        formatPct(catResult.weightedContribution)
      );
    }

    for (const assessment of data.assessments) {
      const item = itemByAssessmentId.get(assessment.id);
      const remarks = row.remarksByAssessmentId[assessment.id] ?? "";
      if (!item) {
        cells.push("PENDING", "", 0, "", "", remarks);
        continue;
      }
      cells.push(
        item.status,
        item.rawScore !== null ? item.rawScore : "",
        item.bonusPoints,
        item.effectiveScore !== null ? item.effectiveScore : "",
        formatPct(item.pct),
        remarks
      );
    }

    lines.push(csvRow(cells));
  }

  lines.push("", ...buildGradeScaleReferenceRows(data));

  return `${UTF8_BOM}${lines.join("\r\n")}\r\n`;
}

/**
 * Formats an individual student's detailed grade sheet report CSV.
 */
export function formatStudentGradeSheetCsv(
  data: SubjectGradeSheetData,
  studentRow: GradeSheetStudentRow
): string {
  const { standing, attendanceSummary, student } = studentRow;
  const assessmentById = new Map(data.assessments.map((a) => [a.id, a]));
  const splitEnabled = Boolean(data.subject.termSplitConfig?.enabled);

  const lines: string[] = [
    ...buildSubjectMetadataRows(data, "Individual Student Grade Sheet"),
    csvRow(["Student Name", student.fullName]),
    csvRow(["Institutional ID", student.institutionalId ?? "N/A"]),
    csvRow(["Student Email", student.email]),
    csvRow(["Enrolled At", toDateInputValue(studentRow.enrolledAt)]),
    "",
    csvRow(["OVERALL CLASS STANDING"]),
    csvRow([
      "Overall Percentage",
      standing.overallPct !== null ? formatPct(standing.overallPct) : "N/A",
    ]),
    csvRow([
      "Grade Scale Equivalent",
      standing.effectiveGradeEquivalent ?? "N/A",
    ]),
    csvRow(["Status Label", standing.effectiveStatusLabel]),
    csvRow(["Passing Status", formatPassingLabel(standing.isPassing)]),
    csvRow(["Manual Standing Override", standing.manualStandingOverride]),
    csvRow([
      "Computed Percentage (Pre-Override)",
      standing.overallPct !== null ? formatPct(standing.overallPct) : "N/A",
    ]),
    csvRow([
      "Computed Grade Equivalent (Pre-Override)",
      standing.rawGradeEquivalent ?? "N/A",
    ]),
    "",
    csvRow(["ATTENDANCE & POINTS SUMMARY"]),
    csvRow(["Present Sessions", attendanceSummary.present]),
    csvRow(["Late Sessions", attendanceSummary.late]),
    csvRow(["Absent Sessions", attendanceSummary.absent]),
    csvRow(["Excused Sessions", attendanceSummary.excused]),
    csvRow(["Total Recorded Sessions", attendanceSummary.totalRecorded]),
    csvRow([
      "Attendance Rate",
      attendanceSummary.ratePct !== null
        ? formatPct(attendanceSummary.ratePct)
        : "N/A",
    ]),
    csvRow(["Wallet Available Points", studentRow.availableBalance]),
    csvRow(["Wallet Escrowed Points", studentRow.escrowedBalance]),
    csvRow([
      "Total Earned Points (Merits + Attendance)",
      studentRow.earnedMeritAndAttendancePts,
    ]),
    "",
    csvRow(["TERM & CATEGORY BREAKDOWN"]),
    csvRow([
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
    ]),
  ];

  for (const term of standing.terms) {
    for (const cat of term.categories) {
      lines.push(
        csvRow([
          splitEnabled ? term.label : "Overall",
          `${term.configuredWeightPct}%`,
          term.termPct !== null ? formatPct(term.termPct) : "N/A",
          cat.name,
          cat.categoryType,
          cat.aggregationMethod,
          `${cat.configuredWeightPct}%`,
          formatPct(cat.normalizedWeightPct),
          cat.earnedTotal,
          cat.possibleTotal,
          cat.categoryPct !== null ? formatPct(cat.categoryPct) : "N/A",
          formatPct(cat.weightedContribution),
          cat.isActive,
        ])
      );
    }
  }

  lines.push(
    "",
    csvRow(["ASSESSMENT SCORES DETAIL"]),
    csvRow([
      "Term",
      "Category",
      "Assessment Title",
      "Date",
      "Max Score",
      "Status",
      "Raw Score",
      "Boost Points",
      "Extra Credit Allowed",
      "Effective Score",
      "Score %",
      "Included in Standing",
      "Remarks",
    ])
  );

  for (const term of standing.terms) {
    for (const cat of term.categories) {
      for (const item of cat.items) {
        const meta = assessmentById.get(item.assessmentId);
        const remarks = studentRow.remarksByAssessmentId[item.assessmentId] ?? "";
        lines.push(
          csvRow([
            splitEnabled ? term.label : "Overall",
            cat.name,
            item.title,
            toDateInputValue(meta?.assessmentDate),
            item.maxScore,
            item.status,
            item.rawScore !== null ? item.rawScore : "",
            item.bonusPoints,
            item.allowExtraCredit,
            item.effectiveScore !== null ? item.effectiveScore : "",
            item.pct !== null ? formatPct(item.pct) : "",
            item.includedInStanding,
            remarks,
          ])
        );
      }
    }
  }

  lines.push("", ...buildGradeScaleReferenceRows(data));

  return `${UTF8_BOM}${lines.join("\r\n")}\r\n`;
}
