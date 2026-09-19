# 7.4 ◩ NW-28 — Signature block: named sentence in both languages, "↓" parity, PDF parity (S/M) · slug `nw-28-signature-parity`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 7.4) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** `quote-doc.tsx:250-269` forks on `lang === "en" && sig`; "you agree" appears only when no customer is bound (which NW-22 explains). The PDF (`render-quote-pdf/mod.ts:544-672`) has no "By signing below" sentence and titles the boxes "CONTRACTOR" / "CLIENT SIGNED" (`lang/*.json:2172-2173`).

- [ ] RED jest unit (`jest/unit/signature-block.test.ts`): `buildSignatureBlock({ …, lang:"es" })` returns the ES named sentence ("…{name} acepta…"), `By:`→`Por:`, `Date:`→`Fecha:`.
- [ ] RED e2e (`public-quote-signature.cy.ts`): ES view with a bound customer shows "acepta todo lo anterior" with the name; EN named instruction ends with "↓".
- [ ] EDIT `shared/quote-flow/signature-block.ts`: accept `lang`; `quote-doc.tsx:258-269` drop the `lang === "en"` forks; `render-quote-pdf/mod.ts:544-672` draw the sentence above the boxes and use `renderQuotePdf.sig.contractorSignature` "CONTRACTOR SIGNATURE" / `yourSignature` "YOUR SIGNATURE" (new keys, both dicts).

## Phase context (verbatim from the plan, `Phase 7 — Remaining medium items (no decision needed; any order; after Phases 1–5 if time is short)`)



## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- 04 SIGN HERE: "By signing below, Thing agrees to everything above." (currently "agree"). Contractor box: "CONTRACTOR SIGNATURE", business name (HANS LLC), the signature, "By: Hans Pedersen", "Date: May 23, 2026". Customer box: "YOUR SIGNATURE — Sign & type name below". Everything else the same. (The Spanish signed view already has this layout.) [p19]
  - **NW-28 ◩ the named sentence is already built and wired; the client saw the no-customer-name fallback. EN/ES layout divergence is not reproducible.** Effort S (M with PDF parity).
  - Evidence: `lang/en.json:805` `quoteDoc.bySigning` "By signing below, you agree…" and `:806` `bySigningNamed` "By signing below,
    {name} agrees…" (es `:806` "…{name} acepta…"); `shared/quote-flow/signature-block.ts:33-41` builds `agreementLine`, business
    heading, `By: <name>`, `Date: May 23, 2026`. `quote-doc.tsx:250-271` picks the named form whenever `customerName` resolves
    (`t.bySigning` `:147-150`), for **both** languages (one markup tree `:491-601`). `customerName` = `quote.customer?.name?.trim()`
    (`:222`) — so "you agree" appears only when no customer is bound, which lines up with NW-22. Contractor heading
    `quoteDoc.contractorSignature` (`:841`, CSS uppercase `:505-512`), `By:` `:804`, `Date:` `:843`, customer heading
    `quoteDoc.yourSignature` (`:906`, uppercase `:585-589`), subline `signTypeBelow` `:872`. Cosmetic divergences: EN-with-name
    instruction lacks the "↓" (`:269-271`); `sig.customer.heading` "YOUR Signature" is dead copy (card uses `t.yourSignature` `:588`).
    **PDF** (`render-quote-pdf/mod.ts:544-672`) has no "By signing below" sentence and uses "CONTRACTOR"/"CLIENT SIGNED"
    (`lang/en.json:2173/2172`); email HTML has no signature block.
  - Fix: default `clientName` to `acceptedName ?? customer.name` and drop the `lang === "en" && sig` fork; align the "↓"; add the
    sentence + "YOUR SIGNATURE" to the PDF block.
  - Tests: `jest/unit/signature-block.test.ts:20-40` green; `cypress/e2e/public-quote-signature.cy.ts:101-124` pins the named EN case.
    None for the no-name fallback, ES, or the PDF. `TDD-QUOTE-FLOW.md:41` row 18.

## Code at the cited lines (read from this tree while packaging)

### `front-end/components/quote-doc.tsx:250-269`

```
250:   const sig = customerName
251:     ? buildSignatureBlock({
252:       clientName: customerName,
253:       contractorName: contractorName ?? businessLabel,
254:       businessName: contractor?.businessName,
255:       signedDateISO: effective ?? new Date().toISOString(),
256:     })
257:     : undefined;
258:   const agreementLine = lang === "en" && sig
259:     ? sig.agreementLine
260:     : t.bySigning(customerName);
261:   const contractorByLine = contractorName
262:     ? (lang === "en" && sig
263:       ? sig.contractor.byLine
264:       : `${t.by} ${contractorName}`)
265:     : undefined;
266:   const contractorDateLine = lang === "en" && sig
267:     ? sig.contractor.dateLine
268:     : `${t.date} ${effective ? fmtDate(effective, lang) : t.today}`;
269:   const customerInstruction = lang === "en" && sig
```

### `backend/src/paperwork/domain/coordinators/render-quote-pdf/mod.ts:544-604`

```
544:     // Section: Signatures
545:     addPageIfNeeded(180);
546:     y -= 8;
547:     y = drawSectionHeader(
548:       page,
549:       y,
550:       M,
551:       "06",
552:       t(lang, "renderQuotePdf.section.signatures"),
553:       bold,
554:       PINK,
555:       TEAL,
556:     );
557:     y -= 16;
558:     const halfW = (W - 2 * M - 16) / 2;
559:     const sigBoxH = 90;
560: 
561:     // Contractor box
562:     page.drawRectangle({
563:       x: M,
564:       y: y - sigBoxH,
565:       width: halfW,
566:       height: sigBoxH,
567:       borderColor: LINE,
568:       borderWidth: 0.6,
569:     });
570:     // Roadmap p.8: CONTRACTOR / {business} / cursive signature / By: {name} / Date.
571:     page.drawText(t(lang, "renderQuotePdf.sig.contractor"), {
572:       x: M + 12,
573:       y: y - 14,
574:       size: 8,
575:       font: bold,
576:       color: MUTED,
577:     });
578:     page.drawText(biz, {
579:       x: M + 12,
580:       y: y - 28,
581:       size: 11,
582:       font: bold,
583:       color: INK,
584:     });
585:     page.drawText(contractor?.name ?? biz, {
586:       x: M + 12,
587:       y: y - 52,
588:       size: 16,
589:       font: ital,
590:       color: TEAL,
591:     });
592:     if (contractor?.name) {
593:       page.drawText(
594:         t(lang, "renderQuotePdf.sig.by", { name: contractor.name }),
595:         {
596:           x: M + 12,
597:           y: y - 70,
598:           size: 8,
599:           font: reg,
600:           color: MUTED,
601:         },
602:       );
603:     }
604:     page.drawText(
```

### `front-end/components/quote-doc.tsx:258-269`

```
258:   const agreementLine = lang === "en" && sig
259:     ? sig.agreementLine
260:     : t.bySigning(customerName);
261:   const contractorByLine = contractorName
262:     ? (lang === "en" && sig
263:       ? sig.contractor.byLine
264:       : `${t.by} ${contractorName}`)
265:     : undefined;
266:   const contractorDateLine = lang === "en" && sig
267:     ? sig.contractor.dateLine
268:     : `${t.date} ${effective ? fmtDate(effective, lang) : t.today}`;
269:   const customerInstruction = lang === "en" && sig
```
