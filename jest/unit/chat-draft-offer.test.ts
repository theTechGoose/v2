/**
 * REQ-388 (demo-loop cycle 2, M23, run r561db6d4) — a pricing answer offers
 * the draft; it never writes one.
 *
 * Pair 7 asked "what should i charge to move a shower drain … explain how you
 * got the number, and also cuánto cobro por piso radiante …?" and got a DRAFT
 * QUOTE whose line item was the whole question. Now the server answers with
 * the prices and puts the offer on the answer's payload (`draftOffer`); the
 * chat shows it as a "Draft a quote at $X" button on the newest message,
 * and the button sends those words — which the server reads as the ask.
 *
 *   shared/quote-flow/chat-draft-offer.ts   draftOfferOf, liveDraftOffer,
 *                                           offerAmount
 *   front-end/islands/AsstChat.tsx          the button ([data-cy=msg-draft-offer])
 *
 * Lazy-required so a missing module reds only the tests that use it.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const offer = () => require("../../shared/quote-flow/chat-draft-offer");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

const OFFER = {
  title: "Move a shower drain 18 inches on a slab foundation",
  amountCents: 150_000,
  tier: "Market",
};

const msg = (
  id: string,
  role: string,
  kind: string,
  payload?: Record<string, unknown>,
) => ({ id, role, kind, content: "…", ...(payload ? { payload } : {}) });

describe("REQ-388 M23 draftOfferOf — the offer a pricing answer carries", () => {
  it("REQ-388 reads the title, the amount and the tier", () => {
    expect(offer().draftOfferOf({ draftOffer: OFFER })).toEqual(OFFER);
  });

  it("REQ-388 no offer, a broken one, or no payload → none", () => {
    const { draftOfferOf } = offer();
    for (
      const p of [
        undefined,
        null,
        {},
        { draftOffer: null },
        { draftOffer: { title: "", amountCents: 150_000 } },
        { draftOffer: { title: "Deck", amountCents: 0 } },
        { draftOffer: { title: "Deck", amountCents: "1500" } },
        { draftOffer: { title: "Deck", amountCents: -5 } },
      ]
    ) {
      expect(draftOfferOf(p)).toBeUndefined();
    }
  });
});

describe("REQ-388 M23 liveDraftOffer — the button sits on the newest message, and only while no quote is bound", () => {
  it("REQ-388 the newest message is the pricing answer → its offer", () => {
    const thread = [
      msg("u1", "user", "text"),
      msg("a1", "assistant", "text", { draftOffer: OFFER }),
    ];
    expect(offer().liveDraftOffer(thread, undefined)).toEqual({
      id: "a1",
      offer: OFFER,
    });
  });

  it("REQ-388 anything after it (a new question, the drafted card) retires the button", () => {
    const { liveDraftOffer } = offer();
    expect(
      liveDraftOffer([
        msg("a1", "assistant", "text", { draftOffer: OFFER }),
        msg("u2", "user", "text"),
      ], undefined),
    ).toBeUndefined();
    expect(
      liveDraftOffer([
        msg("a1", "assistant", "text", { draftOffer: OFFER }),
        msg("c1", "assistant", "action_card", { actionType: "quote" }),
      ], undefined),
    ).toBeUndefined();
  });

  it("REQ-388 a conversation with a quote already bound never offers a new draft", () => {
    expect(
      offer().liveDraftOffer([
        msg("a1", "assistant", "text", { draftOffer: OFFER }),
      ], "q-1"),
    ).toBeUndefined();
  });

  it("REQ-388 a user's own message or a plain answer carries no button", () => {
    const { liveDraftOffer } = offer();
    expect(liveDraftOffer([msg("u1", "user", "text")], undefined))
      .toBeUndefined();
    expect(liveDraftOffer([msg("a1", "assistant", "text")], undefined))
      .toBeUndefined();
    expect(liveDraftOffer([], undefined)).toBeUndefined();
  });
});

describe("REQ-388 M23 offerAmount — the button's price", () => {
  it("REQ-388 whole dollars without cents, cents only when there are any", () => {
    const { offerAmount } = offer();
    expect(offerAmount(150_000)).toBe("$1,500");
    expect(offerAmount(310_050)).toBe("$3,100.50");
    expect(offerAmount(85_000)).toBe("$850");
  });
});

describe("REQ-388 M23 the chat renders the offer as a button that sends its own words", () => {
  const island = read("front-end/islands/AsstChat.tsx");

  it("REQ-388 AsstChat reads the live offer and renders [data-cy=msg-draft-offer]", () => {
    expect(island).toMatch(
      /import\s*\{[^}]*\bliveDraftOffer\b[^}]*\}\s*from\s*"\.\.\/\.\.\/shared\/quote-flow\/chat-draft-offer\.ts"/,
    );
    expect(island).toContain('data-cy="msg-draft-offer"');
  });

  it("REQ-388 the button's label is asstChat.draftOffer and a click sends that label as the contractor's message", () => {
    const at = island.indexOf('data-cy="msg-draft-offer"');
    expect(at).toBeGreaterThan(-1);
    const block = island.slice(Math.max(0, at - 1200), at + 600);
    expect(block).toContain('"asstChat.draftOffer"');
    expect(block).toMatch(/sendText\(/);
  });

  it("REQ-388 the button's words exist in en and es, with the amount", () => {
    for (const dict of [en, es]) {
      expect(dict["asstChat.draftOffer"]).toContain("{amount}");
    }
    expect(en["asstChat.draftOffer"]).toBe("Draft a quote at {amount}");
    expect(es["asstChat.draftOffer"]).toBe("Preparar cotización por {amount}");
  });
});
