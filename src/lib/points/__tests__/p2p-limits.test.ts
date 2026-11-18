import { describe, expect, it } from "vitest";
import { validateP2pLimits } from "../p2p-limits";

const BASE = {
  allowP2pTransfers: true,
  amount: 10,
  senderAvailableBalance: 50,
  p2pMaxPerTransfer: null,
  p2pMaxPerDay: null,
  p2pMaxPerTerm: null,
  senderSentToday: 0,
  senderSentInTerm: 0,
  receiverReceivedToday: 0,
  receiverReceivedInTerm: 0,
};

describe("P2P Transfer Limit Guardrails", () => {
  it("allows valid transfer within all limits", () => {
    expect(
      validateP2pLimits({
        ...BASE,
        p2pMaxPerTransfer: 20,
        p2pMaxPerDay: 30,
        p2pMaxPerTerm: 100,
        senderSentToday: 15,
        receiverReceivedToday: 10,
      })
    ).toEqual({ ok: true });
  });

  it("blocks when P2P transfers are disabled or balance is zero/negative/insufficient", () => {
    expect(
      validateP2pLimits({ ...BASE, allowP2pTransfers: false }).ok
    ).toBe(false);
    expect(
      validateP2pLimits({ ...BASE, senderAvailableBalance: -5 })
    ).toMatchObject({ ok: false, code: "ERR_INSUFFICIENT_BALANCE" });
    expect(
      validateP2pLimits({ ...BASE, senderAvailableBalance: 5, amount: 10 })
    ).toMatchObject({ ok: false, code: "ERR_INSUFFICIENT_BALANCE" });
  });

  it("enforces per-transfer, daily sender/receiver, and term sender/receiver caps", () => {
    expect(
      validateP2pLimits({ ...BASE, p2pMaxPerTransfer: 5, amount: 10 })
    ).toMatchObject({ ok: false, code: "ERR_P2P_LIMIT_EXCEEDED" });

    expect(
      validateP2pLimits({
        ...BASE,
        p2pMaxPerDay: 25,
        senderSentToday: 20,
        amount: 10,
      })
    ).toMatchObject({ ok: false, code: "ERR_P2P_LIMIT_EXCEEDED" });

    expect(
      validateP2pLimits({
        ...BASE,
        p2pMaxPerDay: 25,
        receiverReceivedToday: 20,
        amount: 10,
      })
    ).toMatchObject({ ok: false, code: "ERR_P2P_LIMIT_EXCEEDED" });

    expect(
      validateP2pLimits({
        ...BASE,
        p2pMaxPerTerm: 50,
        senderSentInTerm: 45,
        amount: 10,
      })
    ).toMatchObject({ ok: false, code: "ERR_P2P_LIMIT_EXCEEDED" });

    expect(
      validateP2pLimits({
        ...BASE,
        p2pMaxPerTerm: 50,
        receiverReceivedInTerm: 45,
        amount: 10,
      })
    ).toMatchObject({ ok: false, code: "ERR_P2P_LIMIT_EXCEEDED" });
  });
});
