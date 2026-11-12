/**
 * REQ-491 — demo-loop cycle 3, issue m60: "'Deposit + balance' never asks the
 * amount; silently 20%". The wizard option's sub-line has to name the split
 * computePaymentSplit actually bills — "20% upfront, rest when done", plus
 * "· $90 / $360" when the total is known — from ONE constant, in en + es.
 */
import * as fs from "fs";
import * as path from "path";
import {
  computePaymentSplit,
  DEPOSIT_BALANCE_PCT,
  depositBalanceSubVars,
} from "../../front-end/lib/payment-split";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-491 (m60, cycle 3): 'Deposit + balance' says how much", () => {
  it("one constant drives the split", () => {
    expect(DEPOSIT_BALANCE_PCT).toBe(20);
    const [d, b] = computePaymentSplit("Deposit + balance", 45_000);
    expect(d.pct).toBe(DEPOSIT_BALANCE_PCT);
    expect(b.pct).toBe(100 - DEPOSIT_BALANCE_PCT);
  });

  it("depositBalanceSubVars: pct always, whole-dollar amounts only with a total", () => {
    expect(depositBalanceSubVars(45_000)).toEqual({
      pct: 20,
      deposit: "$90",
      balance: "$360",
    });
    expect(depositBalanceSubVars(1_250_000)).toEqual({
      pct: 20,
      deposit: "$2,500",
      balance: "$10,000",
    });
    expect(depositBalanceSubVars(undefined)).toEqual({ pct: 20 });
    expect(depositBalanceSubVars(0)).toEqual({ pct: 20 });
  });

  it("en + es sub-lines name the percentage; the amounts variants name both dollars", () => {
    const pairs = [
      [
        "termsWizard.paymentTerms.depositBalance.sub",
        "termsWizard.paymentTerms.depositBalance.subAmounts",
      ],
      [
        "asstChat.terms.payment.depositBalanceSub",
        "asstChat.terms.payment.depositBalanceSubAmounts",
      ],
    ];
    for (const d of [en, es]) {
      for (const [sub, withAmounts] of pairs) {
        expect(d[sub]).toMatch(/\{pct\}%/);
        expect(d[withAmounts]).toMatch(/\{pct\}%.*\{deposit\} \/ \{balance\}/);
      }
      expect(JSON.stringify(d)).not.toMatch(
        /Small upfront|Poco por adelantado/,
      );
    }
  });

  it("the assistant's fallback picker fills the deposit vars from the card's total", () => {
    const chat = read("front-end/islands/AsstChat.tsx");
    expect(chat).toMatch(
      /depositBalanceSubVars\(\s*totalCentsForBreakdown,?\s*\)/,
    );
    expect(chat).toMatch(/asstChat\.terms\.payment\.depositBalanceSubAmounts/);
  });
});
