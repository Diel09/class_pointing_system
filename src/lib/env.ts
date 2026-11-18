import { z } from "zod";

export const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  DIRECT_URL: z.string().min(1).optional(),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters"),
  DEVICE_PEPPER: z.string().min(32, "DEVICE_PEPPER must be at least 32 characters"),
  P2P_QR_SECRET: z.string().min(32, "P2P_QR_SECRET must be at least 32 characters"),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().optional().default(""),
  VAPID_PRIVATE_KEY: z.string().optional().default(""),
  VAPID_SUBJECT: z.string().optional().default(""),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export interface VapidConfig {
  publicKey: string;
  privateKey: string;
  subject: string;
}

/**
 * Validates an arbitrary environment map against the server schema.
 */
export function parseServerEnv(
  rawEnv: Record<string, string | undefined>
): ServerEnv {
  const parsed = serverEnvSchema.safeParse(rawEnv);
  if (!parsed.success) {
    const formatted = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "env"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid environment configuration: ${formatted}`);
  }
  return parsed.data;
}

/**
 * Validates and returns runtime server environment variables lazily.
 */
export function getServerEnv(): ServerEnv {
  return parseServerEnv(process.env);
}

/**
 * Returns Web Push VAPID configuration when all required keys are populated.
 */
export function getVapidConfig(): VapidConfig | null {
  const publicKey = (process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (process.env.VAPID_PRIVATE_KEY ?? "").trim();
  const subject = (process.env.VAPID_SUBJECT ?? "").trim();
  if (!publicKey || !privateKey || !subject) {
    return null;
  }
  return { publicKey, privateKey, subject };
}
