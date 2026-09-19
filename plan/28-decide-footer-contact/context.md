# 6.1 ❓ NW-02 — Whose contact goes in the customer-doc footer? (S once decided) · slug `nw-02-footer-contact`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 6.1) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

The p24 ask (house `hello@paperworkmonster.com` / `866-767-8399`) reverses the p61 item that shipped ("Questions before signing? Call <contractor phone> or email <contractor email>").
Today the footer is one component gated on the contractor having a phone or email: `front-end/components/quote-doc.tsx:696-742` and `front-end/routes/i/[id].tsx:508-548`.

- If **house contact** wins:
  - [ ] RED unit: new `jest/unit/support-contact.test.ts` → `SUPPORT_CONTACT` from `shared/quote-flow/support-contact.ts` equals `{ email: "hello@paperworkmonster.com", phone: "866-767-8399" }` and `telHref(SUPPORT_CONTACT.phone) === "tel:+18667678399"`.
  - [ ] RED e2e: `public-quote-signature.cy.ts` and `invoice-parity.cy.ts`: the footer contains `866-767-8399` and `hello@paperworkmonster.com` even for a contractor with no email on file.
  - [ ] EDIT: create the constants module; in both footers drop the gate and render the house values (keep the `qBefore`/`qSigned` variant switch, `public-doc-state.ts:32-69`); leave `public-controller` and the From block alone.
- If **contractor contact** stays: close NW-02 as "by design, per p61"; no code.

## Phase context (verbatim from the plan, `Phase 6 — ❓ Decisions the client must make, with the work each answer unlocks`)

Send §10 (the message at the bottom) to the client. Do not start these tasks until the answer is back; everything above is unblocked meanwhile.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- **NW-02 vs p61 COMPLETED:** house contact (`hello@paperworkmonster.com` / 866-767-8399) on the customer doc footer directly
  reverses the earlier "Questions before signing? Call <contractor phone> or email <contractor email>" item that shipped.

- Footer contact info should be email `hello@paperworkmonster.com` and phone `866-767-8399`. (Screenshot: the "Questions about your project?" footer currently shows the contractor's own phone and gmail.) [p24]
  - **NW-02 ⬜ NOT BUILT + ❓ contradicts p61 COMPLETED.** Effort S (M with the decision).
  - Evidence: the footer is one component, `front-end/components/quote-doc.tsx:695-742`, gated on `contractor?.phoneNumber || contractor?.email`,
    rendering `quoteDoc.qBefore` ("Questions before signing?", `lang/en.json:868`) or `quoteDoc.qSigned` ("Questions about your
    project?", `:869`; variant from `shared/quote-flow/public-doc-state.ts:32-69`) + `callWord`/`orWord`/`emailWord`/`lookForward`
    (`:807/:862/:848/:853`). The values come from the contractor's *user row*: `backend/src/paperwork/entrypoints/public-controller/mod.ts:906-934`
    `loadContractor` → `phoneNumber: user?.phoneNumber, email: user?.email`. Same footer duplicated on the public invoice
    `front-end/routes/i/[id].tsx:507-546` (`publicInvoice.footer.*`, `lang/en.json:1808-1813`). Zero hits for
    `hello@paperworkmonster.com` anywhere; the only 866 number is the landing footer `routes/index.tsx:1220`.
  - Cause: by design — the p61 "COMPLETED" item ("Call 540-333-1334 or email hp@hans.work!") is this template filled with Hans's
    own profile. The new ask reverses that policy.
  - Fix (if house contact wins): `shared/quote-flow/support-contact.ts` constants; swap them in at `quote-doc.tsx:695-742` and
    `routes/i/[id].tsx:507-546`; drop the render gate so the footer always shows. Leave `public-controller` alone — the From block
    (NW-06) still needs the contractor's contact.
  - Tests: `jest/unit/public-doc-state.test.ts:144-152` + `cypress/e2e/public-doc-state.cy.ts:305-318` pin the variant switch only.

- 04 Sign Here: "By signing below, you agree to everything above." "Contractor Signature" not "Contractor Signed". Footer: "Questions before signing? Call 540-333-1334 or email hp@hans.work! I look forward to working with you." [p61]
  - **✅ VERIFIED** (section number is 05 because of p57's leftover) — `lang/en.json:805-806`, `quote-doc.tsx:497-503`; `contractorSignature` `:841`/`:511`; footer templated from the contractor profile `quote-doc.tsx:712-740`. **Conflicts with NW-02.**

## Code at the cited lines (read from this tree while packaging)

### `front-end/components/quote-doc.tsx:696-742`

```
696:           {(contractor?.phoneNumber || contractor?.email) && (
697:             <footer
698:               style={`margin-top:36px;padding-top:22px;border-top:1px solid ${LINE};display:flex;align-items:flex-start;gap:14px;flex-wrap:wrap`}
699:             >
700:               <div
701:                 style={`width:44px;height:44px;border-radius:50%;background:linear-gradient(135deg,${GREEN} 0%,#71a85f 100%);color:#fff;font-weight:800;font-size:14px;display:flex;align-items:center;justify-content:center;letter-spacing:.04em;flex-shrink:0`}
702:               >
703:                 {senderInitials}
704:               </div>
705:               <div style="min-width:0;flex:1">
706:                 <div style={`color:${INK};font-size:14px;line-height:1.5`}>
707:                   {
708:                     /* P-63: once accepted, the footer stops asking "Questions
709:                       before signing?" — deriveQuoteView's footerVariant
710:                       picks the post-signed copy. */
711:                   }
712:                   {view.footerVariant === "signed" ? t.qSigned : t.qBefore}{" "}
713:                   {contractor?.phoneNumber && (
714:                     <>
715:                       {t.callWord}{" "}
716:                       <a
717:                         href={telHref(contractor.phoneNumber)}
718:                         style={`color:${TEAL};text-decoration:none;font-weight:700;white-space:nowrap`}
719:                       >
720:                         {fmtPhone(contractor.phoneNumber)}
721:                       </a>
722:                     </>
723:                   )}
724:                   {contractor?.phoneNumber && contractor?.email ? t.orWord : ""}
725:                   {contractor?.email && (
726:                     <>
727:                       {t.emailWord} {
728:                         /* P-58: long contractor emails overflowed the 390px
729:                           viewport — the address may break mid-string so it
730:                           never paints past the card edge. */
731:                       }
732:                       <a
733:                         href={`mailto:${contractor.email}`}
734:                         style={`color:${TEAL};text-decoration:none;font-weight:700;overflow-wrap:anywhere;word-break:break-all`}
735:                       >
736:                         {contractor.email}
737:                       </a>
738:                     </>
739:                   )}
740:                   {t.lookForward}
741:                 </div>
742:               </div>
```

### `front-end/routes/i/[id].tsx:508-548`

```
508:           {(invoice.contractor?.phoneNumber || invoice.contractor?.email)
509:             ? (
510:               <footer
511:                 style={`margin-top:30px;padding-top:22px;border-top:1px solid ${LINE};color:${INK};font-size:14px;line-height:1.5`}
512:               >
513:                 <span data-invoice-question>
514:                   {tFor(lang, "publicInvoice.footer.questions")}
515:                 </span>{" "}
516:                 {invoice.contractor.phoneNumber
517:                   ? (
518:                     <>
519:                       {tFor(lang, "publicInvoice.footer.call")}{" "}
520:                       <a
521:                         href={telHref(invoice.contractor.phoneNumber)}
522:                         style={`color:${TEAL};text-decoration:none;font-weight:700;white-space:nowrap`}
523:                       >
524:                         {fmtPhone(invoice.contractor.phoneNumber)}
525:                       </a>
526:                     </>
527:                   )
528:                   : null}
529:                 {invoice.contractor.phoneNumber && invoice.contractor.email
530:                   ? tFor(lang, "publicInvoice.footer.or")
531:                   : ""}
532:                 {invoice.contractor.email
533:                   ? (
534:                     <>
535:                       {tFor(lang, "publicInvoice.footer.email")}{" "}
536:                       <a
537:                         href={`mailto:${invoice.contractor.email}`}
538:                         style={`color:${TEAL};text-decoration:none;font-weight:700`}
539:                       >
540:                         {invoice.contractor.email}
541:                       </a>
542:                     </>
543:                   )
544:                   : null}
545:                 {tFor(lang, "publicInvoice.footer.closing")}
546:               </footer>
547:             )
548:             : null}
```

### `shared/quote-flow/public-doc-state.ts:32-69`

```
32:   footerVariant: "beforeSigning" | "signed";
33:   /** Present once accepted (P-63). */
34:   pdfUrl?: string;
35:   /** True ONLY when a fresh signature ceremony is appropriate: the quote is
36:    *  neither accepted nor declined — one deal, one ceremony (UX-37). */
37:   pendingSignature: boolean;
38: }
39: 
40: /** Derive the /q/:id view state from the public quote payload. */
41: export function deriveQuoteView(payload: PublicQuotePayloadLike): QuoteView {
42:   const customerName = payload.customer?.name ?? "";
43:   if (isAccepted(payload)) {
44:     const view: QuoteView = {
45:       mode: "accepted",
46:       customerName,
47:       footerVariant: "signed",
48:       pdfUrl: `/api/quotes/${payload.id}/pdf`,
49:       pendingSignature: false,
50:     };
51:     if (payload.acceptedName) view.acceptedBy = payload.acceptedName;
52:     if (payload.acceptedAt) view.acceptedAt = payload.acceptedAt;
53:     if (payload.acceptedSignature) {
54:       view.signatureImage = payload.acceptedSignature;
55:     }
56:     return view;
57:   }
58:   if (payload.status === "lost") {
59:     return {
60:       mode: "declined",
61:       customerName,
62:       footerVariant: "beforeSigning",
63:       pendingSignature: false,
64:     };
65:   }
66:   return {
67:     mode: "open",
68:     customerName,
69:     footerVariant: "beforeSigning",
```
