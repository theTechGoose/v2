/**
 * Assistant contracts — pure/dictionary RED tests for the first-2-hours audit.
 *
 * One quoted problem line per P-id covered here:
 *
 *   P-10 "No timeout on the LLM chat turn." — backend/.../openai/mod.ts:80-101
 *        calls chat.completions.create() with SDK defaults (600s × 2) and no
 *        AbortSignal. Desired: a chat turn is bounded (~30s) and surfaces a
 *        retryable error. Proposed pure helper: shared/quote-flow/chat-timeout.ts.
 *
 *   P-20 "All four starter chips return the identical canned reply — including
 *        'Trabajo terminado, necesito facturar', which is answered with quote
 *        copy." Desired: each chip routes to a distinct, intent-appropriate
 *        reply; the invoice chip's reply is about invoicing (factura), not a
 *        cotización. Proposed pure helper: shared/quote-flow/starter-chips.ts.
 *        (Chip keys ground out of lang dicts: asstChat.prompt.{knownPrice,
 *        helpPrice,quickQuote,invoiceDone}. Frontend wiring: AsstChat.tsx:4296-
 *        4325 — knownPrice→startKnownPriceFlow, helpPrice→startHelpMePriceFlow,
 *        quickQuote→startKnownPriceFlow (dup!), invoiceDone→startInvoiceFlow.)
 *
 *   P-25 "Manual terms controls write English into Spanish contracts." — the
 *        duration/warranty/payment fallbacks build EN strings and submit them
 *        verbatim: "Lifetime", "3 weeks", "Net 30" (AsstChat.tsx:7705, 8075-
 *        8081, 8479-8483). Desired: the SUBMITTED term strings are localized.
 *        Proposed pure helper: shared/quote-flow/terms-i18n.ts. ES values ground
 *        out of lang/es.json (asstChat.warranty.lifetime "De por vida";
 *        duration units semana/día/mes; settings.contractDefaults.net "Neto {n}").
 *
 *   P-21 "Terminology whiplash at the send moment." — quoteDoc.docTag is
 *        "Quote & Agreement" while every surface brands "Quote + Agreement"
 *        (the deck's PLUS rule); ES drafting header "Redactando contrato" +
 *        confirmation "Contrato enviado para firma" fight the "Cotización +
 *        Acuerdo" the user built. Dict-half of P-21 lives here.
 *
 *   P-53 "Desktop-keyboard hint on the mobile amount picker" — "Shift = $100".
 *        Dict-half: see the note on the (skipped) test below — the dict is
 *        already correct, so P-53's red is component-wiring + e2e only.
 *
 * ----------------------------------------------------------------------------
 * EXPECTED EXPORT CONTRACTS for the green agent (new modules under
 * shared/quote-flow/ — missing today, so these tests RED with "Cannot find
 * module" until the green phase creates them):
 *
 *   chat-timeout.ts
 *     export class TimeoutError extends Error { name = "TimeoutError" }
 *     export function withChatTimeout<T>(p: Promise<T>, ms?: number): Promise<T>
 *       - resolves with p's value when p settles before ms
 *       - rejects with a TimeoutError when ms elapses first
 *       - ms defaults to 30_000
 *     Wiring target: OpenAILLMClient.respond passes an AbortSignal /
 *     withChatTimeout(...) around chat.completions.create (openai/mod.ts:80-101).
 *
 *   starter-chips.ts
 *     export type ChipKey = "knownPrice" | "helpPrice" | "quickQuote" | "invoiceDone"
 *     export function chipIntent(key: ChipKey): string   // distinct per chip
 *     export function chipReply(key: ChipKey, lang: "en" | "es"): string
 *       - the four replies are pairwise distinct
 *       - chipReply("invoiceDone","es") is about invoicing: /factur/i, NOT /cotiz/i
 *
 *   terms-i18n.ts
 *     export type Term =
 *       | { kind: "duration"; value: { n: number; unit: "days"|"weeks"|"months" } }
 *       | { kind: "warranty"; value: "lifetime" | "none" | { n: number; unit: string } }
 *       | { kind: "payment";  value: { net: number } | { splits: number[] } }
 *     export function termLabel(term: Term, lang: "en" | "es"): string
 *       - localizes the SUBMITTED preview string (line 7705/8076/8480 today).
 */

// Dictionaries exist today — required directly (drives the P-21 dict red).
// deno-lint-ignore-file no-explicit-any
const en: Record<string, string> = require("../../lang/en.json");
const es: Record<string, string> = require("../../lang/es.json");

// ---------------------------------------------------------------------------
// P-10 — bounded chat turn (shared/quote-flow/chat-timeout.ts)
// ---------------------------------------------------------------------------
describe("P-10 withChatTimeout — bounded LLM chat turn", () => {
  let mod: any;
  beforeAll(() => {
    // RED today: module does not exist → "Cannot find module".
    mod = require("../../shared/quote-flow/chat-timeout");
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("P-10 resolves with the value when the promise settles before the deadline", async () => {
    await expect(mod.withChatTimeout(Promise.resolve("ok"), 30_000)).resolves
      .toBe(
        "ok",
      );
  });

  it("P-10 rejects with a typed TimeoutError once the deadline elapses", async () => {
    jest.useFakeTimers();
    const never = new Promise<never>(() => {}); // never settles → a hung OpenAI call
    const p = mod.withChatTimeout(never, 30_000);
    const settled = p.then(
      () => ({ ok: true as const }),
      (e: unknown) => ({ ok: false as const, err: e }),
    );
    await jest.advanceTimersByTimeAsync(30_000);
    const r = await settled;
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.err).toBeInstanceOf(mod.TimeoutError);
      expect((r.err as Error).name).toBe("TimeoutError");
    }
  });

  it("P-10 defaults the deadline to 30_000ms when no ms is passed", async () => {
    jest.useFakeTimers();
    const never = new Promise<never>(() => {});
    const p = mod.withChatTimeout(never);
    const settled = p.then(
      () => "resolved",
      () => "rejected",
    );
    // Just short of 30s it is still pending; at 30s it rejects.
    await jest.advanceTimersByTimeAsync(29_999);
    await Promise.resolve();
    await jest.advanceTimersByTimeAsync(1);
    await expect(settled).resolves.toBe("rejected");
  });
});

// ---------------------------------------------------------------------------
// P-20 — distinct, intent-appropriate starter-chip routing
// ---------------------------------------------------------------------------
describe("P-20 starter chips route to distinct, intent-appropriate replies", () => {
  let chips: any;
  const KEYS = [
    "knownPrice",
    "helpPrice",
    "quickQuote",
    "invoiceDone",
  ] as const;
  beforeAll(() => {
    // RED today: module does not exist.
    chips = require("../../shared/quote-flow/starter-chips");
  });

  it("P-20 the four chips map to pairwise-distinct intents", () => {
    const intents = KEYS.map((k) => chips.chipIntent(k));
    expect(new Set(intents).size).toBe(KEYS.length);
  });

  it("P-20 the invoice chip's intent is about invoicing, not a quote", () => {
    const intent = String(chips.chipIntent("invoiceDone"));
    expect(intent).toMatch(/invoice/i);
    expect(intent).not.toMatch(/quote|cotiz/i);
  });

  it("P-20 the four ES chip replies are pairwise distinct (not one canned reply)", () => {
    const replies = KEYS.map((k) => chips.chipReply(k, "es"));
    replies.forEach((r) => expect(typeof r).toBe("string"));
    expect(new Set(replies).size).toBe(KEYS.length);
  });

  it("P-20 the facturar chip reply mentions factura(r) and NOT cotización", () => {
    const reply = String(chips.chipReply("invoiceDone", "es"));
    expect(reply).toMatch(/factur/i);
    expect(reply).not.toMatch(/cotiz/i);
  });
});

// ---------------------------------------------------------------------------
// P-25 — localized manual-terms strings (terms-i18n.ts)
// ---------------------------------------------------------------------------
describe("P-25 termLabel localizes the SUBMITTED term string", () => {
  let terms: any;
  beforeAll(() => {
    // RED today: module does not exist.
    terms = require("../../shared/quote-flow/terms-i18n");
  });

  it("P-25 warranty 'lifetime' is 'De por vida' in ES, not 'Lifetime'", () => {
    const label = String(
      terms.termLabel({ kind: "warranty", value: "lifetime" }, "es"),
    );
    expect(label).toMatch(/de por vida/i);
    expect(label).not.toMatch(/lifetime/i);
  });

  it("P-25 warranty 'lifetime' stays 'Lifetime' in EN", () => {
    const label = String(
      terms.termLabel({ kind: "warranty", value: "lifetime" }, "en"),
    );
    expect(label).toMatch(/lifetime/i);
  });

  it("P-25 duration '3 weeks' is '3 semanas' in ES, not '3 weeks'", () => {
    const label = String(
      terms.termLabel(
        { kind: "duration", value: { n: 3, unit: "weeks" } },
        "es",
      ),
    );
    expect(label).toMatch(/3\s*semanas/i);
    expect(label).not.toMatch(/weeks?/i);
  });

  it("P-25 duration '3 weeks' stays '3 weeks' in EN", () => {
    const label = String(
      terms.termLabel(
        { kind: "duration", value: { n: 3, unit: "weeks" } },
        "en",
      ),
    );
    expect(label).toMatch(/3\s*weeks/i);
  });

  it("P-25 payment 'Net 30' uses the ES equivalent (Neto), not the EN 'Net 30'", () => {
    const label = String(
      terms.termLabel({ kind: "payment", value: { net: 30 } }, "es"),
    );
    expect(label).toMatch(/neto\s*30/i);
    expect(label).not.toMatch(/net\s*30/i);
  });
});

// ---------------------------------------------------------------------------
// P-21 (dict-half) — one consistent "Quote + Agreement" / "Cotización + Acuerdo"
// ---------------------------------------------------------------------------
describe("P-21 dictionary brands the deck's PLUS, not an ampersand or 'contrato'", () => {
  it("P-21 no EN value contains 'Quote & Agreement' (the PLUS rule)", () => {
    const offenders = Object.entries(en)
      .filter(([, v]) =>
        typeof v === "string" && v.includes("Quote & Agreement")
      )
      .map(([k]) => k);
    expect(offenders).toEqual([]); // today: ["quoteDoc.docTag"]
  });

  it("P-21 quoteDoc.docTag brands with a PLUS in both languages", () => {
    expect(en["quoteDoc.docTag"]).toBe("Quote + Agreement");
    expect(es["quoteDoc.docTag"]).toBe("Cotización + Acuerdo");
  });

  it("P-21 the ES drafting header keeps the 'Cotización' term (never 'contrato')", () => {
    // Post-merge key: asstChat.header.quoteDrafted ("Cotización redactada · revisar").
    expect(es["asstChat.header.quoteDrafted"]).toMatch(/cotizaci[oó]n/i);
    expect(es["asstChat.header.quoteDrafted"]).not.toMatch(/contrato/i);
  });

  it("P-21 the ES send confirmation never brands 'Contrato' against the 'Cotización + Acuerdo' the user built", () => {
    // Post-merge key: asstChat.header.outForSignature ("Enviada para firma" —
    // feminine, agreeing with la Cotización; the whiplash word is gone).
    expect(typeof es["asstChat.header.outForSignature"]).toBe("string");
    expect(es["asstChat.header.outForSignature"]).not.toMatch(/contrato/i);
  });
});

// ---------------------------------------------------------------------------
// P-53 (dict-half) — see documentation below
// ---------------------------------------------------------------------------
describe("P-53 mobile amount-picker hint", () => {
  // GROUND-TRUTH FINDING (evidence over instruction): the dictionary is ALREADY
  // correct. lang/{en,es}.json ship a Shift-free mobile variant TODAY —
  //   moneyInput.hintTouch = "Tap a preset or type an amount"
  //                        / "Toca un monto rápido o escribe una cantidad"
  // alongside the desktop moneyInput.hintKeyboard ("… Shift = $100"). So neither
  // proposed dict assertion ("provides a Shift-free mobile key" OR "the hint has
  // no Shift") is RED — the first passes, the second would wrongly strip a hint
  // that is legitimately useful for physical-keyboard users.
  //
  // The REAL P-53 defect is component wiring: MoneyInput.tsx:60-67/285-287 picks
  // hintTouch vs hintKeyboard from matchMedia("(hover: none) and (pointer:
  // coarse)") rather than the viewport, so a small-viewport-but-fine-pointer
  // device (a phone-sized Cypress window, a touchscreen laptop) still shows the
  // Shift hint. That red lives in the e2e (cy.viewport(390,844) → no "Shift").
  it.skip(
    "P-53 dict-half has no honest RED — hintTouch already exists; red is component-wiring + e2e",
    () => {
      // Left as a skip on purpose: a passing dict guard would be a green-today
      // test (forbidden here). The Shift-free contract the green agent must keep:
      //   en["moneyInput.hintTouch"] stays truthy, has no /shift/i, and differs
      //   from en["moneyInput.hintKeyboard"]. Real red: e2e cy.viewport(390,844).
    },
  );
});
