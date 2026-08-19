/**
 * RED (TDD) — UX-28: ONE commsLanguage resolution for every outbound
 * channel and doc type.
 *
 * Finding (ux-problems.md, verbatim fragment):
 *  UX-28 "[OUTBOUND] Outbound language is inconsistent for the same
 *         contractor + customer. Rafa's quote SMS went out in Spanish
 *         ('Hola María, soy Rafa de Techos Morales…') but his invoice SMS in
 *         English ('Hi María, your invoice is ready…') — the two send paths
 *         resolve commsLanguage differently. Pick one resolution (identity
 *         commsLanguage) and use it on every channel/doc type.
 *         (EN-by-default is the product's promise; the inconsistency is the
 *         bug.)"
 *
 * THE TWO DIVERGENT RESOLUTIONS (file:line verified against prod source):
 *
 *  Path A — assistant quote/agreement dispatch carries a PER-SEND override:
 *    front-end/islands/AsstChat.tsx:5901-5904
 *      confirmSendContract(m, sendChannel, previewLang)  ← previewLang!
 *    → backend/src/agents/entrypoints/conversations-controller/mod.ts:140-141
 *    → backend/src/agents/domain/coordinators/send-contract/mod.ts:90,102
 *      (language: input.language forwarded to both dispatchers)
 *    → backend/src/paperwork/domain/coordinators/send-paperwork-sms/mod.ts
 *      :76-78 ({...rawBiz, commsLanguage: input.language} — override wins)
 *      → :302 renderQuoteBody / :328 renderContractBody.
 *
 *  Path B — invoice dispatch NEVER passes a language:
 *    front-end/islands/AsstChat.tsx:3225-3236 (sendInvoiceOn) and
 *    :4279-4289 (invoice-flow buttons): POST /invoices/:id/text with {} —
 *    SmsDispatchDto has no language field
 *    (paperwork-email-controller/mod.ts:23-26,195-206)
 *    → send-paperwork-sms/mod.ts:135 — stored senderBiz?.commsLanguage only.
 *
 *  Same drift on the email side: send-paperwork-email/mod.ts:92-95
 *  (override merge) vs :168, :190, :560, :611, :1041 (stored default).
 *
 *  Live-probed divergence (2026-08-19, phone +15125556210 — identity has
 *  businessName but NO stored commsLanguage, the fresh-signup state):
 *    contract SMS: "Hola María, soy Rafa de Techos Probe LLC.\n\nTu
 *                   Cotización + Acuerdo para Reparación de techo está
 *                   lista: …"                                  (Spanish)
 *    invoice  SMS: "Hi María, your invoice is ready ($3,700). View &
 *                   pay: … — Rafa"                             (English)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GREEN AGENT — create `shared/quote-flow/comms-language.ts` (new module,
 * sibling of sms-i18n.ts) with EXACTLY these exports:
 *
 *   export type CommsLang = "en" | "es";
 *
 *   // THE one resolution. Trim/case-tolerant on inputs; anything that is
 *   // not "en"/"es" is treated as absent.
 *   //   1. explicit per-send pick (the assistant "Send in <lang>" /
 *   //      preview-language toggle) when present and valid;
 *   //   2. else the stored Settings default (identity.commsLanguage);
 *   //   3. else "en" — EN-by-default is the product's promise.
 *   export function resolveCommsLanguage(args: {
 *     override?: string | null;
 *     identityCommsLanguage?: string | null;
 *   }): CommsLang;
 *
 * Wire-in: every site listed above resolves through this function with the
 * SAME inputs for the same contractor — the invoice dispatches must receive
 * the same explicit pick the contract dispatch got (thread the language
 * through AsstChat's invoice sends + SmsDispatchDto/EmailDispatchDto), or
 * no path passes a per-send pick at all — either way one function, one
 * answer per contractor, every channel and doc type. The observable
 * consistency is pinned by ux-comms-language.int.test.ts.
 *
 * The module does not exist yet, so this whole file fails with
 * "Cannot find module" — that is the intended red.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Phones: none (pure logic — no network).
 */
import { resolveCommsLanguage } from "../../shared/quote-flow/comms-language";

describe("UX-28: resolveCommsLanguage — one resolution for every outbound", () => {
  it("UX-28: the stored identity commsLanguage is honored", () => {
    expect(resolveCommsLanguage({ identityCommsLanguage: "es" })).toBe("es");
    expect(resolveCommsLanguage({ identityCommsLanguage: "en" })).toBe("en");
  });

  it("UX-28: an explicit per-send pick wins over the stored default", () => {
    expect(
      resolveCommsLanguage({ override: "en", identityCommsLanguage: "es" }),
    ).toBe("en");
    expect(
      resolveCommsLanguage({ override: "es", identityCommsLanguage: "en" }),
    ).toBe("es");
  });

  it("UX-28: EN by default — the product's promise", () => {
    expect(resolveCommsLanguage({})).toBe("en");
    expect(
      resolveCommsLanguage({ override: null, identityCommsLanguage: null }),
    ).toBe("en");
  });

  it("UX-28: invalid values are treated as absent, not as English-by-crash", () => {
    expect(
      resolveCommsLanguage({ override: "fr", identityCommsLanguage: "es" }),
    ).toBe("es");
    expect(
      resolveCommsLanguage({ override: "", identityCommsLanguage: "xx" }),
    ).toBe("en");
  });

  it("UX-28: trim/case tolerant — ' ES ' still means Spanish", () => {
    expect(resolveCommsLanguage({ identityCommsLanguage: " ES " })).toBe("es");
    expect(resolveCommsLanguage({ override: "Es" })).toBe("es");
  });

  it("UX-28: deterministic — same inputs, same language (no doc-type parameter exists)", () => {
    // The signature itself is the fix: there is no docKind/channel argument,
    // so a quote text and an invoice text CANNOT legally resolve differently
    // for the same contractor + same pick.
    const args = { override: "es", identityCommsLanguage: undefined };
    expect(resolveCommsLanguage(args)).toBe(resolveCommsLanguage(args));
  });
});
