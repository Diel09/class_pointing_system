import { z } from "zod";

export const pushSubscribeSchema = z.object({
  endpoint: z.string().url("Valid push subscription endpoint is required."),
  keys: z.object({
    p256dh: z.string().min(1, "p256dh key is required."),
    auth: z.string().min(1, "auth key is required."),
  }),
});

export const pushUnsubscribeSchema = z.object({
  endpoint: z.string().url("Valid push subscription endpoint is required."),
});

export const markNotificationsReadSchema = z
  .object({
    all: z.boolean().optional(),
    notificationIds: z.array(z.string().uuid()).min(1).max(100).optional(),
  })
  .refine((value) => value.all === true || Boolean(value.notificationIds?.length), {
    message: "Provide either all: true or at least one notification ID.",
  });
