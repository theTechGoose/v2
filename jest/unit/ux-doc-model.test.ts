/**
 * UX-37 "Two independent signature ceremonies exist for one agreement."
 *
 * Original repro (ux-problems.md third pass): the customer accept-signed the
 * "Cotización + Acuerdo" on /q — yet /c for the SAME deal still said
 * "PENDIENTE DE FIRMA" and offered a full second signing ceremony. Completing
 * that second ceremony is what fired the UX-36 double-billing.
 *
 * RESOLVED BY CONSTRUCTION by the Quote+Contract merge: the contract entity
 * and the /c page are gone — the quote IS the agreement, /q/:id is the only
 * document, and accepting it is THE one signature ceremony. What this suite
 * pins is the merged single-ceremony contract on the ONE remaining derive:
 *
 *   deriveQuoteView(payload).pendingSignature
 *     — true ONLY when a fresh signature ceremony is appropriate: the quote
 *       is neither accepted nor declined. This is the single flag the /q
 *       page consults before mounting the pad (PublicSignQuote).
 *     — false once accepted (the view then carries the acceptance evidence:
 *       acceptedBy / acceptedAt / signatureImage) and false once declined —
 *       so no payload state can ever re-offer a second ceremony.
 *
 * Target: shared/quote-flow/public-doc-state.ts
 *
 * Phones: none (pure logic — fixture values carried over from the original
 * probe with the throwaway +15125556600/+15125556601 pair).
 */
import { deriveQuoteView } from "../../shared/quote-flow/public-doc-state";

// ---------------------------------------------------------------------------
// Fixtures — the merged public payload (GET /quotes/:id/public): one quote
// carrying its own terms and acceptance evidence.
// ---------------------------------------------------------------------------

/** The deal from the original UX-37 repro, as the merged model stores it:
 *  one quote, terms drafted onto it, merely sent — a genuinely open deal. */
const openQuotePayload = {
  id: "c71e40b6-2c85-4cae-9fad-b73fb5a48e24",
  status: "sent",
  customer: { name: "Probe Customer" },
};

/** The same deal after the ONE ceremony on /q. */
const acceptedQuotePayload = {
  ...openQuotePayload,
  status: "accepted",
  acceptedAt: "2026-08-19T00:20:09.000Z",
  acceptedName: "Probe Customer",
  acceptedSignature:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGNgYGD4z4AGmNAFRlgIXQAAiMkBB9dzbnMAAAAASUVORK5CYII=",
};

/** The same deal declined by the customer. */
const declinedQuotePayload = {
  ...openQuotePayload,
  status: "lost",
};

// ---------------------------------------------------------------------------
// UX-37 — one agreement, one ceremony
// ---------------------------------------------------------------------------

describe("UX-37 deriveQuoteView — one document, one signature ceremony", () => {
  it("UX-37 an accepted quote must NOT be pending signature — no second ceremony exists", () => {
    const view = deriveQuoteView(acceptedQuotePayload);
    expect(view.mode).toBe("accepted");
    expect(view.pendingSignature).toBe(false);
  });

  it("UX-37 the accepted rendering carries the acceptance evidence (name + date + signature)", () => {
    const view = deriveQuoteView(acceptedQuotePayload);
    expect(view.acceptedBy).toBe("Probe Customer");
    expect(view.acceptedAt).toBe("2026-08-19T00:20:09.000Z");
    expect(view.signatureImage).toBe(acceptedQuotePayload.acceptedSignature);
  });

  it("UX-37 the acceptance stamp ALONE kills the ceremony, even if the status field lags", () => {
    // The original bug's mechanism was acceptance evidence the second page
    // ignored. The merged derive may never repeat it: any persisted
    // acceptedAt suppresses the pad regardless of the status value.
    const view = deriveQuoteView({
      ...acceptedQuotePayload,
      status: "sent",
    });
    expect(view.mode).toBe("accepted");
    expect(view.pendingSignature).toBe(false);
  });

  it("UX-37 a declined quote is not pending either — declining also ends the ceremony", () => {
    const view = deriveQuoteView(declinedQuotePayload);
    expect(view.mode).toBe("declined");
    expect(view.pendingSignature).toBe(false);
  });

  it("UX-37 a genuinely open deal (quote only sent) KEEPS the one ceremony", () => {
    const view = deriveQuoteView(openQuotePayload);
    expect(view.mode).toBe("open");
    expect(view.pendingSignature).toBe(true);
    // …and an open deal carries no acceptance evidence to render instead.
    expect(view.acceptedBy).toBeUndefined();
    expect(view.acceptedAt).toBeUndefined();
    expect(view.signatureImage).toBeUndefined();
  });

  it("UX-37 every open state offers exactly one pending ceremony; every closed state offers none", () => {
    for (const status of ["draft", "sent", "viewed"]) {
      expect(deriveQuoteView({ ...openQuotePayload, status }).pendingSignature)
        .toBe(true);
    }
    for (
      const payload of [acceptedQuotePayload, declinedQuotePayload]
    ) {
      expect(deriveQuoteView(payload).pendingSignature).toBe(false);
    }
  });
});
