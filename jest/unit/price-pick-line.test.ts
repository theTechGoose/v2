/**
 * REQ-688 (demo-loop cycle 5, issue m65) — "Price disappears from the quote
 * checklist".
 *
 * The chat's checklist is the wizard pick log: user `text` messages carrying
 * `payload.wizardStepId`. The price is chosen on the price card BEFORE the
 * terms wizard, so no pick line ever named it. The server now writes a
 * "Price: $1,850.00" line (wizardStepId "price") when the quote enters the
 * terms wizard; this pins the shared helper that builds it and that the line
 * never leaks into the agreement's term rows.
 */
import * as fs from "fs";
import * as path from "path";
import {
  isPricePick,
  PRICE_PICK_STEP_ID,
  pricePickDollars,
  pricePickMessage,
} from "../../shared/quote-flow/price-pick";
import { localizeChatMessage } from "../../shared/quote-flow/chat-i18n";
import { baseTermRows } from "../../shared/quote-flow/wizard-terms";
import { unansweredWizardStep } from "../../shared/quote-flow/step-composer";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const DICTS: Record<string, Record<string, string>> = {
  en: JSON.parse(read("lang/en.json")),
  es: JSON.parse(read("lang/es.json")),
};
const t = (lang: string, key: string, vars?: Record<string, string | number>) =>
  (DICTS[lang]?.[key] ?? DICTS.en[key] ?? key).replace(
    /\{(\w+)\}/g,
    (_m, k) => (vars && k in vars ? String(vars[k]) : `{${k}}`),
  );

describe("REQ-688 price pick line (cycle 5, m65)", () => {
  it("REQ-688 formats cents as the price card shows them", () => {
    expect(pricePickDollars(185_000)).toBe("$1,850.00");
    expect(pricePickDollars(1_234_567)).toBe("$12,345.67");
    expect(pricePickDollars(5)).toBe("$0.05");
  });

  it("REQ-688 the line is a user pick with wizardStepId 'price' that reads 'Price: $1,850.00' / 'Precio: $1,850.00'", () => {
    const m = pricePickMessage(185_000, "en", t);
    expect(m.role).toBe("user");
    expect(m.kind).toBe("text");
    expect(m.content).toBe("Price: $1,850.00");
    expect(m.payload.wizardStepId).toBe(PRICE_PICK_STEP_ID);
    expect(PRICE_PICK_STEP_ID).toBe("price");
    expect(m.payload.priceCents).toBe(185_000);
    expect(isPricePick(m)).toBe(true);
    // Follows the EN/ES switch like every other pick line (REQ-589).
    const es = localizeChatMessage(m, "es", t);
    expect(es.content).toBe("Precio: $1,850.00");
  });

  it("REQ-688 en and es carry the price label", () => {
    expect(DICTS.en["wizardAnswer.pick.priceLabel"]).toBe("Price");
    expect(DICTS.es["wizardAnswer.pick.priceLabel"]).toBe("Precio");
  });

  it("REQ-688 the price line is not an agreement term row (the total is shown on its own)", () => {
    const price = pricePickMessage(185_000, "en", t);
    const start = {
      role: "user",
      kind: "text",
      content: "Start: Next week",
      payload: { wizardStepId: "start_date", optionId: "next_week" },
    };
    const rows = baseTermRows({ messages: [price, start], t });
    expect(rows.map((r) => r.stepId)).toEqual(["start_date"]);
  });

  it("REQ-688 a pick for another step is not the price line", () => {
    expect(
      isPricePick({
        role: "user",
        kind: "text",
        content: "Start: Next week",
        payload: { wizardStepId: "start_date" },
      }),
    ).toBe(false);
    expect(isPricePick({ role: "assistant", kind: "text", content: "x" }))
      .toBe(false);
  });

  it("REQ-688 the price line leaves the first wizard question open", () => {
    const price = pricePickMessage(185_000, "en", t);
    const q = {
      role: "assistant",
      kind: "wizard",
      content: "Who is this for?",
      payload: { stepId: "customer", stepIdx: 0 },
    };
    expect(unansweredWizardStep([price, q])).toEqual({ stepId: "customer" });
  });
});
