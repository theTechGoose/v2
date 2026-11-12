/**
 * REQ-460 — demo-loop cycle 3, issues B1 + M16 + M15 (pair 4, Tom Baker):
 * "Customer link / Open as customer" showed at "Lock it in"; /q said
 * "AWAITING SIGNATURE" and signed while the assistant was still asking "When
 * do you want to get paid?"; the signature billed the whole $14,500 as one
 * invoice marked Sent; then "Deposit + balance" was written onto the SIGNED
 * agreement and the wizard moved on to the warranty.
 *
 * Targets:
 *   shared/documents/versions.ts             quoteSignRefusal — the one rule
 *   shared/quote-flow/public-doc-state.ts    deriveQuoteView's "unready" mode
 *   shared/documents/linked-view.ts          acceptDecision → not_ready
 *   front-end/lib/customer-link.ts           cardShowsCustomerLink
 *   front-end/islands/AsstChat.tsx           the card's link row uses it
 *   front-end/components/quote-doc.tsx       no pad on an unready quote
 *   front-end/islands/PublicSignQuote.tsx    a 409 not_ready says so
 *   lang/en.json + lang/es.json              the new copy, both languages
 */
import * as fs from "fs";
import * as path from "path";
import { quoteSignRefusal } from "../../shared/documents/versions";
import {
  deriveQuoteView,
  internalPreview,
} from "../../shared/quote-flow/public-doc-state";
import { acceptDecision } from "../../shared/documents/linked-view";
import { cardShowsCustomerLink } from "../../front-end/lib/customer-link";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

const START = { stepId: "start_date", label: "Start", value: "Next week" };
const PAY = { stepId: "payment_terms", label: "Payment", value: "50 / 50" };

describe("REQ-460 quoteSignRefusal — a quote is signable once it was offered with its payment terms", () => {
  test("REQ-460 (M16) a locked draft whose wizard is still asking was offered to no one: not_issued", () => {
    expect(
      quoteSignRefusal({
        status: "draft",
        lockedAt: "2026-11-12T12:10:00Z",
        terms: [START],
      } as never),
    ).toBe("not_issued");
    // even with every term answered — Send is what offers it
    expect(quoteSignRefusal({ status: "draft", terms: [START, PAY] }))
      .toBe("not_issued");
    expect(quoteSignRefusal({})).toBe("not_issued");
  });

  test("REQ-460 (M15) offered with the wizard's terms but no payment terms: terms_incomplete", () => {
    expect(
      quoteSignRefusal({
        status: "sent",
        sentAt: "2026-11-12",
        terms: [START],
      }),
    ).toBe("terms_incomplete");
    expect(quoteSignRefusal({ status: "viewed", terms: [START] }))
      .toBe("terms_incomplete");
  });

  test("REQ-460 signable: sent with its payment terms; a Send that reached nobody (REQ-236); an API quote with no wizard terms (REQ-240)", () => {
    expect(quoteSignRefusal({ status: "sent", terms: [START, PAY] }))
      .toBeUndefined();
    expect(quoteSignRefusal({ status: "viewed", terms: [PAY] }))
      .toBeUndefined();
    expect(
      quoteSignRefusal({
        status: "draft",
        terms: [START, PAY],
        lastDelivery: {
          at: "2026-11-12T12:00:00Z",
          channel: "sms",
          smsFailureReason: "unreachable",
        },
      }),
    ).toBeUndefined();
    expect(quoteSignRefusal({ status: "sent", sentAt: "2026-11-12" }))
      .toBeUndefined();
    expect(quoteSignRefusal({ status: "sent", terms: [] })).toBeUndefined();
  });

  test("REQ-460 the onboarding sample (REQ-256) is a draft by design and keeps its customer page, pad included", () => {
    expect(quoteSignRefusal({ status: "draft", isSample: true }))
      .toBeUndefined();
  });
});

describe("REQ-460 the /q page: an unready quote shows no pad and no 'Sign in person'", () => {
  const draft = {
    id: "q-1",
    status: "draft",
    customer: { name: "Linda Ortiz" },
    signRefusal: "not_issued",
  };

  test("REQ-460 (M16) deriveQuoteView: the server's signRefusal is the 'unready' mode — no pending signature", () => {
    const v = deriveQuoteView(draft);
    expect(v.mode).toBe("unready");
    expect(v.pendingSignature).toBe(false);
    expect(v.footerVariant).toBe("beforeSigning");
    expect(deriveQuoteView({ ...draft, signRefusal: "terms_incomplete" }).mode)
      .toBe("unready");
  });

  test("REQ-460 (M16) the owner's own view of an unready quote is no signing preview, even with the in-person override", () => {
    const own = { ...draft, internal: true };
    expect(internalPreview(own, "")).toBe(false);
    expect(internalPreview(own, "?as=customer&confirm=1")).toBe(false);
  });

  test("REQ-460 an offered quote with its terms is open for signature as before; signed and declined keep their modes", () => {
    const { signRefusal: _, ...ready } = draft;
    expect(deriveQuoteView({ ...ready, status: "sent" }).mode).toBe("open");
    expect(deriveQuoteView({ ...ready, status: "sent" }).pendingSignature)
      .toBe(true);
    expect(
      deriveQuoteView({ ...draft, status: "accepted", acceptedAt: "x" }).mode,
    ).toBe("accepted");
    expect(deriveQuoteView({ ...draft, status: "lost" }).mode).toBe(
      "declined",
    );
  });

  test("REQ-460 acceptDecision: a 409 not_issued / terms_incomplete is 'not ready', never a raw error", () => {
    expect(acceptDecision(409, { ok: false, reason: "not_issued" }))
      .toEqual({ kind: "not_ready" });
    expect(acceptDecision(409, { ok: false, reason: "terms_incomplete" }))
      .toEqual({ kind: "not_ready" });
    expect(acceptDecision(409, { ok: false, reason: "already_accepted" }))
      .toEqual({ kind: "already_accepted" });
  });

  test("REQ-460 quote-doc renders the not-ready notice in place of the pad and the preview (the rendered page: front-end/lib/sign-gate.test.tsx)", () => {
    const doc = read("front-end/components/quote-doc.tsx");
    expect(doc).toMatch(/view\.mode === "unready"/);
    expect(doc).toContain('data-cy="quote-not-ready"');
    expect(doc).toContain('"public.doc.notReady"');
    expect(doc).toContain('"public.doc.notReadyBody"');
    const notice = doc.indexOf('data-cy="quote-not-ready"');
    const pad = doc.indexOf("<PublicSignQuote");
    const preview = doc.indexOf('data-cy="quote-internal-preview"');
    expect(notice).toBeGreaterThan(0);
    expect(notice).toBeLessThan(preview);
    expect(notice).toBeLessThan(pad);
  });

  test("REQ-460 the sign island answers a not-ready 409 with the notice", () => {
    const sign = read("front-end/islands/PublicSignQuote.tsx");
    expect(sign).toMatch(/decision\.kind === "not_ready"/);
    expect(sign).toContain('data-cy="sign-not-ready"');
    expect(sign).toContain('"public.doc.notReadyBody"');
  });
});

describe("REQ-460 (M16) the chat's quote card carries the customer's link only once the quote went out", () => {
  test("REQ-460 a locked card (still being finished) has no link; a sent, viewed or signed one does", () => {
    expect(cardShowsCustomerLink("locked")).toBe(false);
    expect(cardShowsCustomerLink("draft")).toBe(false);
    expect(cardShowsCustomerLink(undefined)).toBe(false);
    expect(cardShowsCustomerLink("sent")).toBe(true);
    expect(cardShowsCustomerLink("viewed")).toBe(true);
    expect(cardShowsCustomerLink("accepted")).toBe(true);
  });

  test("REQ-460 the thread's live quote row decides for its own card: a send after the card was appended shows the link, a lock does not", () => {
    expect(
      cardShowsCustomerLink("locked", {
        status: "sent",
        sentAt: "2026-11-12",
      }),
    ).toBe(true);
    expect(
      cardShowsCustomerLink("locked", { status: "draft", sentAt: null }),
    ).toBe(false);
    expect(cardShowsCustomerLink("sent", { status: "draft" })).toBe(false);
  });

  test("REQ-460 AsstChat gates the action card's CustomerLinkRow with cardShowsCustomerLink, fed the thread's quote row", () => {
    const chat = read("front-end/islands/AsstChat.tsx");
    const start = chat.indexOf('if (m.kind === "action_card")');
    const end = chat.indexOf('m.content === "PM_ONBOARDING_DEMO_CTA"', start);
    const card = chat.slice(start, end);
    const gate = card.indexOf("cardShowsCustomerLink(");
    expect(gate).toBeGreaterThan(0);
    expect(card.slice(gate)).toMatch(/<CustomerLinkRow/);
    expect(card.slice(gate, card.indexOf("<CustomerLinkRow", gate)))
      .toMatch(/ruleQuote/);
    expect(card).not.toMatch(
      /isLockedOrIssued\(payload\.status\) && payload\.quoteId/,
    );
  });
});

describe("REQ-460 copy in both languages", () => {
  test("REQ-460 the refusal in the chat names the quote and the way to change it; the page's notice says it is not ready", () => {
    for (
      const k of [
        "wizardAnswer.signedLocked",
        "public.doc.notReady",
        "public.doc.notReadyBody",
      ]
    ) {
      expect(typeof en[k]).toBe("string");
      expect(typeof es[k]).toBe("string");
      expect(en[k]).not.toBe(es[k]);
    }
    expect(en["wizardAnswer.signedLocked"]).toContain("{number}");
    expect(es["wizardAnswer.signedLocked"]).toContain("{number}");
    expect(en["wizardAnswer.signedLocked"]).toMatch(/change order/i);
    expect(en["wizardAnswer.signedLocked"]).toMatch(/new version/i);
    expect(es["wizardAnswer.signedLocked"]).toMatch(/orden de cambio/i);
    expect(es["wizardAnswer.signedLocked"]).toMatch(/nueva versión/i);
  });
});
