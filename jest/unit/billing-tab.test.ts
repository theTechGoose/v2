/**
 * REQ-127 — Raphael, 2026-11-02: "rework the pan ui so that its SUPER clean what plan the user
 * is on. right now its pretty confusing. how about just a billing tab rather than a slot on the
 * page."
 *
 * /settings is two tabs — Account and Billing — and Billing says the plan plainly: the name and
 * price large, one status pill, the facts (next bill, card, since), then the other plans as cards
 * each with ONE line saying what picking it does, from the one switch rule.
 */
import * as fs from "fs";
import * as path from "path";
import { pageAfterPick, settingsTabOf } from "../../front-end/lib/plan-return";

const root = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const dict = (lang: string) => JSON.parse(read(`lang/${lang}.json`)) as Record<string, string>;

const BILLING_KEYS = [
  "settings.tabAccount",
  "settings.tabBilling",
  "billing.yourPlan",
  "billing.perMonth",
  "billing.freePrice",
  "billing.pill.active",
  "billing.pill.pending",
  "billing.pill.pastDue",
  "billing.pill.free",
  "billing.pill.preparing",
  "billing.pill.paidOnce",
  "billing.nextBill",
  "billing.cardOnFile",
  "billing.since",
  "billing.changePlan",
  "billing.note.upgrade",
  "billing.note.downgrade",
  "billing.note.free",
  "billing.note.first",
];

describe("REQ-127 the Billing tab", () => {
  test("REQ-127 /settings is two tabs, Account and Billing, and the Billing tab is the plan", () => {
    const settings = read("front-end/islands/SettingsPage.tsx");
    expect(settings).toMatch(/data-cy="settings-tab-account"/);
    expect(settings).toMatch(/data-cy="settings-tab-billing"/);
    expect(settings).toMatch(/settingsTabOf\(/);
    expect(settings).toMatch(/function BillingTab\(/);
    expect(settings).not.toMatch(/function PlanCard\(/);
  });

  test("REQ-127 the Billing tab draws the name and price, one pill, the facts, and a note per card from the one switch rule", () => {
    const settings = read("front-end/islands/SettingsPage.tsx");
    expect(settings).toMatch(/import \{[^}]*\bswitchQuote\b[^}]*\} from "\.\.\/\.\.\/shared\/quote-flow\/plan-switch\.ts"/);
    expect(settings).toMatch(/data-cy="plan-current"/);
    expect(settings).toMatch(/data-cy="plan-price"/);
    expect(settings).toMatch(/data-cy="plan-pill"/);
    expect(settings).toMatch(/data-cy="plan-next-bill"/);
    expect(settings).toMatch(/data-cy="plan-card-on-file"/);
    expect(settings).toMatch(/data-cy="plan-since"/);
    for (const k of ["billing.note.upgrade", "billing.note.downgrade", "billing.note.free", "billing.note.first"]) {
      expect(settings).toContain(`"${k}"`);
    }
    const cards = read("front-end/components/PlanCards.tsx");
    expect(cards).toMatch(/note\?: \(plan: PricingPlan\) => string \| null/);
    expect(cards).toMatch(/class="plan-card__note"/);
    expect(cards).toMatch(/data-cy=\{`plan-note-\$\{p\.id\}`\}/);
  });

  test("REQ-127 every Billing key is in both dictionaries, and the notes carry their amounts", () => {
    const en = dict("en");
    const es = dict("es");
    for (const k of BILLING_KEYS) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
    }
    for (const lang of [en, es]) {
      expect(lang["billing.note.upgrade"]).toMatch(/\{due\}/);
      expect(lang["billing.note.upgrade"]).toMatch(/\{monthly\}/);
      expect(lang["billing.note.downgrade"]).toMatch(/\{monthly\}/);
      expect(lang["billing.note.downgrade"]).toMatch(/\{date\}/);
      expect(lang["billing.note.first"]).toMatch(/\{monthly\}/);
      expect(lang["billing.perMonth"]).toMatch(/\{price\}/);
    }
    expect(en["billing.note.upgrade"]).toBe("Upgrade · {due} today, then {monthly}/month");
    expect(en["billing.note.downgrade"]).toBe("Downgrade · nothing today · {monthly}/month from {date}");
    expect(en["billing.note.free"]).toBe("Back to free · billing stops today · no refund");
  });

  test("REQ-127 a pick and a receipt come back to the Billing tab, and a pick's error shows there", () => {
    expect(pageAfterPick("/settings")).toBe("/settings?tab=billing");
    expect(pageAfterPick("/welcome")).toBe("/welcome?after=plan");
    expect(settingsTabOf("?tab=billing")).toBe("billing");
    expect(settingsTabOf("?plan=merchant-unknown")).toBe("billing");
    expect(settingsTabOf("?px=sub:abc")).toBe("billing");
    expect(settingsTabOf("")).toBe("account");
    expect(settingsTabOf("?tab=account")).toBe("account");
  });

  test("REQ-127 the stylesheet carries the tabs, the pill and the card note", () => {
    const css = read("front-end/static/plan-cards.css");
    expect(css).toMatch(/\.settings-tabs\s*\{/);
    expect(css).toMatch(/\.settings-tab--on\s*\{/);
    expect(css).toMatch(/\.billing__pill\s*\{/);
    expect(css).toMatch(/\.billing__pill--past_due\s*\{/);
    expect(css).toMatch(/\.plan-card__note\s*\{/);
  });
});
