import { describe, expect, it } from "vitest";
import {
  computeMeritBalanceUpdate,
  formatMeritLedgerNote,
  resolveSignedPointsDelta,
} from "../merit-math";

describe("Phase 3 merit-math helpers", () => {
  it("normalizes preset points delta according to preset type", () => {
    expect(resolveSignedPointsDelta("MERIT", -5)).toBe(5);
    expect(resolveSignedPointsDelta("MERIT", 10)).toBe(10);
    expect(resolveSignedPointsDelta("DEMERIT", 5)).toBe(-5);
    expect(resolveSignedPointsDelta("DEMERIT", -8)).toBe(-8);
    expect(() => resolveSignedPointsDelta("MERIT", 0)).toThrow();
  });

  it("applies merits cleanly regardless of negative balance policy", () => {
    const res = computeMeritBalanceUpdate({
      currentBalance: -3,
      requestedDelta: 10,
      allowNegativeBalance: false,
    });

    expect(res).toEqual({
      previousBalance: -3,
      newBalance: 7,
      requestedDelta: 10,
      actualDelta: 10,
      clamped: false,
      entryType: "MERIT",
    });
  });

  it("clamps demerits at 0 when allowNegativeBalance is false", () => {
    const partial = computeMeritBalanceUpdate({
      currentBalance: 3,
      requestedDelta: -5,
      allowNegativeBalance: false,
    });
    expect(partial).toEqual({
      previousBalance: 3,
      newBalance: 0,
      requestedDelta: -5,
      actualDelta: -3,
      clamped: true,
      entryType: "DEMERIT",
    });

    const alreadyZero = computeMeritBalanceUpdate({
      currentBalance: 0,
      requestedDelta: -5,
      allowNegativeBalance: false,
    });
    expect(alreadyZero).toEqual({
      previousBalance: 0,
      newBalance: 0,
      requestedDelta: -5,
      actualDelta: 0,
      clamped: true,
      entryType: "DEMERIT",
    });
  });

  it("permits negative debt when allowNegativeBalance is true", () => {
    const debt = computeMeritBalanceUpdate({
      currentBalance: 3,
      requestedDelta: -5,
      allowNegativeBalance: true,
    });
    expect(debt).toEqual({
      previousBalance: 3,
      newBalance: -2,
      requestedDelta: -5,
      actualDelta: -5,
      clamped: false,
      entryType: "DEMERIT",
    });
  });

  it("formats ledger notes preserving requested infraction when clamped", () => {
    expect(
      formatMeritLedgerNote({
        presetName: "Disruptive Behavior",
        note: "Talking during quiz",
        requestedDelta: -5,
        actualDelta: -2,
        clamped: true,
      })
    ).toBe(
      "Disruptive Behavior: Talking during quiz (Requested -5 pts; floored at 0, applied -2 pts)"
    );

    expect(
      formatMeritLedgerNote({
        presetName: "Active Recitation",
        note: null,
        requestedDelta: 5,
        actualDelta: 5,
        clamped: false,
      })
    ).toBe("Active Recitation");
  });
});
