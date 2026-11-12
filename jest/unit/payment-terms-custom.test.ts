/**
 * REQ-387 — demo-loop cycle 2, issue M25: "'I know my price' path uses raw
 * message as job details, misreads 3-payment terms".
 *
 * Root cause (RCA M25, deb85b35): extractPaymentTerms
 * (shared/quote-flow/quote-facts.ts) knew only 30/30/40, 50/50, a half
 * deposit, "N% deposit" → deposit_bal and net 15. Priya wrote "30% deposit,
 * 40% at cabinets install, 30% at completion"; the "N% deposit" rule fired,
 * so the wizard offered "De tu mensaje: Depósito + saldo" (a 20/80 bill).
 * And until the end-of-wizard polish runs, the know-my-price path shows her
 * raw message as the job details with no word that it will be tidied up.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let facts: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let split: any;
beforeAll(() => {
  facts = require("../../shared/quote-flow/quote-facts");
  split = require("../../front-end/lib/payment-split");
});

const TODAY = new Date(2026, 10, 12);
const DEMO = "Payment: 30% deposit, 40% at cabinets install, 30% at completion";

describe("REQ-387 (M25) extractPaymentTerms — a stated N-payment schedule", () => {
  test("the demo's 30/40/30 is a custom schedule with its milestone names, not 'Deposit + balance'", () => {
    expect(facts.extractPaymentTerms(DEMO)).toEqual({
      kind: "custom",
      splits: [30, 40, 30],
      milestones: ["deposit", "at cabinets install", "at completion"],
    });
  });

  test("inside a long mixed message (the Okafor job), the schedule is still found", () => {
    const msg =
      "Cocina para Okafor (Daniel Okafor), gabinetes nuevos, cuarzo, $46,500. " +
      "Pago: 30% de depósito, 40% al instalar gabinetes, 30% al terminar.\n" +
      "NOT included: appliances.";
    expect(facts.extractPaymentTerms(msg)).toEqual({
      kind: "custom",
      splits: [30, 40, 30],
      milestones: ["de depósito", "al instalar gabinetes", "al terminar"],
    });
  });

  test("'and' joining the last milestone is not part of its name", () => {
    expect(
      facts.extractPaymentTerms(
        "25% down, 25% at rough-in and 50% when done",
      ),
    ).toEqual({
      kind: "custom",
      splits: [25, 25, 50],
      milestones: ["down", "at rough-in", "when done"],
    });
  });

  test("a stated split that IS a preset maps onto the preset", () => {
    expect(
      facts.extractPaymentTerms(
        "30% deposit, 30% at midpoint, 40% at completion",
      ),
    ).toBe("30_30_40");
    expect(facts.extractPaymentTerms("50% deposit, 50% on completion"))
      .toBe("50_50");
  });

  test("two payments other than 50/50 are custom too (not a 20/80 'Deposit + balance')", () => {
    expect(facts.extractPaymentTerms("25% deposit, 75% on completion"))
      .toEqual({
        kind: "custom",
        splits: [25, 75],
        milestones: ["deposit", "on completion"],
      });
  });

  test("the REQ-265 single-figure rules still hold", () => {
    expect(facts.extractPaymentTerms("25% deposit to book")).toBe(
      "deposit_bal",
    );
    expect(facts.extractPaymentTerms("half deposit")).toBe("50_50");
    expect(facts.extractPaymentTerms("30/30/40 schedule")).toBe("30_30_40");
    expect(facts.extractPaymentTerms("net 15")).toBe("net_15");
    // percentages that do not add up to 100 are not a schedule
    expect(facts.extractPaymentTerms("10% off labor, 30% deposit"))
      .toBe("deposit_bal");
    // percentages with no payment word are not a schedule
    expect(facts.extractPaymentTerms("50% walls, 50% ceilings")).toBeNull();
  });
});

describe("REQ-387 (M25) wizardPrefillFor — the Custom option carries the schedule", () => {
  test("payment_terms pre-selects Custom with the named schedule and its splits", () => {
    const f = facts.extractQuoteFacts(DEMO, TODAY);
    expect(facts.wizardPrefillFor("payment_terms", f, "es")).toEqual({
      optionId: "custom",
      customValue: "30% deposit / 40% at cabinets install / 30% at completion",
      splits: [30, 40, 30],
    });
  });

  test("an unnamed milestone falls back to the plain split label", () => {
    const f = facts.extractQuoteFacts(
      "deposit is 30%, 40% at cabinets, 30% at completion",
      TODAY,
    );
    expect(facts.wizardPrefillFor("payment_terms", f)).toEqual({
      optionId: "custom",
      // REQ-665 (cycle 5, m47): the split label carries its units — never a
      // bare "30 / 40 / 30" on the agreement.
      customValue: "30% / 40% / 30%",
      splits: [30, 40, 30],
    });
  });

  test("the submitted custom value bills 30 / 40 / 30 through the one payment split", () => {
    const f = facts.extractQuoteFacts(DEMO, TODAY);
    const p = facts.wizardPrefillFor("payment_terms", f);
    const parts = split.computePaymentSplit(p.customValue, 4_650_000);
    expect(parts.map((x: { pct: number }) => x.pct)).toEqual([30, 40, 30]);
    expect(parts.map((x: { amountCents: number }) => x.amountCents)).toEqual([
      1_395_000,
      1_860_000,
      1_395_000,
    ]);
  });
});

describe("REQ-387 (M25) the wizard and the know-my-price details card", () => {
  const src = read("front-end/islands/AsstChat.tsx");

  test("the Custom payment form opens on the schedule the message stated", () => {
    expect(src).toMatch(/initialSplits=\{/);
    expect(src).toMatch(/initialSplits\?: number\[\]/);
  });

  test("the raw JOB DETAILS recap on the know-my-price path says it will be tidied up (en + es)", () => {
    expect(en["asstChat.price.tidyNote"]).toBe(
      "We'll tidy this up before you send.",
    );
    expect(es["asstChat.price.tidyNote"]).toBe(
      "Lo dejaremos en limpio antes de enviarlo.",
    );
    const recap = src.slice(src.indexOf('chat__price-details-recap"'));
    expect(recap.slice(0, 1200)).toMatch(/asstChat\.price\.tidyNote/);
    expect(recap.slice(0, 1200)).toMatch(/!suggestPricing/);
  });
});
