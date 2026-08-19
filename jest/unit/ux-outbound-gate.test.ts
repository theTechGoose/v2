/**
 * RED (TDD) — UX-26: one sender-identity gate for EVERY outbound composer.
 *
 * Finding (ux-problems.md, verbatim fragment):
 *  UX-26 "[OUTBOUND/P-06 REGRESSION-CLASS] The assistant's send path bypasses
 *         the placeholder-name guard — a customer received 'Hi Pedro, this is
 *         Nuevo.' … the P-06 refusal was wired on the paperwork controller
 *         endpoints (/quotes/:id/email|text), but the assistant's
 *         send-contract coordinator dispatches through its own path and skips
 *         the guard — route ALL outbound through one identity gate"
 *
 * Live-verified leak (2026-08-19, dev stack, phone +15125556200): a raw
 * skip-setup session drove POST /agents/conversations/:id/send-contract
 * {channel:"sms"} and the comms log recorded:
 *   "Hi Pedro, this is Nuevo.\n\nYour Quote + Agreement for Pintar la sala
 *    is ready: http://localhost:5280/s/OQmJOC…"
 * while the SAME account is refused by POST /contracts/:id/text
 * (controller-level guard). Two gates, one hole.
 *
 * WHY the hole exists (all file:line refs verified against prod source):
 *  - The SMS guard lives ONLY in the controller:
 *      backend/src/paperwork/entrypoints/paperwork-email-controller/mod.ts
 *      :71-93  smsSenderRefusal(...) — module-level helper
 *      :169, :185, :198 — applied to POST quotes/:id/text,
 *      contracts/:id/text, invoices/:id/text and nowhere else.
 *  - The assistant coordinator dispatches BELOW the controller:
 *      backend/src/agents/domain/coordinators/send-contract/mod.ts
 *      :100-110 — this.smser.run(...) → SendPaperworkSms, no guard.
 *  - The SMS composer takes the RAW first token of user.name:
 *      backend/src/paperwork/domain/coordinators/send-paperwork-sms/mod.ts
 *      :266-268 senderFirst() → "Nuevo" from "Nuevo usuario";
 *      used at :304 (renderQuoteBody), :330 (renderContractBody),
 *      :397 (renderInvoiceBody contractorFirstName).
 *  - Same class of raw split in the receipt SMS:
 *      backend/src/paperwork/domain/coordinators/confirm-payment/mod.ts:144.
 *  - The email coordinator shows the target shape (guard INSIDE the
 *      coordinator, so every caller inherits it):
 *      backend/src/paperwork/domain/coordinators/send-paperwork-email/mod.ts
 *      :101-115 (refusal), :59-60 SENDER_NAME_REQUIRED_REASON (must keep
 *      matching /name|nombre/i — pinned by email-content.int.test.ts).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * GREEN AGENT — extend `shared/quote-flow/outbound-identity.ts` (module
 * exists; isPlaceholderName/outboundSenderName already live there) with
 * EXACTLY these additional exports, then route every dispatch through them:
 *
 *   // The first name outbound SMS copy may use for the contractor:
 *   // first whitespace token of the REAL user name; undefined when the name
 *   // is a seeded placeholder ("New user"/"Nuevo usuario") or empty. The
 *   // placeholder's first token ("Nuevo"/"New") is NEVER returned.
 *   export function outboundSenderFirstName(
 *     userName: string | null | undefined,
 *   ): string | undefined;
 *
 *   // The single machine-readable refusal every outbound dispatch
 *   // coordinator consults BEFORE composing/dispatching/logging. undefined
 *   // when a real user name OR business name exists (outboundSenderName
 *   // resolves); otherwise the P-06-shaped refusal. `reason` must match
 *   // /name|nombre/i (keep = SENDER_NAME_REQUIRED_REASON).
 *   export function senderIdentityRefusal(args: {
 *     userName?: string | null;
 *     businessName?: string | null;
 *   }): { ok: false; reason: string; needsName: true; to: "" } | undefined;
 *
 * Wire-in (single gate — coordinator level, so the assistant path and any
 * future caller inherit it):
 *   - SendPaperworkSms.run: call senderIdentityRefusal FIRST (before the
 *     kind branches at send-paperwork-sms/mod.ts:84) and return the refusal
 *     without dispatching or comms-logging; replace senderFirst (:266-268)
 *     with outboundSenderFirstName.
 *   - smsSenderRefusal in paperwork-email-controller/mod.ts:71-93 delegates
 *     to (or is deleted in favor of) the coordinator gate.
 *   - SendContract (agents) surfaces the refusal on its divider payload as
 *     smsFailureReason so the chat says "needs your name", never "texted ✓"
 *     (send-contract/mod.ts:100-110, buildDivider :158-187).
 *   - ConfirmPayment's receipt SMS sender token (confirm-payment/mod.ts:144)
 *     goes through outboundSenderFirstName too.
 *
 * RED mechanism: the two new exports do not exist yet, so calling them
 * throws "… is not a function". The two [contract-pin] its at the bottom
 * are GREEN by design (existing exports the gate builds on — regression
 * pins, clearly labeled).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Phones: none (pure logic — no network).
 */
import {
  isPlaceholderName,
  outboundSenderFirstName,
  outboundSenderName,
  senderIdentityRefusal,
} from "../../shared/quote-flow/outbound-identity";

describe("UX-26: outboundSenderFirstName — the SMS intro token never leaks the placeholder", () => {
  it("UX-26: 'Nuevo usuario' yields NO first name (never 'Nuevo')", () => {
    expect(outboundSenderFirstName("Nuevo usuario")).toBeUndefined();
  });

  it("UX-26: 'New user' yields NO first name (never 'New')", () => {
    expect(outboundSenderFirstName("New user")).toBeUndefined();
  });

  it("UX-26: empty / whitespace-only names yield undefined", () => {
    expect(outboundSenderFirstName("")).toBeUndefined();
    expect(outboundSenderFirstName("   ")).toBeUndefined();
    expect(outboundSenderFirstName(undefined)).toBeUndefined();
    expect(outboundSenderFirstName(null)).toBeUndefined();
  });

  it("UX-26: a real name projects its first token", () => {
    expect(outboundSenderFirstName("Rafa Morales")).toBe("Rafa");
    expect(outboundSenderFirstName("  Marta Contratista ")).toBe("Marta");
    expect(outboundSenderFirstName("Rafa")).toBe("Rafa");
  });

  it("UX-26: trim-tolerant placeholder detection (mirrors isPlaceholderName)", () => {
    expect(outboundSenderFirstName("  Nuevo usuario  ")).toBeUndefined();
  });
});

describe("UX-26: senderIdentityRefusal — the ONE pre-dispatch gate", () => {
  it("UX-26: placeholder name + no business ⇒ machine-readable needs-name refusal", () => {
    const r = senderIdentityRefusal({ userName: "Nuevo usuario" });
    expect(r).toBeDefined();
    expect(r!.ok).toBe(false);
    expect(r!.needsName).toBe(true);
    expect(r!.to).toBe("");
    // Same signal contract the email guard + P-06 tests pin: /name|nombre/i.
    expect(r!.reason).toMatch(/name|nombre/i);
  });

  it("UX-26: EN placeholder + blank business name refuses too", () => {
    const r = senderIdentityRefusal({ userName: "New user", businessName: "   " });
    expect(r).toBeDefined();
    expect(r!.needsName).toBe(true);
  });

  it("UX-26: a real business name is a valid outbound identity — no refusal", () => {
    expect(
      senderIdentityRefusal({ userName: "Nuevo usuario", businessName: "MARTA LLC" }),
    ).toBeUndefined();
  });

  it("UX-26: a real user name passes — no refusal", () => {
    expect(senderIdentityRefusal({ userName: "Rafa Morales" })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// [contract-pin — GREEN by design] The existing exports the gate builds on.
// These pin the P-06 foundation so the green agent extends it rather than
// re-deriving it; they pass today on purpose.
// ---------------------------------------------------------------------------
describe("UX-26: [contract-pin] existing outbound-identity foundation", () => {
  it("UX-26: [contract-pin] both seeded placeholders are recognized", () => {
    expect(isPlaceholderName("Nuevo usuario")).toBe(true);
    expect(isPlaceholderName("New user")).toBe(true);
    expect(isPlaceholderName("Rafa Morales")).toBe(false);
  });

  it("UX-26: [contract-pin] outboundSenderName never emits the placeholder", () => {
    expect(outboundSenderName({ userName: "Nuevo usuario" })).toBeUndefined();
    expect(
      outboundSenderName({ userName: "Nuevo usuario", businessName: "MARTA LLC" }),
    ).toBe("MARTA LLC");
  });
});
