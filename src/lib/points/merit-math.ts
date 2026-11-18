export interface MeritBalanceUpdateInput {
  currentBalance: number;
  requestedDelta: number;
  allowNegativeBalance: boolean;
}

export interface MeritBalanceUpdateResult {
  previousBalance: number;
  newBalance: number;
  requestedDelta: number;
  actualDelta: number;
  clamped: boolean;
  entryType: "MERIT" | "DEMERIT";
}

/**
 * Normalizes a point magnitude or signed integer into a signed delta matching the preset type.
 */
export function resolveSignedPointsDelta(
  type: "MERIT" | "DEMERIT",
  rawPoints: number
): number {
  if (!Number.isInteger(rawPoints) || rawPoints === 0) {
    throw new Error("Points delta must be a non-zero integer.");
  }
  const magnitude = Math.abs(rawPoints);
  return type === "MERIT" ? magnitude : -magnitude;
}

/**
 * Computes the resulting available balance for a merit or demerit, clamping demerits at 0 unless
 * negative balances are enabled for the subject.
 */
export function computeMeritBalanceUpdate(
  input: MeritBalanceUpdateInput
): MeritBalanceUpdateResult {
  const { currentBalance, requestedDelta, allowNegativeBalance } = input;
  if (!Number.isInteger(requestedDelta) || requestedDelta === 0) {
    throw new Error("Requested points delta must be a non-zero integer.");
  }

  if (requestedDelta > 0) {
    const newBalance = currentBalance + requestedDelta;
    return {
      previousBalance: currentBalance,
      newBalance,
      requestedDelta,
      actualDelta: requestedDelta,
      clamped: false,
      entryType: "MERIT",
    };
  }

  const rawNextBalance = currentBalance + requestedDelta;
  const newBalance = allowNegativeBalance
    ? rawNextBalance
    : Math.max(0, rawNextBalance);
  const actualDelta = newBalance - currentBalance;

  return {
    previousBalance: currentBalance,
    newBalance,
    requestedDelta,
    actualDelta,
    clamped: actualDelta !== requestedDelta,
    entryType: "DEMERIT",
  };
}

export interface FormatMeritNoteInput {
  presetName?: string | null;
  note?: string | null;
  requestedDelta: number;
  actualDelta: number;
  clamped: boolean;
}

/**
 * Formats an immutable ledger note preserving the full requested infraction when floored at 0.
 */
export function formatMeritLedgerNote(input: FormatMeritNoteInput): string {
  const trimmedPreset = input.presetName?.trim() || "";
  const trimmedNote = input.note?.trim() || "";

  let base = "";
  if (trimmedPreset && trimmedNote) {
    base = `${trimmedPreset}: ${trimmedNote}`;
  } else if (trimmedPreset) {
    base = trimmedPreset;
  } else if (trimmedNote) {
    base = trimmedNote;
  } else {
    base = input.requestedDelta > 0 ? "Merit awarded" : "Demerit applied";
  }

  if (!input.clamped) {
    return base;
  }

  return `${base} (Requested ${input.requestedDelta} pts; floored at 0, applied ${input.actualDelta} pts)`;
}
