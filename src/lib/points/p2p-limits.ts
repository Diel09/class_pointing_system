export interface P2pLimitCheckInput {
  allowP2pTransfers: boolean;
  amount: number;
  senderAvailableBalance: number;
  p2pMaxPerTransfer: number | null;
  p2pMaxPerDay: number | null;
  p2pMaxPerTerm: number | null;
  senderSentToday: number;
  senderSentInTerm: number;
  receiverReceivedToday: number;
  receiverReceivedInTerm: number;
}

export type P2pLimitCheckResult =
  | { ok: true }
  | {
      ok: false;
      code:
        | "ERR_P2P_DISABLED"
        | "ERR_INSUFFICIENT_BALANCE"
        | "ERR_P2P_LIMIT_EXCEEDED";
      message: string;
    };

/**
 * Validates subject P2P toggles, positive spendable balance, and per-transfer / daily / term caps.
 */
export function validateP2pLimits(
  input: P2pLimitCheckInput
): P2pLimitCheckResult {
  if (!input.allowP2pTransfers) {
    return {
      ok: false,
      code: "ERR_P2P_DISABLED",
      message: "Peer-to-peer point transfers are currently disabled for this subject.",
    };
  }

  if (!Number.isInteger(input.amount) || input.amount <= 0) {
    return {
      ok: false,
      code: "ERR_P2P_LIMIT_EXCEEDED",
      message: "Transfer amount must be a positive whole integer.",
    };
  }

  if (input.senderAvailableBalance <= 0) {
    return {
      ok: false,
      code: "ERR_INSUFFICIENT_BALANCE",
      message:
        "You must have a positive available balance before sending points.",
    };
  }

  if (input.senderAvailableBalance < input.amount) {
    return {
      ok: false,
      code: "ERR_INSUFFICIENT_BALANCE",
      message: `Insufficient available points. You currently have ${input.senderAvailableBalance} pts available.`,
    };
  }

  if (
    input.p2pMaxPerTransfer !== null &&
    input.amount > input.p2pMaxPerTransfer
  ) {
    return {
      ok: false,
      code: "ERR_P2P_LIMIT_EXCEEDED",
      message: `Transfer exceeds the per-transfer limit of ${input.p2pMaxPerTransfer} pts.`,
    };
  }

  if (
    input.p2pMaxPerDay !== null &&
    input.senderSentToday + input.amount > input.p2pMaxPerDay
  ) {
    const remaining = Math.max(0, input.p2pMaxPerDay - input.senderSentToday);
    return {
      ok: false,
      code: "ERR_P2P_LIMIT_EXCEEDED",
      message: `Daily sending limit of ${input.p2pMaxPerDay} pts reached (${remaining} pts remaining today).`,
    };
  }

  if (
    input.p2pMaxPerDay !== null &&
    input.receiverReceivedToday + input.amount > input.p2pMaxPerDay
  ) {
    const remaining = Math.max(
      0,
      input.p2pMaxPerDay - input.receiverReceivedToday
    );
    return {
      ok: false,
      code: "ERR_P2P_LIMIT_EXCEEDED",
      message: `Recipient can only receive ${remaining} more pts today under the daily limit of ${input.p2pMaxPerDay} pts.`,
    };
  }

  if (
    input.p2pMaxPerTerm !== null &&
    input.senderSentInTerm + input.amount > input.p2pMaxPerTerm
  ) {
    const remaining = Math.max(
      0,
      input.p2pMaxPerTerm - input.senderSentInTerm
    );
    return {
      ok: false,
      code: "ERR_P2P_LIMIT_EXCEEDED",
      message: `Term sending limit of ${input.p2pMaxPerTerm} pts reached (${remaining} pts remaining this term).`,
    };
  }

  if (
    input.p2pMaxPerTerm !== null &&
    input.receiverReceivedInTerm + input.amount > input.p2pMaxPerTerm
  ) {
    const remaining = Math.max(
      0,
      input.p2pMaxPerTerm - input.receiverReceivedInTerm
    );
    return {
      ok: false,
      code: "ERR_P2P_LIMIT_EXCEEDED",
      message: `Recipient can only receive ${remaining} more pts this term under the term limit of ${input.p2pMaxPerTerm} pts.`,
    };
  }

  return { ok: true };
}
