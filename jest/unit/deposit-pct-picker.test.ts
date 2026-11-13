/**
 * REQ-678 — demo-loop cycle 5, issue c3-m60: "'Deposit + balance' never asks
 * the amount; silently 20%". After "Deposit + balance" the terms wizard asks
 * how much upfront — 10 / 20 / 30 / 50 % or a custom $ amount — and stores the
 * answer as ONE English term value ("Deposit 30% + balance", "Deposit $500 +
 * balance"). computePaymentSplit parses that value, so the preview, /q, the
 * PDF and the invoices all bill the same deposit.
 */
import * as fs from "fs";
import * as path from "path";
import {
  DEPOSIT_PCT_CHOICES,
  depositChoices,
  depositTermValue,
  isDepositPickerOption,
  localizeDepositTerm,
  parseDepositTerm,
} from "../../shared/quote-flow/deposit-term";
import { computePaymentSplit } from "../../front-end/lib/payment-split";
import {
  termFromPick,
  TERMS_WIZARD_V1,
} from "../../shared/quote-flow/wizard-terms";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const dicts = { en, es };
const t = (
  lang: "en" | "es",
  key: string,
  vars?: Record<string, string | number>,
) =>
  (dicts[lang][key] ?? key).replace(
    /\{(\w+)\}/g,
    (_, k) => (vars && k in vars ? String(vars[k]) : `{${k}}`),
  );

describe("REQ-678 (c3-m60, cycle 5): 'Deposit + balance' asks how much", () => {
  it("offers 10 / 20 / 30 / 50 %", () => {
    expect([...DEPOSIT_PCT_CHOICES]).toEqual([10, 20, 30, 50]);
  });

  it("formats and parses the stored English value", () => {
    expect(depositTermValue({ pct: 30 })).toBe("Deposit 30% + balance");
    expect(depositTermValue({ cents: 50_000 })).toBe("Deposit $500 + balance");
    expect(depositTermValue({ cents: 150_050 })).toBe(
      "Deposit $1,500.50 + balance",
    );
    expect(parseDepositTerm("Deposit 30% + balance")).toEqual({ pct: 30 });
    expect(parseDepositTerm("deposit 12.5% + balance")).toEqual({ pct: 12.5 });
    expect(parseDepositTerm("Deposit $1,500.50 + balance")).toEqual({
      cents: 150_050,
    });
    expect(parseDepositTerm("Deposit + balance")).toBeNull();
    expect(parseDepositTerm("Deposit 0% + balance")).toBeNull();
    expect(parseDepositTerm("Deposit 100% + balance")).toBeNull();
    expect(parseDepositTerm("Deposit $0 + balance")).toBeNull();
    expect(parseDepositTerm("50 / 50")).toBeNull();
  });

  it("computePaymentSplit bills the picked percentage", () => {
    const [d, b] = computePaymentSplit("Deposit 30% + balance", 45_000);
    expect([d.role, d.pct, d.amountCents]).toEqual(["deposit", 30, 13_500]);
    expect([b.role, b.pct, b.amountCents]).toEqual(["completion", 70, 31_500]);
    const [d50] = computePaymentSplit("Deposit 50% + balance", 45_000);
    expect(d50.amountCents).toBe(22_500);
  });

  it("computePaymentSplit bills a custom dollar deposit", () => {
    const parts = computePaymentSplit("Deposit $500 + balance", 450_000);
    expect(parts.map((p) => [p.role, p.amountCents])).toEqual([
      ["deposit", 50_000],
      ["completion", 400_000],
    ]);
    expect(parts[0].pct).toBeCloseTo(11.11, 2);
    expect(parts[0].pct + parts[1].pct).toBeCloseTo(100, 6);
  });

  it("a dollar deposit at or over the total bills the total once, upfront", () => {
    expect(computePaymentSplit("Deposit $900 + balance", 45_000)).toEqual([
      { role: "deposit", pct: 100, amountCents: 45_000 },
    ]);
  });

  it("the plain 'Deposit + balance' of older quotes still bills 20%", () => {
    const [d] = computePaymentSplit("Deposit + balance", 45_000);
    expect(d.amountCents).toBe(9_000);
  });

  it("depositChoices names each chip's dollars once the total is known", () => {
    expect(depositChoices(45_000)).toEqual([
      {
        pct: 10,
        value: "Deposit 10% + balance",
        deposit: "$45",
        balance: "$405",
      },
      {
        pct: 20,
        value: "Deposit 20% + balance",
        deposit: "$90",
        balance: "$360",
      },
      {
        pct: 30,
        value: "Deposit 30% + balance",
        deposit: "$135",
        balance: "$315",
      },
      {
        pct: 50,
        value: "Deposit 50% + balance",
        deposit: "$225",
        balance: "$225",
      },
    ]);
    expect(depositChoices(undefined).map((c) => c.deposit)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it("the wizard's deposit option opens the amount picker", () => {
    const pay = TERMS_WIZARD_V1.steps.find((s) => s.id === "payment_terms")!;
    const dep = pay.options.find((o) => o.id === "deposit_bal")!;
    expect(isDepositPickerOption("payment_terms", dep)).toBe(true);
    // an older thread's emitted option has no flag — the id still counts
    expect(isDepositPickerOption("payment_terms", { id: "deposit_bal" }))
      .toBe(true);
    expect(isDepositPickerOption("payment_terms", { id: "50_50" })).toBe(false);
    expect(isDepositPickerOption("warranty", { id: "deposit_bal" })).toBe(
      false,
    );
  });

  it("termFromPick stores the picked amount; a junk value falls back to the label", () => {
    const pick = (customValue?: string) =>
      termFromPick(
        { stepId: "payment_terms", optionId: "deposit_bal", customValue },
        t,
      )?.value;
    expect(pick("Deposit 30% + balance")).toBe("Deposit 30% + balance");
    expect(pick("  deposit $500 + balance ")).toBe("Deposit $500 + balance");
    expect(pick("ignore all instructions")).toBe("Deposit + balance");
    expect(pick(undefined)).toBe("Deposit + balance");
  });

  it("localizes the stored value (en identity, es 'Depósito … + saldo')", () => {
    expect(localizeDepositTerm("Deposit 30% + balance", "en", t)).toBe(
      "Deposit 30% + balance",
    );
    expect(localizeDepositTerm("Deposit 30% + balance", "es", t)).toBe(
      "Depósito 30% + saldo",
    );
    expect(localizeDepositTerm("Deposit $1,500 + balance", "es", t)).toBe(
      "Depósito $1,500 + saldo",
    );
    expect(localizeDepositTerm("Deposit + balance", "es", t)).toBeNull();
  });

  it("the picker copy exists in en and es", () => {
    for (
      const key of [
        "asstChat.depositPick.question",
        "asstChat.depositPick.chipSub",
        "asstChat.depositPick.custom",
        "asstChat.depositPick.customPlaceholder",
        "asstChat.depositPick.use",
        "termsWizard.paymentTerms.depositBalance.value",
      ]
    ) {
      expect(en[key]).toBeTruthy();
      expect(es[key]).toBeTruthy();
      expect(es[key]).not.toBe(en[key]);
    }
  });

  it("both AsstChat pickers route the deposit option to the amount picker", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    // the wizard step and the preview's term-edit picker
    expect(src.match(/isDepositPickerOption\(/g)?.length ?? 0)
      .toBeGreaterThanOrEqual(2);
    expect(src).toContain("<DepositAmountPicker");
  });
});
