import { z } from "zod";

export const autoGenerateGroupsSchema = z.object({
  mode: z.enum(["count", "size"]),
  value: z
    .number()
    .int("Value must be a whole integer.")
    .min(1, "Value must be at least 1.")
    .max(200, "Value cannot exceed 200."),
  shuffle: z.boolean().optional().default(true),
  namePrefix: z
    .string()
    .trim()
    .min(1, "Group name prefix cannot be empty.")
    .max(30, "Group name prefix must be 30 characters or fewer.")
    .optional()
    .default("Group"),
});

export const createGroupSetSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Group set name must be at least 2 characters.")
    .max(60, "Group set name must be 60 characters or fewer."),
  autoGenerate: autoGenerateGroupsSchema.optional().nullable(),
});

export const updateGroupSetSchema = z.object({
  name: z
    .string()
    .trim()
    .min(2, "Group set name must be at least 2 characters.")
    .max(60, "Group set name must be 60 characters or fewer."),
});

export const createGroupSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Group name is required.")
    .max(60, "Group name must be 60 characters or fewer."),
});

export const groupPatchSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("rename"),
    groupId: z.string().uuid("Invalid group ID."),
    name: z
      .string()
      .trim()
      .min(1, "Group name is required.")
      .max(60, "Group name must be 60 characters or fewer."),
  }),
  z.object({
    action: z.literal("move_member"),
    enrollmentId: z.string().uuid("Invalid student enrollment ID."),
    targetGroupId: z.string().uuid("Invalid target group ID.").nullable(),
  }),
]);

export const autoAssignGroupsSchema = z
  .object({
    scope: z.enum(["all", "unassigned"]).default("unassigned"),
    mode: z.enum(["existing", "count", "size"]).default("existing"),
    value: z
      .number()
      .int("Value must be a whole integer.")
      .min(1, "Value must be at least 1.")
      .max(200, "Value cannot exceed 200.")
      .optional(),
    shuffle: z.boolean().optional().default(true),
    namePrefix: z
      .string()
      .trim()
      .min(1)
      .max(30)
      .optional()
      .default("Group"),
  })
  .superRefine((val, ctx) => {
    if ((val.mode === "count" || val.mode === "size") && !val.value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: "Provide a positive number for group count or size.",
      });
    }
  });
