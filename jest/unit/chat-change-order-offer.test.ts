/**
 * REQ-664 (demo-loop cycle 5, m43, run r37f88707) — a signed quote's line
 * edit offers the change order instead of only refusing.
 *
 * Pair 5 asked the assistant to make Dana's signed Q-001 cabinets cheaper and
 * got "Q-001 Kitchen Remodel is signed, so its lines can't change. Add or
 * credit the difference with a change order instead." with only "Open Q-001"
 * — she had to re-type the whole request as a change order. Now the locked
 * reply carries the difference as `quoteRevision.changeOrderOffer`; the chat
 * shows it as a one-tap "Make change order −$1,000 for Cabinets" button on
 * the newest message, and the button sends those words, which the server
 * reads as the yes and makes that change order.
 *
 *   shared/quote-flow/chat-change-order-offer.ts  changeOrderOfferOf,
 *                     liveChangeOrderOffer, signedOfferAmount,
 *                     acceptsChangeOrderOffer
 *   front-end/islands/AsstChat.tsx   the button ([data-cy=msg-co-offer])
 *
 * Lazy-required so a missing module reds only the tests that use it.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const mod = () => require("../../shared/quote-flow/chat-change-order-offer");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

const OFFER = {
  quoteId: "q-1",
  quoteNumber: "Q-001",
  deltaCents: -100_000,
  description: "Cabinets: $3,500.00 → $2,500.00",
  label: "Cabinets",
};
const locked = (offer: unknown = OFFER) => ({
  quoteRevision: { kind: "locked", quoteId: "q-1", quoteNumber: "Q-001", changeOrderOffer: offer },
});
const fill = (s: string, v: Record<string, string>) =>
  s.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? `{${k}}`);

describe("REQ-664 m43: the locked reply's change-order offer", () => {
  it("REQ-664 changeOrderOfferOf reads the offer off a locked revise reply", () => {
    expect(mod().changeOrderOfferOf(locked())).toEqual(OFFER);
  });

  it("REQ-664 changeOrderOfferOf ignores a zero / missing delta, a missing quote or description, and any non-locked reply", () => {
    const { changeOrderOfferOf } = mod();
    expect(changeOrderOfferOf(locked({ ...OFFER, deltaCents: 0 }))).toBeUndefined();
    expect(changeOrderOfferOf(locked({ ...OFFER, deltaCents: "x" }))).toBeUndefined();
    expect(changeOrderOfferOf(locked({ ...OFFER, quoteId: "" }))).toBeUndefined();
    expect(changeOrderOfferOf(locked({ ...OFFER, description: " " }))).toBeUndefined();
    expect(changeOrderOfferOf({ quoteRevision: { kind: "draft_updated", changeOrderOffer: OFFER } })).toBeUndefined();
    expect(changeOrderOfferOf(undefined)).toBeUndefined();
  });

  it("REQ-664 liveChangeOrderOffer: only the NEWEST message, when it is the assistant's locked reply", () => {
    const { liveChangeOrderOffer } = mod();
    const reply = { id: "a1", role: "assistant", kind: "text", payload: locked() };
    expect(liveChangeOrderOffer([reply])).toEqual({ id: "a1", offer: OFFER });
    expect(liveChangeOrderOffer([reply, { id: "u2", role: "user", kind: "text" }])).toBeUndefined();
    expect(liveChangeOrderOffer([{ ...reply, role: "user" }])).toBeUndefined();
    expect(liveChangeOrderOffer([])).toBeUndefined();
  });

  it("REQ-664 signedOfferAmount: a credit reads −$1,000, an addition +$1,250.50", () => {
    const { signedOfferAmount } = mod();
    expect(signedOfferAmount(-100_000)).toBe("−$1,000");
    expect(signedOfferAmount(125_050)).toBe("+$1,250.50");
  });

  it("REQ-664 acceptsChangeOrderOffer: the button's words (any case / dash / spacing) and a plain yes take it; anything else does not", () => {
    const { acceptsChangeOrderOffer } = mod();
    const labels = ["Make change order −$1,000 for Cabinets", "Hacer orden de cambio −$1,000 por Cabinets"];
    expect(acceptsChangeOrderOffer("Make change order −$1,000 for Cabinets", labels)).toBe(true);
    expect(acceptsChangeOrderOffer("  make change order -$1,000 for cabinets. ", labels)).toBe(true);
    expect(acceptsChangeOrderOffer("Hacer orden de cambio −$1,000 por Cabinets", labels)).toBe(true);
    for (const yes of ["yes", "Yes please", "do it", "sí", "si, hazlo", "ok"]) {
      expect(acceptsChangeOrderOffer(yes, labels)).toBe(true);
    }
    for (const no of ["no", "make it $800 instead", "what is the total?", ""]) {
      expect(acceptsChangeOrderOffer(no, labels)).toBe(false);
    }
  });

  it("REQ-664 the button label and the reply's offer line exist in en and es with the same placeholders", () => {
    for (const key of ["asstChat.changeOrderOffer", "chatCoordinator.reviseQuote.lockedOffer", "chatCoordinator.reviseQuote.coLine", "chatCoordinator.reviseQuote.coRemoved"]) {
      expect(typeof en[key]).toBe("string");
      expect(typeof es[key]).toBe("string");
      const vars = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();
      expect(vars(es[key])).toEqual(vars(en[key]));
    }
    expect(fill(en["asstChat.changeOrderOffer"], { amount: "−$1,000", what: "Cabinets" }))
      .toBe("Make change order −$1,000 for Cabinets");
  });

  it("REQ-664 AsstChat draws the offer as a button that sends its own words", () => {
    const src = read("front-end/islands/AsstChat.tsx");
    expect(src).toMatch(/liveChangeOrderOffer\(/);
    expect(src).toMatch(/data-cy="msg-co-offer"/);
    expect(src).toMatch(/"asstChat\.changeOrderOffer"/);
  });
});
