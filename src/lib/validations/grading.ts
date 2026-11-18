import { z } from "zod";
import { round2 } from "@/lib/grading/computeStanding";
import type { GradeScaleRuleInput } from "@/lib/grading/default-scale";

export const termSplitEntrySchema = z.object({
  key: z
    .string()
    .trim()
    .min(1, "Term key is required.")
    .max(30, "Term key must be 30 characters or fewer.")
    .regex(/^[A-Za-z0-9_-]+$/, "Term key must be alphanumeric."),
  label: z
    .string()
    .trim()
    .min(1, "Term label is required.")
    .max(40, "Term label must be 40 characters or fewer."),
  weightPct: z
    .number()
    .min(1, "Term weight must be at least 1%.")
    .max(100, "Term weight cannot exceed 100%."),
});

export const termSplitConfigSchema = z.object({
  enabled: z.boolean(),
  terms: z.array(termSplitEntrySchema).max(6),
});

export const gradeCategoryPayloadSchema = z
  .object({
    id: z.string().uuid().optional(),
    termKey: z.string().trim().min(1).max(30).default("DEFAULT"),
    name: z
      .string()
      .trim()
      .min(2, "Category name must be at least 2 characters.")
      .max(60, "Category name must be 60 characters or fewer."),
    categoryType: z.enum(["ASSESSMENT", "ATTENDANCE", "POINTS_PARTICIPATION"]),
    weightPct: z
      .number()
      .min(0.01, "Category weight must be positive.")
      .max(100, "Category weight cannot exceed 100%."),
    aggregationMethod: z
      .enum(["TOTAL_POINTS", "EQUAL_AVERAGE"])
      .default("TOTAL_POINTS"),
    targetPointsCap: z
      .number()
      .int("Target points cap must be a whole integer.")
      .min(1, "Target points cap must be at least 1.")
      .max(100_000)
      .nullable()
      .optional(),
    sortOrder: z.number().int().min(0).max(100).optional(),
  })
  .superRefine((val, ctx) => {
    if (
      val.categoryType === "POINTS_PARTICIPATION" &&
      (!val.targetPointsCap || val.targetPointsCap < 1)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetPointsCap"],
        message:
          "Points/Participation categories require a target point cap (>= 1).",
      });
    }
  });

export const updateComputationSchema = z
  .object({
    lateAttendanceCreditPct: z
      .number()
      .min(0, "Late attendance credit cannot be negative.")
      .max(100, "Late attendance credit cannot exceed 100%."),
    termSplitConfig: termSplitConfigSchema.nullable().optional(),
    categories: z
      .array(gradeCategoryPayloadSchema)
      .min(1, "Configure at least one grade category.")
      .max(30, "Maximum of 30 grade categories per subject."),
  })
  .superRefine((val, ctx) => {
    const splitEnabled = Boolean(val.termSplitConfig?.enabled);

    if (splitEnabled) {
      const terms = val.termSplitConfig?.terms ?? [];
      if (terms.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["termSplitConfig"],
          message: "Multi-term split requires at least 2 terms.",
        });
        return;
      }

      const seenKeys = new Set<string>();
      let termWeightSum = 0;
      for (const term of terms) {
        if (seenKeys.has(term.key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["termSplitConfig"],
            message: `Duplicate term key "${term.key}".`,
          });
          return;
        }
        seenKeys.add(term.key);
        termWeightSum += term.weightPct;
      }

      if (Math.abs(round2(termWeightSum) - 100) > 0.01) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["termSplitConfig"],
          message: `Term weights must total 100% (currently ${round2(termWeightSum)}%).`,
        });
        return;
      }

      for (const term of terms) {
        const termCats = val.categories.filter((c) => c.termKey === term.key);
        if (termCats.length === 0) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["categories"],
            message: `Add at least one category for term "${term.label}".`,
          });
          return;
        }
        const sum = termCats.reduce((acc, c) => acc + c.weightPct, 0);
        if (Math.abs(round2(sum) - 100) > 0.01) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["categories"],
            message: `Category weights for "${term.label}" must total 100% (currently ${round2(sum)}%).`,
          });
          return;
        }
      }

      const orphanCat = val.categories.find((c) => !seenKeys.has(c.termKey));
      if (orphanCat) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["categories"],
          message: `Category "${orphanCat.name}" references unknown term "${orphanCat.termKey}".`,
        });
      }
    } else {
      const defaultCats = val.categories.filter((c) => c.termKey === "DEFAULT");
      if (defaultCats.length !== val.categories.length) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["categories"],
          message:
            "All categories must use termKey 'DEFAULT' when multi-term split is disabled.",
        });
        return;
      }
      const sum = defaultCats.reduce((acc, c) => acc + c.weightPct, 0);
      if (Math.abs(round2(sum) - 100) > 0.01) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["categories"],
          message: `Category weights must total 100% (currently ${round2(sum)}%).`,
        });
      }
    }
  });

export const gradeScaleRuleSchema = z
  .object({
    minPct: z.number().min(0, "Min % must be >= 0.").max(200),
    maxPct: z.number().min(0).max(500),
    gradeEquivalent: z
      .string()
      .trim()
      .min(1, "Grade equivalent is required.")
      .max(16, "Grade equivalent must be 16 characters or fewer."),
    label: z
      .string()
      .trim()
      .min(1, "Status label is required.")
      .max(40, "Status label must be 40 characters or fewer."),
    isPassing: z.boolean().default(true),
  })
  .refine((val) => val.minPct <= val.maxPct, {
    message: "Min % cannot exceed Max %.",
    path: ["minPct"],
  });

export interface ValidateGradeScaleOptions {
  requireGapFree?: boolean;
}

export interface GradeScaleGap {
  fromPct: number;
  toPct: number;
  prevGrade: string;
  nextGrade: string;
}

/**
 * Returns any inter-bracket gaps (exceeding 0.01% step) between sorted grade scale rules.
 */
export function findGradeScaleGaps(
  rules: GradeScaleRuleInput[]
): GradeScaleGap[] {
  if (rules.length < 2) {
    return [];
  }

  const sorted = [...rules]
    .filter((r) => Number.isFinite(r.minPct) && Number.isFinite(r.maxPct))
    .sort((a, b) => a.minPct - b.minPct);

  const gaps: GradeScaleGap[] = [];
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = sorted[i - 1]!;
    const curr = sorted[i]!;
    const expectedMin = round2(prev.maxPct + 0.01);
    const actualMin = round2(curr.minPct);
    if (actualMin > expectedMin + 0.001) {
      gaps.push({
        fromPct: round2(prev.maxPct),
        toPct: actualMin,
        prevGrade: prev.gradeEquivalent,
        nextGrade: curr.gradeEquivalent,
      });
    }
  }

  return gaps;
}

/**
 * Validates grade scale brackets covering 0%..100%+.
 * When requireGapFree is true (default), enforces 0.01% continuity with zero gaps.
 * When requireGapFree is false, allows unequal/custom gaps between brackets while still rejecting overlaps.
 */
export function validateGradeScaleRules(
  rules: GradeScaleRuleInput[],
  options: ValidateGradeScaleOptions = {}
): string | null {
  if (rules.length === 0) {
    return "Add at least one grade scale rule.";
  }

  const requireGapFree = options.requireGapFree ?? true;

  for (const rule of rules) {
    if (!Number.isFinite(rule.minPct) || !Number.isFinite(rule.maxPct)) {
      return `Bracket "${rule.gradeEquivalent || "Untitled"}" must have valid numeric Min % and Max % values.`;
    }
    if (rule.minPct < 0) {
      return `Bracket "${rule.gradeEquivalent || "Untitled"}" cannot have a negative Min %.`;
    }
  }

  const sorted = [...rules].sort((a, b) => a.minPct - b.minPct);
  const first = sorted[0]!;
  if (Math.abs(round2(first.minPct) - 0) > 0.001) {
    return `Grade scale must start at 0.00% (lowest bracket starts at ${round2(
      first.minPct
    )}%).`;
  }

  for (let i = 0; i < sorted.length; i += 1) {
    const curr = sorted[i]!;
    if (curr.minPct > curr.maxPct) {
      return `Bracket "${curr.gradeEquivalent}" has minPct (${curr.minPct}%) greater than maxPct (${curr.maxPct}%).`;
    }
    if (i > 0) {
      const prev = sorted[i - 1]!;
      const expectedMin = round2(prev.maxPct + 0.01);
      const actualMin = round2(curr.minPct);
      if (actualMin < expectedMin - 0.001) {
        return `Grade scale overlap between "${prev.gradeEquivalent}" (ends ${round2(
          prev.maxPct
        )}%) and "${curr.gradeEquivalent}" (starts ${actualMin}%).`;
      }
      if (requireGapFree && actualMin > expectedMin + 0.001) {
        return `Grade scale gap between "${prev.gradeEquivalent}" (ends ${round2(
          prev.maxPct
        )}%) and "${curr.gradeEquivalent}" (starts ${actualMin}%). Expected ${expectedMin}%.`;
      }
    }
  }

  const last = sorted[sorted.length - 1]!;
  if (round2(last.maxPct) < 100) {
    return `Highest grade bracket must reach at least 100.00% (currently ends at ${round2(
      last.maxPct
    )}%).`;
  }

  return null;
}

export const updateGradeScaleSchema = z
  .object({
    requireGapFree: z.boolean().default(true),
    rules: z.array(gradeScaleRuleSchema).min(1).max(30),
  })
  .superRefine((val, ctx) => {
    const error = validateGradeScaleRules(val.rules, {
      requireGapFree: val.requireGapFree,
    });
    if (error) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rules"],
        message: error,
      });
    }
  });

export const createAssessmentSchema = z.object({
  categoryId: z.string().uuid("Select a valid grade category."),
  title: z
    .string()
    .trim()
    .min(2, "Assessment title must be at least 2 characters.")
    .max(120, "Assessment title must be 120 characters or fewer."),
  description: z
    .string()
    .trim()
    .max(1000, "Description must be 1000 characters or fewer.")
    .optional()
    .nullable(),
  maxScore: z
    .number()
    .positive("Max score must be greater than 0.")
    .max(10_000, "Max score cannot exceed 10,000."),
  assessmentDate: z.string().datetime().optional().nullable(),
});

export const updateAssessmentSchema = z
  .object({
    categoryId: z.string().uuid().optional(),
    title: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(1000).optional().nullable(),
    maxScore: z.number().positive().max(10_000).optional(),
    assessmentDate: z.string().datetime().optional().nullable(),
  })
  .refine((val) => Object.keys(val).length > 0, {
    message: "Provide at least one assessment field to update.",
  });

export const scoreEntryInputSchema = z
  .object({
    enrollmentId: z.string().uuid("Invalid student enrollment ID."),
    status: z.enum(["PENDING", "GRADED", "MISSING", "EXCUSED"]),
    rawScore: z.number().min(0, "Score cannot be negative.").nullable().optional(),
    remarks: z
      .string()
      .trim()
      .max(280, "Remarks must be 280 characters or fewer.")
      .optional()
      .nullable(),
  })
  .superRefine((val, ctx) => {
    if (
      val.status === "GRADED" &&
      (val.rawScore === null || val.rawScore === undefined)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rawScore"],
        message: "Graded status requires a numeric score.",
      });
    }
  });

export const upsertAssessmentScoresSchema = z.object({
  scores: z
    .array(scoreEntryInputSchema)
    .min(1, "Provide at least one score update.")
    .max(300, "Maximum of 300 score rows per request."),
});

export const updateStandingOverrideSchema = z.object({
  manualStandingOverride: z.enum(["NONE", "INC", "DRP"]),
});

export interface ParsedCsvScoreRow {
  identifier: string;
  status: "PENDING" | "GRADED" | "MISSING" | "EXCUSED";
  rawScore: number | null;
  remarks: string | null;
  lineNumber: number;
}

/**
 * Parses CSV/TSV lines formatted as: `identifier, score_or_status[, remarks]`
 * where identifier is student email or institutional ID.
 */
export function parseCsvScores(rawText: string): {
  rows: ParsedCsvScoreRow[];
  errors: string[];
} {
  const rows: ParsedCsvScoreRow[] = [];
  const errors: string[] = [];
  const lines = rawText.split(/\r?\n/);

  lines.forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;

    const cells = line
      .split(/[,;\t]/)
      .map((cell) => cell.trim().replace(/^["']|["']$/g, ""));

    const identifier = cells[0] ?? "";
    const rawValue = (cells[1] ?? "").trim();
    const remarks = cells[2]?.trim() || null;

    if (
      index === 0 &&
      ["email", "student_id", "institutional_id", "identifier", "id"].includes(
        identifier.toLowerCase()
      )
    ) {
      return;
    }

    if (!identifier || !rawValue) {
      errors.push(`Line ${index + 1}: expected "email_or_id, score_or_status".`);
      return;
    }

    const upper = rawValue.toUpperCase();
    if (upper === "PENDING" || upper === "MISSING" || upper === "EXCUSED") {
      rows.push({
        identifier,
        status: upper,
        rawScore: null,
        remarks,
        lineNumber: index + 1,
      });
      return;
    }

    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric) || numeric < 0) {
      errors.push(
        `Line ${index + 1}: "${rawValue}" is not a valid score or status (PENDING/MISSING/EXCUSED).`
      );
      return;
    }

    rows.push({
      identifier,
      status: "GRADED",
      rawScore: numeric,
      remarks,
      lineNumber: index + 1,
    });
  });

  return { rows, errors };
}
