import { createHash, randomBytes } from "crypto";
import { hash, verify, type Algorithm } from "@node-rs/argon2";

// Numeric literal 2 corresponds to Algorithm.Argon2id (avoids TS2748 under isolatedModules).
const ARGON2_OPTIONS = {
  algorithm: 2 as Algorithm,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Hashes a plaintext password using Argon2id with a random per-user salt.
 */
export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

/**
 * Verifies a plaintext password against a stored Argon2id hash.
 */
export async function verifyPassword(
  passwordHash: string,
  password: string
): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/**
 * Produces a deterministic SHA-256 hex digest for single-use tokens and invite codes.
 */
export function hashLookupToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Generates a cryptographically secure random hex token.
 */
export function generateRandomToken(byteLength = 32): string {
  return randomBytes(byteLength).toString("hex");
}
