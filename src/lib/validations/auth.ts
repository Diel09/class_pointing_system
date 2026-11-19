import { z } from "zod";

const institutionalIdSchema = z
  .string()
  .trim()
  .min(3, "Institutional ID must be at least 3 characters.")
  .max(40, "Institutional ID must be at most 40 characters.")
  .regex(
    /^[A-Za-z0-9._-]+$/,
    "Institutional ID may only contain letters, numbers, dots, underscores, or hyphens."
  );

export const registerSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Full name must be at least 2 characters.")
    .max(100, "Full name is too long."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  institutionalId: z
    .union([institutionalIdSchema, z.literal(""), z.null(), z.undefined()])
    .transform((val) => (val && val.trim().length > 0 ? val.trim().toUpperCase() : null)),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128, "Password must be at most 128 characters."),
  accountType: z.enum(["STUDENT", "TEACHER"]).default("STUDENT"),
  inviteCode: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((val) => (val && val.trim().length > 0 ? val.trim().toUpperCase() : null)),
});

export const loginSchema = z.object({
  identifier: z
    .string()
    .trim()
    .min(1, "Email or Institutional ID is required.")
    .max(120),
  password: z.string().min(1, "Password is required.").max(128),
});

export const passwordResetRequestSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
});

export const passwordResetConfirmSchema = z.object({
  token: z.string().trim().min(16, "Invalid reset token."),
  newPassword: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128, "Password must be at most 128 characters."),
});

export const deviceRegisterSchema = z.object({
  mirrorToken: z.string().trim().min(10).max(512).optional().nullable(),
});

export const adminUpdateTeacherSchema = z.object({
  status: z.enum(["ACTIVE", "PENDING", "SUSPENDED"]),
});

export const adminCreateTeacherSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(2, "Full name must be at least 2 characters.")
    .max(100, "Full name is too long."),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  institutionalId: z
    .union([institutionalIdSchema, z.literal(""), z.null(), z.undefined()])
    .transform((val) =>
      val && val.trim().length > 0 ? val.trim().toUpperCase() : null
    ),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters.")
    .max(128, "Password must be at most 128 characters."),
});

export const adminCreateInviteSchema = z.object({
  label: z.string().trim().max(80).optional().nullable(),
  maxUses: z.coerce.number().int().min(1).max(500).default(1),
  expiresInDays: z.coerce.number().int().min(1).max(365).optional().nullable(),
});

export const adminCreateTermSchema = z.object({
  name: z.string().trim().min(3, "Term name is required.").max(80),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
  isActive: z.boolean().default(false),
});

export const adminUpdateTermSchema = z.object({
  name: z.string().trim().min(3).max(80).optional(),
  isActive: z.boolean().optional(),
});

export const bulkDeleteStudentsSchema = z.object({
  studentIds: z
    .array(z.string().uuid("Invalid student ID."))
    .min(1, "Select at least one student to delete.")
    .max(200, "You can delete at most 200 students at once."),
});
