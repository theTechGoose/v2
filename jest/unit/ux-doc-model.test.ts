/**
 * RED (TDD) — UX-37 "Two independent signature ceremonies exist for one
 * agreement."
 *
 * Live repro (ux-problems.md third pass): the customer accept-signed the
 * "Cotización + Acuerdo" on /q (quote status "approved", typed-name signature
 * persisted) — yet /c for the SAME deal still said "PENDIENTE DE FIRMA" and
 * offered a full second signing ceremony. Completing that second ceremony is
 * what fired the UX-36 double-billing.
 *
 * Target: shared/quote-flow/public-doc-state.ts  (EXISTS — read on
 * 2026-08-19; this suite EXTENDS its contract. Red today via failed
 * assertions: the new fields don't exist yet, so `pendingSignature` derives
 * as `undefined`.)
 *
 * ── Extended payload contract (PublicContractPayloadLike additions) ────────
 *   quoteStatus?: string;       // linked quote's status ("approved" is what
 *                               // POST /quotes/:id/accept writes; legacy rows
 *                               // may say "accepted")
 *   quoteAcceptedAt?: string;   // ISO — the quote row's acceptedAt
 *   quoteAcceptedName?: string; // the quote row's acceptedName
 *
 * ── Extended view contract (ContractView additions) ────────────────────────
 *   pendingSignature: boolean;
 *     — true ONLY when a fresh signature ceremony is appropriate: the
 *       contract is not signed AND the linked quote is not accepted. This is
 *       the single flag the /c page must consult before rendering the pad
 *       (PublicSignContract) or the "Awaiting signature" pill.
 *   acceptedEvidence?: {
 *     at?: string;   // signedAt (contract ceremony) or quoteAcceptedAt (/q)
 *     by?: string;   // customerSignedName            or quoteAcceptedName
 *     via: "contractSign" | "quoteAccept";
 *   }
 *     — present whenever pendingSignature is false; what the page renders
 *       instead of a fresh pad (signed card, or an explicit "ya aceptaste
 *       esto el <fecha>" notice — the derived state doesn't prescribe which).
 *
 * ── Both fix shapes the finding allows flow through this ONE contract ──────
 *   Shape A — quote-accept marks the linked contract signed: the public
 *     payload then arrives with status "signed" (+ signedAt) and derives
 *     pendingSignature=false via "contractSign".
 *   Shape B — /c renders an already-accepted notice: the public payload
 *     gains quoteStatus/quoteAcceptedAt/quoteAcceptedName and derives
 *     pendingSignature=false via "quoteAccept".
 *   deriveContractView must handle BOTH payload shapes; the tests below pin
 *   each one.
 *
 * Wiring sites (for the green agent — read on 2026-08-19):
 *   - front-end/components/contract-doc.tsx:213
 *     (`const view = deriveContractView(contract);`) — the awaiting pill at
 *     :345-351 and the unsigned pad branch at :580-604 (PublicSignContract
 *     mounted at :599-602) key off `signed` alone today; they must key off
 *     `view.pendingSignature` / `view.acceptedEvidence`.
 *   - Shape B server delta:
 *     backend/src/paperwork/entrypoints/public-controller/mod.ts
 *     getContractPublic :634-708 already loads the linked quote (:671-673)
 *     but only projects jobDetails (:687-697) — the ctx.json at :698-704
 *     must add quoteStatus/quoteAcceptedAt/quoteAcceptedName.
 *   - Shape A server delta: acceptQuote,
 *     backend/src/paperwork/entrypoints/public-controller/mod.ts:473-542 —
 *     after the quote update (:498-505), flip the linked contract (locatable
 *     exactly like GET /contracts/by-quote/:quoteId/public does at :710-725)
 *     to signed with the acceptance metadata.
 *
 * Probed 2026-08-19 (dev stack): after POST /quotes/:id/accept, GET
 * /contracts/:id/public for the linked contract returns NO `status` key, no
 * `signedAt`, and no quote-acceptance evidence of any kind — the /c page
 * derives a pristine pending ceremony. That payload is pinned verbatim below.
 *
 * Phones: none (pure logic — fixtures were probed with the throwaway
 * +15125556600/+15125556601 pair from this slice's block).
 */
import { deriveContractView } from "../../shared/quote-flow/public-doc-state";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** VERBATIM (trimmed) GET /contracts/:id/public payload probed on 2026-08-19
 *  AFTER the linked quote was accepted on /q — today's real shape: no status,
 *  no acceptance evidence. */
const probedAfterQuoteAccept = {
  id: "8bf1ed7d-6c65-4cb8-875e-36409af77520",
  quoteId: "c71e40b6-2c85-4cae-9fad-b73fb5a48e24",
  customerId: "5d232425-019c-457a-9465-d0842d8d9de3",
  totalAmount: 370000,
  createdAt: "2026-08-19T00:20:02.747Z",
  terms: [{ stepId: "payment_terms", label: "Payment terms", value: "50 / 50" }],
  contractor: {
    name: "Slice G Contractor",
    businessName: "SLICE G LLC",
    phoneNumber: "+15125556600",
    email: "sliceg.probe@blackhole.postmarkapp.com",
    commsLanguage: "en",
    hasLogo: false,
  },
  customer: { name: "Probe Customer", phoneNumber: "+15125556601" },
  jobDetails: {
    summary: "Paver patio installation 20x15",
    jobName: "Paver Patio",
    description: "Install a 20x15 paver patio",
    lineItems: [
      { description: "Paver patio", quantity: 1, unit: "job", price: 370000 },
    ],
  },
};

/** Fix shape B: same contract, with the quote-acceptance evidence the server
 *  must add to the public payload. */
const acceptedQuotePayload = {
  ...probedAfterQuoteAccept,
  quoteStatus: "approved", // what POST /quotes/:id/accept actually writes
  quoteAcceptedAt: "2026-08-19T00:20:09.000Z",
  quoteAcceptedName: "Probe Customer",
};

/** A genuinely open deal: linked quote merely sent — the ceremony is right. */
const openQuotePayload = {
  ...probedAfterQuoteAccept,
  quoteStatus: "sent",
};

/** Fix shape A arrives as a plain signed contract (status flipped by the
 *  quote-accept handler, or by the real /c ceremony — same shape). */
const signedContractPayload = {
  ...probedAfterQuoteAccept,
  status: "signed",
  signedAt: "2026-08-19T00:20:27.776Z",
  customerSignedName: "Probe Customer",
  customerSignature:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGNgYGD4z4AGmNAFRlgIXQAAiMkBB9dzbnMAAAAASUVORK5CYII=",
};

// ---------------------------------------------------------------------------
// UX-37 — one agreement, one ceremony
// ---------------------------------------------------------------------------

describe("UX-37 deriveContractView — an accepted /q kills the second /c ceremony", () => {
  it("UX-37 a quote-accepted (unsigned) contract must NOT be pending signature", () => {
    const view = deriveContractView(acceptedQuotePayload) as ReturnType<
      typeof deriveContractView
    > & {
      pendingSignature?: boolean;
      acceptedEvidence?: { at?: string; by?: string; via?: string };
    };
    // RED today: `pendingSignature` doesn't exist on the derived view
    // (undefined), so the /c page has nothing to consult and renders the pad.
    expect(view.pendingSignature).toBe(false);
  });

  it("UX-37 the accepted rendering carries the /q acceptance evidence (date + name, via quoteAccept)", () => {
    const view = deriveContractView(acceptedQuotePayload) as ReturnType<
      typeof deriveContractView
    > & {
      acceptedEvidence?: { at?: string; by?: string; via?: string };
    };
    expect(view.acceptedEvidence).toBeDefined();
    expect(view.acceptedEvidence?.via).toBe("quoteAccept");
    expect(view.acceptedEvidence?.at).toBe("2026-08-19T00:20:09.000Z");
    expect(view.acceptedEvidence?.by).toBe("Probe Customer");
  });

  it("UX-37 legacy quoteStatus 'accepted' counts as accepted too", () => {
    const view = deriveContractView({
      ...acceptedQuotePayload,
      quoteStatus: "accepted",
    }) as ReturnType<typeof deriveContractView> & {
      pendingSignature?: boolean;
    };
    expect(view.pendingSignature).toBe(false);
  });

  it("UX-37 a signed contract is never pending and evidences the contract ceremony", () => {
    const view = deriveContractView(signedContractPayload) as ReturnType<
      typeof deriveContractView
    > & {
      pendingSignature?: boolean;
      acceptedEvidence?: { at?: string; by?: string; via?: string };
    };
    // (signed:true is today's green behavior — kept; the red is the missing
    // unified pending/evidence contract.)
    expect(view.signed).toBe(true);
    expect(view.pendingSignature).toBe(false);
    expect(view.acceptedEvidence?.via).toBe("contractSign");
    expect(view.acceptedEvidence?.at).toBe("2026-08-19T00:20:27.776Z");
  });

  it("UX-37 a genuinely open deal (quote only sent) KEEPS the ceremony", () => {
    const view = deriveContractView(openQuotePayload) as ReturnType<
      typeof deriveContractView
    > & {
      pendingSignature?: boolean;
      acceptedEvidence?: unknown;
    };
    // RED today: undefined !== true. Post-fix the pad remains exactly here.
    expect(view.pendingSignature).toBe(true);
    expect(view.acceptedEvidence).toBeUndefined();
  });

  it("UX-37 today's evidence-free unsigned payload (verbatim probe) also derives pendingSignature=true", () => {
    // Standalone contracts (no linked-quote evidence at all) are the only
    // other legitimate fresh-ceremony case.
    const view = deriveContractView(probedAfterQuoteAccept) as ReturnType<
      typeof deriveContractView
    > & { pendingSignature?: boolean };
    expect(view.pendingSignature).toBe(true);
  });
});
