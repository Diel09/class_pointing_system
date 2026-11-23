import { randomBytes } from "crypto";
import { z } from "zod";

const INVITE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * Generates an unambiguous uppercase alphanumeric class invite code.
 */
export function generateInviteCode(length = 8): string {
  const bytes = randomBytes(length);
  let code = "";
  for (let i = 0; i < length; i += 1) {
    code += INVITE_ALPHABET[bytes[i]! % INVITE_ALPHABET.length];
  }
  return code;
}

/**
 * Extracts a normalized class invite code from either a raw code or a /join?code=... URL.
 */
export function normalizeInviteCodeInput(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.includes("code=")) {
    try {
      const parsed = new URL(trimmed);
      const param = parsed.searchParams.get("code");
      if (param) {
        return param.trim().toUpperCase();
      }
    } catch {
      const match = trimmed.match(/code=([A-Za-z0-9_-]+)/i);
      if (match?.[1]) {
        return match[1].trim().toUpperCase();
      }
    }
  }
  return trimmed.toUpperCase();
}

/**
 * Parses comma-, semicolon-, or newline-separated student emails or institutional IDs from CSV/text input.
 */
export function parseRosterEntries(rawText: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  for (const line of rawText.split(/\r?\n/)) {
    for (const cell of line.split(/[,;\t]/)) {
      const cleaned = cell.trim().replace(/^["']|["']$/g, "");
      if (!cleaned) continue;
      // Skip common CSV header labels
      const lower = cleaned.toLowerCase();
      if (
        lower === "email" ||
        lower === "student_id" ||
        lower === "institutional_id" ||
        lower === "id"
      ) {
        continue;
      }
      if (!seen.has(lower)) {
        seen.add(lower);
        results.push(cleaned);
      }
    }
  }

  return results;
}

const optionalNullableDateSchema = z.preprocess(
  (value) => (value === "" || value === null ? null : value),
  z.coerce
    .date({ invalid_type_error: "Invalid date format." })
    .nullable()
    .optional()
);

/**
 * Checks that endDate is on or after startDate when both dates are present.
 */
export function hasValidSubjectDateRange(
  startDate: Date | null | undefined,
  endDate: Date | null | undefined
): boolean {
  if (!startDate || !endDate) {
    return true;
  }
  return endDate.getTime() >= startDate.getTime();
}

export const createSubjectSchema = z
  .object({
    code: z.string().trim().min(2, "Subject code is required.").max(30),
    title: z.string().trim().min(3, "Subject title is required.").max(120),
    section: z.string().trim().min(1, "Section is required.").max(40),
    termId: z.string().uuid("Invalid academic term.").optional(),
    startDate: optionalNullableDateSchema,
    endDate: optionalNullableDateSchema,
  })
  .refine((data) => hasValidSubjectDateRange(data.startDate, data.endDate), {
    message: "End date must be on or after start date.",
    path: ["endDate"],
  });

export const updateSubjectSchema = z.object({
  code: z.string().trim().min(2).max(30).optional(),
  title: z.string().trim().min(3).max(120).optional(),
  section: z.string().trim().min(1).max(40).optional(),
  termId: z.string().uuid().optional(),
  startDate: optionalNullableDateSchema,
  endDate: optionalNullableDateSchema,
  isArchived: z.boolean().optional(),
  allowNegativeBalance: z.boolean().optional(),
  allowP2pTransfers: z.boolean().optional(),
  p2pMaxPerTransfer: z.number().int().min(1).max(100_000).nullable().optional(),
  p2pMaxPerDay: z.number().int().min(1).max(100_000).nullable().optional(),
  p2pMaxPerTerm: z.number().int().min(1).max(1_000_000).nullable().optional(),
  allowOpenRedemptions: z.boolean().optional(),
  standingVisible: z.boolean().optional(),
  regenerateInviteCode: z.boolean().optional(),
});

export const joinSubjectSchema = z.object({
  inviteCode: z
    .string()
    .trim()
    .min(4, "Invite code is required.")
    .max(256)
    .transform(normalizeInviteCodeInput),
});

export const addRosterSchema = z.object({
  rawText: z.string().trim().min(1, "Enter at least one email or student ID."),
});

export const bulkDeleteSubjectsSchema = z.object({
  subjectIds: z
    .array(z.string().uuid("Invalid section ID."))
    .min(1, "Select at least one section to delete.")
    .max(200, "You can delete at most 200 sections at once."),
});

export const duplicateSubjectSchema = z.object({
  section: z.string().trim().min(1, "Section is required.").max(40),
});

/**
 * Checks whether two section labels are identical after trimming and case normalization.
 */
export function isSameSectionName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export const bulkUnenrollRosterSchema = z.object({
  enrollmentIds: z
    .array(z.string().uuid("Invalid enrollment ID."))
    .min(1, "Select at least one student to unenroll.")
    .max(200, "You can unenroll at most 200 students at once."),
});

export const addCoTeachersSchema = z.object({
  rawText: z
    .string()
    .trim()
    .min(1, "Enter at least one teacher email or institutional ID."),
});

export const createSubjectMaterialSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Material title is required.")
    .max(160, "Material title must be at most 160 characters."),
  topic: z
    .string()
    .trim()
    .max(80, "Topic must be at most 80 characters.")
    .nullable()
    .optional(),
  description: z
    .string()
    .trim()
    .max(1000, "Description must be at most 1000 characters.")
    .nullable()
    .optional(),
  driveUrl: z
    .string()
    .trim()
    .min(1, "Please enter a Google Drive link.")
    .max(2048, "Google Drive link is too long."),
  requirePublicLink: z.boolean().optional().default(true),
});

export const updateSubjectMaterialSchema = z.object({
  title: z
    .string()
    .trim()
    .min(2, "Material title is required.")
    .max(160, "Material title must be at most 160 characters.")
    .optional(),
  topic: z
    .string()
    .trim()
    .max(80, "Topic must be at most 80 characters.")
    .nullable()
    .optional(),
  description: z
    .string()
    .trim()
    .max(1000, "Description must be at most 1000 characters.")
    .nullable()
    .optional(),
  driveUrl: z
    .string()
    .trim()
    .min(1, "Please enter a Google Drive link.")
    .max(2048, "Google Drive link is too long.")
    .optional(),
  requirePublicLink: z.boolean().optional(),
});
