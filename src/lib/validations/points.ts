import { z } from "zod";

const nonZeroPointsDelta = z
  .number()
  .int("Points must be a whole integer.")
  .refine(
    (n) => n !== 0 && Math.abs(n) <= 1000,
    "Points must be a non-zero integer between -1000 and 1000."
  );

export const createMeritPresetSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Preset name must be at least 2 characters.")
    .max(80, "Preset name must be 80 characters or fewer."),
  type: z.enum(["MERIT", "DEMERIT"]),
  pointsDelta: nonZeroPointsDelta,
  description: z
    .string()
    .trim()
    .max(240, "Description must be 240 characters or fewer.")
    .optional()
    .nullable(),
});

export const updateMeritPresetSchema = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    type: z.enum(["MERIT", "DEMERIT"]).optional(),
    pointsDelta: nonZeroPointsDelta.optional(),
    description: z.string().trim().max(240).optional().nullable(),
    isArchived: z.boolean().optional(),
  })
  .refine((val) => Object.keys(val).length > 0, {
    message: "Provide at least one field to update.",
  });

export const awardMeritSchema = z
  .object({
    enrollmentIds: z
      .array(z.string().uuid("Invalid student enrollment ID."))
      .min(1, "Select at least one student.")
      .max(200, "Cannot award more than 200 students in one batch."),
    presetId: z.string().uuid("Invalid preset ID.").optional(),
    pointsDelta: nonZeroPointsDelta.optional(),
    note: z
      .string()
      .trim()
      .max(280, "Note must be 280 characters or fewer.")
      .optional(),
  })
  .superRefine((val, ctx) => {
    const hasPreset = val.presetId !== undefined;
    const hasCustom = val.pointsDelta !== undefined;
    if (hasPreset === hasCustom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select either a merit/demerit preset or enter a custom point value.",
      });
    }
    if (hasCustom && (!val.note || val.note.trim().length < 2)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["note"],
        message: "A short reason/note (at least 2 characters) is required for custom adjustments.",
      });
    }
  });

export const ledgerFilterSchema = z.enum([
  "ALL",
  "ATTENDANCE",
  "MERIT",
  "DEMERIT",
  "P2P",
  "REDEMPTION",
]);

export type LedgerFilterType = z.infer<typeof ledgerFilterSchema>;

export const ledgerQuerySchema = z.object({
  filter: ledgerFilterSchema.default("ALL"),
  enrollmentId: z.string().uuid("Invalid enrollment ID.").optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const p2pQrQuerySchema = z.object({
  amount: z.coerce
    .number()
    .int("Requested amount must be a whole integer.")
    .min(1, "Requested amount must be at least 1 pt.")
    .max(100_000, "Requested amount cannot exceed 100,000 pts.")
    .optional(),
  note: z
    .string()
    .trim()
    .max(140, "QR note must be 140 characters or fewer.")
    .optional(),
});

export const inspectP2pQrSchema = z.object({
  qrPayload: z.string().trim().min(10, "QR payload is required.").max(1024),
});

export const createP2pTransferSchema = z.object({
  qrPayload: z.string().trim().min(10, "QR payload is required.").max(1024),
  amount: z
    .number()
    .int("Transfer amount must be a whole integer.")
    .min(1, "Transfer amount must be at least 1 pt.")
    .max(100_000, "Transfer amount cannot exceed 100,000 pts."),
  note: z
    .string()
    .trim()
    .max(200, "Transfer note must be 200 characters or fewer.")
    .optional(),
});

export const createRewardItemSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, "Reward name must be at least 2 characters.")
      .max(100, "Reward name must be 100 characters or fewer."),
    description: z
      .string()
      .trim()
      .max(300, "Description must be 300 characters or fewer.")
      .optional()
      .nullable(),
    rewardType: z.enum(["SCORE_BOOST", "FIXED_PERK"]),
    pointCostPerUnit: z
      .number()
      .int("Point cost must be a whole integer.")
      .min(1, "Point cost must be at least 1 pt.")
      .max(100_000, "Point cost cannot exceed 100,000 pts."),
    scoreValuePerUnit: z
      .number()
      .min(0.25, "Score boost per unit must be at least 0.25.")
      .max(100, "Score boost per unit cannot exceed 100.")
      .default(1),
    eligibleCategoryIds: z
      .array(z.string().uuid("Invalid category ID."))
      .max(20)
      .optional()
      .default([]),
    allowExtraCredit: z.boolean().optional().default(false),
    maxBoostPerAssessment: z
      .number()
      .min(0.25, "Max boost must be positive.")
      .max(1000)
      .optional()
      .nullable(),
  })
  .superRefine((val, ctx) => {
    if (
      val.rewardType === "SCORE_BOOST" &&
      val.maxBoostPerAssessment !== null &&
      val.maxBoostPerAssessment !== undefined &&
      val.maxBoostPerAssessment < val.scoreValuePerUnit
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["maxBoostPerAssessment"],
        message: "Max boost per assessment cannot be less than one unit's boost value.",
      });
    }
  });

export const updateRewardItemSchema = z
  .object({
    name: z.string().trim().min(2).max(100).optional(),
    description: z.string().trim().max(300).optional().nullable(),
    pointCostPerUnit: z.number().int().min(1).max(100_000).optional(),
    scoreValuePerUnit: z.number().min(0.25).max(100).optional(),
    eligibleCategoryIds: z.array(z.string().uuid()).max(20).optional(),
    allowExtraCredit: z.boolean().optional(),
    maxBoostPerAssessment: z.number().min(0.25).max(1000).optional().nullable(),
    isActive: z.boolean().optional(),
  })
  .refine((val) => Object.keys(val).length > 0, {
    message: "Provide at least one field to update.",
  });

export const createRedemptionSchema = z
  .object({
    rewardItemId: z.string().uuid("Invalid reward item ID.").optional(),
    isCustomRequest: z.boolean().optional().default(false),
    customPointsCost: z
      .number()
      .int("Points must be a whole integer.")
      .min(1, "Custom spend must be at least 1 pt.")
      .max(100_000)
      .optional(),
    requestedUnits: z
      .number()
      .int("Requested units must be a whole integer.")
      .min(1, "Requested units must be at least 1.")
      .max(100)
      .optional()
      .default(1),
    targetAssessmentId: z
      .string()
      .uuid("Invalid target assessment ID.")
      .optional()
      .nullable(),
    targetLabel: z
      .string()
      .trim()
      .max(140, "Target exam/activity label must be 140 characters or fewer.")
      .optional()
      .nullable(),
    studentNote: z
      .string()
      .trim()
      .max(280, "Note must be 280 characters or fewer.")
      .optional()
      .nullable(),
  })
  .superRefine((val, ctx) => {
    if (val.isCustomRequest) {
      if (val.rewardItemId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Custom requests cannot also specify a catalog reward.",
        });
      }
      if (!val.customPointsCost) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["customPointsCost"],
          message: "Enter the point amount for your custom redemption request.",
        });
      }
      if (!val.targetLabel || val.targetLabel.trim().length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["targetLabel"],
          message: "Describe the target exam, activity, or usage for your custom request.",
        });
      }
    } else if (!val.rewardItemId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["rewardItemId"],
        message: "Select a reward from the catalog.",
      });
    }
  });

export const reviewRedemptionSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  teacherNote: z
    .string()
    .trim()
    .max(280, "Teacher note must be 280 characters or fewer.")
    .optional()
    .nullable(),
});

export const redemptionStatusFilterSchema = z.enum([
  "ALL",
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
]);
