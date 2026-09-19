# 1.13 ◩ NW-54 — "Terms and Conditions" heading on web + PDF (S) · slug `nw-54-terms-and-conditions-heading`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 1.13) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** Web page heads the clause list with `quoteDoc.terms` = "Terms" (`quote-doc.tsx:140`, used at `:457`); the PDF says "Fine print, in plain English"
(`renderQuotePdf.section.finePrint`, `lang/en.json:2165`, drawn at `render-quote-pdf/mod.ts:479`). The same key is also used on the public invoice (`routes/i/[id].tsx:438`).

- [ ] RED — jest unit: `i18n-dictionary-consistency.test.ts` add `it("REQ-NNN NW-54 the clause heading is Terms and Conditions")`:
      `en["quoteDoc.termsAndConditions"]` = "Terms and Conditions", `es[...]` = "Términos y Condiciones", and `en["renderQuotePdf.section.finePrint"]` = "Terms and Conditions" (es "Términos y Condiciones"). Run → fails.
- [ ] RED — e2e: `cypress/e2e/public-quote-signature.cy.ts` add: the `/q/:id` page `cy.contains("Terms and Conditions")` exists and `cy.contains("Fine print").should("not.exist")`. Run → fails.
- [ ] EDIT: add `quoteDoc.termsAndConditions` to both dicts; change `quote-doc.tsx:140` to `terms: tFor(lang, "quoteDoc.termsAndConditions")`;
      change the VALUE of `renderQuotePdf.section.finePrint` in both dicts (key stays). Leave `routes/i/[id].tsx:438` on `quoteDoc.terms` (the invoice grid is not the T&C list).
- [ ] Done when: web and PDF both say "Terms and Conditions" / "Términos y Condiciones". (NW-55 later wraps this section in an expandable `<details>`.)

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- Quote sent from the link: rename "fine print, in plain english" to "Terms and Conditions" and include the items from the previous slide and from slide 13. The contractor signature should carry the contractor's name. [p62]
  - **NW-54 ◩ 14 notices ✓, contractor name ✓, rename ✗ — and the web page and the PDF currently use two different names.** Effort S.
  - Evidence: PDF section 05 `renderQuotePdf.section.finePrint` (`lang/en.json:2165` "Fine print, in plain English" / es "Letra
    chica, en lenguaje claro", `render-quote-pdf/mod.ts:473-483`); web page heads the list with `quoteDoc.terms` (`:902` "Terms").
    No "Terms and Conditions"/"Términos y Condiciones" string exists. 14 clauses in the same order on both renderers
    (`quote-doc.tsx:99-114,465-477`; `render-quote-pdf:484-500`). Signature `quote-doc.tsx:505-531` + `signature-block.test.ts:26-35`.
  - Fix: one new key `quoteDoc.termsAndConditions` used at `quote-doc.tsx:456` and `render-quote-pdf:479`, both dicts.

## Code at the cited lines (read from this tree while packaging)

### `front-end/components/quote-doc.tsx:137-143`

```
137:     contractValue: tFor(lang, "quoteDoc.contractValue"),
138:     allIn: tFor(lang, "quoteDoc.allIn"),
139:     paymentSchedule: tFor(lang, "quoteDoc.paymentSchedule"),
140:     terms: tFor(lang, "quoteDoc.terms"),
141:     start: tFor(lang, "quoteDoc.start"),
142:     startTbd: tFor(lang, "quoteDoc.startTbd"),
143:     estCompletion: tFor(lang, "quoteDoc.estCompletion"),
```

### `front-end/components/quote-doc.tsx:454-460`

```
454:           {(() => {
455:             return (
456:               <section style="margin-top:36px">
457:                 <SectionHeader n={num()} title={t.terms} />
458:                 {
459:                   /* Always rendered: even a quote without wizard terms
460:                     keeps a Start row ("To be scheduled") so the schedule
```

### `lang/en.json:2162-2168`

```
2162:   "renderQuotePdf.recital.main": "Between {biz} (\"Contractor\") and {cust} (\"Client\")",
2163:   "renderQuotePdf.schedule.estimatedCompletion": "Estimated completion",
2164:   "renderQuotePdf.schedule.start": "Start",
2165:   "renderQuotePdf.section.finePrint": "Fine print, in plain English",
2166:   "renderQuotePdf.section.jobDetails": "Job details",
2167:   "renderQuotePdf.section.paymentSchedule": "Payment schedule",
2168:   "renderQuotePdf.section.schedule": "Schedule",
```

### `backend/src/paperwork/domain/coordinators/render-quote-pdf/mod.ts:476-482`

```
476:       y,
477:       M,
478:       "05",
479:       t(lang, "renderQuotePdf.section.finePrint"),
480:       bold,
481:       PINK,
482:       TEAL,
```

### `front-end/routes/i/[id].tsx:435-441`

```
435:                   <section style="margin-top:36px">
436:                     <SectionHeader
437:                       n={num()}
438:                       title={tFor(lang, "quoteDoc.terms")}
439:                     />
440:                     <TermGrid
441:                       startDate={invoice.startDate}
```
