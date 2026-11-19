/**
 * REQ-1091 — LOOP-007 cycle 3, issue q3-7 [minor/BUG_CONTRADICTION]: "Chat
 * payment step rounds deposit/balance to whole dollars while the preview and
 * agreement show cents". computePaymentSplit is exact to the cent, but the
 * "When do you want to get paid?" sub-line (depositBalanceSubVars) and the
 * "How big a deposit?" chips (depositChoices) printed it through a local
 * `Math.round(c / 100)`. REQ-961: whole dollars only when the amount is whole.
 */
import {
  computePaymentSplit,
  depositBalanceSubVars,
} from "../../front-end/lib/payment-split";
import { depositChoices } from "../../shared/quote-flow/deposit-term";

const chip = (totalCents: number, pct: number) =>
  depositChoices(totalCents).find((c) => c.pct === pct)!;

describe("REQ-1091 (LOOP-007 q3, q3-7): the chat payment step keeps the cents (REQ-961)", () => {
  it("REQ-1091 depositChoices(425050): the 50% chip reads $2,125.25 / $2,125.25 — the halves add up to $4,250.50", () => {
    const c = chip(425_050, 50);
    expect({ deposit: c.deposit, balance: c.balance }).toEqual({
      deposit: "$2,125.25",
      balance: "$2,125.25",
    });
  });

  it("REQ-1091 depositChoices(425050): the 20% chip reads $850.10 / $3,400.40", () => {
    const c = chip(425_050, 20);
    expect({ deposit: c.deposit, balance: c.balance }).toEqual({
      deposit: "$850.10",
      balance: "$3,400.40",
    });
  });

  it("REQ-1091 depositChoices(45000): whole amounts stay compact ($90 / $360)", () => {
    const c = chip(45_000, 20);
    expect({ deposit: c.deposit, balance: c.balance }).toEqual({
      deposit: "$90",
      balance: "$360",
    });
  });

  it("REQ-1091 depositBalanceSubVars(645050, 30%): $1,935.15 / $4,515.35 — the exact split computePaymentSplit bills", () => {
    const [d, b] = computePaymentSplit("Deposit 30% + balance", 645_050);
    expect([d.amountCents, b.amountCents]).toEqual([193_515, 451_535]);
    expect(depositBalanceSubVars(645_050, "Deposit 30% + balance")).toEqual({
      pct: 30,
      deposit: "$1,935.15",
      balance: "$4,515.35",
    });
  });

  it("REQ-1091 depositBalanceSubVars(512550): the default 20% reads $1,025.10 / $4,100.40", () => {
    expect(depositBalanceSubVars(512_550)).toEqual({
      pct: 20,
      deposit: "$1,025.10",
      balance: "$4,100.40",
    });
  });

  it("REQ-1091 depositBalanceSubVars(45000): whole amounts stay compact ($90 / $360)", () => {
    expect(depositBalanceSubVars(45_000)).toEqual({
      pct: 20,
      deposit: "$90",
      balance: "$360",
    });
  });
});
