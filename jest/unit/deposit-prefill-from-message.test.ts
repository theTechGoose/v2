/**
 * REQ-936 — LOOP-007 cycle 1, issue q1-3: "A typed '30% deposit' becomes a
 * 20% deposit marked 'From your message'". The message said "30% deposit up
 * front, rest when done"; the payment step's "From your message" row offered
 * plain "Deposit + balance", and its "Use this" stored the legacy 20% deposit
 * ($4,650 of $23,250 instead of $6,975). REQ-678's own "Not covered
 * (follow-up)" line names this hole.
 *
 * Root cause: extractPaymentTerms returned the bare "deposit_bal" for any
 * "N% / $X … deposit" and threw the figure away, so wizardPrefillFor sent no
 * customValue and termFromPick fell back to the plain label.
 */
import * as fs from "fs";
import * as path from "path";
import {
  extractPaymentTerms,
  extractQuoteFacts,
  wizardPrefillFor,
} from "../../shared/quote-flow/quote-facts";
import { computePaymentSplit } from "../../front-end/lib/payment-split";
import { termFromPick } from "../../shared/quote-flow/wizard-terms";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const t = (
  _lang: "en" | "es",
  key: string,
  vars?: Record<string, string | number>,
) =>
  (en[key] ?? key).replace(
    /\{(\w+)\}/g,
    (_, k) => (vars && k in vars ? String(vars[k]) : `{${k}}`),
  );

const TODAY = new Date(2026, 10, 18);
const SENTENCE =
  "Kitchen remodel for Dana Reyes, $23,250. 30% deposit up front, rest when done.";
const TOTAL_CENTS = 2_325_000;

describe("REQ-936 (LOOP-007 q1-3): a typed deposit amount survives into the wizard's prefill", () => {
  it("REQ-936: extractPaymentTerms keeps the stated share / dollars of a deposit", () => {
    expect(extractPaymentTerms("30% deposit up front, rest when done"))
      .toMatchObject({ kind: "deposit", pct: 30 });
    expect(extractPaymentTerms("deposit of 25%, balance on completion"))
      .toMatchObject({ kind: "deposit", pct: 25 });
    expect(extractPaymentTerms("$2,000 deposit to book the date"))
      .toMatchObject({ kind: "deposit", cents: 200_000 });
    expect(extractPaymentTerms("25% deposit to book")).toMatchObject({
      kind: "deposit",
      pct: 25,
    });
  });

  it("REQ-936 (guard): an out-of-range figure is not an amount — the plain option stays", () => {
    expect(extractPaymentTerms("$0 deposit up front, rest when done")).toBe(
      "deposit_bal",
    );
  });

  it("REQ-936: wizardPrefillFor sends the amount as the deposit term value", () => {
    const facts = extractQuoteFacts(SENTENCE, TODAY);
    expect(wizardPrefillFor("payment_terms", facts, "en")).toMatchObject({
      optionId: "deposit_bal",
      customValue: "Deposit 30% + balance",
    });
    expect(
      wizardPrefillFor(
        "payment_terms",
        extractQuoteFacts("$2,000 deposit, rest at the end", TODAY),
        "en",
      ),
    ).toMatchObject({
      optionId: "deposit_bal",
      customValue: "Deposit $2,000 + balance",
    });
  });

  it("REQ-936: taking the prefill as-is stores and bills 30% ($6,975 of $23,250), not the legacy 20%", () => {
    const prefill = wizardPrefillFor(
      "payment_terms",
      extractQuoteFacts(SENTENCE, TODAY),
      "en",
    );
    expect(prefill).not.toBeNull();
    const term = termFromPick(
      {
        stepId: "payment_terms",
        optionId: prefill!.optionId,
        customValue: prefill!.customValue,
      },
      t,
    );
    expect(term?.value).toBe("Deposit 30% + balance");
    const [dep, bal] = computePaymentSplit(term!.value, TOTAL_CENTS);
    expect([dep.amountCents, bal.amountCents]).toEqual([697_500, 1_627_500]);
  });

  it("REQ-936: the AsstChat 'From your message' row names a deposit customValue through localizeDepositTerm", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    const at = src.indexOf('{tFor(lang, "asstChat.wiz.fromMessage")}');
    expect(at).toBeGreaterThan(-1);
    // the <strong> that names the prefill, up to the weekday-mismatch note
    const row = src.slice(at, src.indexOf("wiz-prefill-weekday", at));
    expect(row).toMatch(/localizeDepositTerm\(/);
  });
});
