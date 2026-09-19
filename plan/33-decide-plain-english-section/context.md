# 6.6 ❓ p57 vs p82 — "01 The deal in plain English": delete it (p57) or rename it "Quick Summary" (p82, NW-57)?

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 6.6) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

Today it renders (`quote-doc.tsx:411`, `quoteDoc.plainEnglish` `lang/*.json:864`), which also pushes Payment Schedule to 03 and Terms to 04. Pick one; the rename is part of 7.8, the delete is a 10-line removal in `quote-doc.tsx` + renumbering.

## Phase context (verbatim from the plan, `Phase 6 — ❓ Decisions the client must make, with the work each answer unlocks`)

Send §10 (the message at the bottom) to the client. Do not start these tasks until the answer is back; everything above is unblocked meanwhile.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- **NW-21 "Yam"**, **NW-53c logo**, **NW-53g "Quote and Agreement change"**, **NW-57 "Contract for new job"** need the
  screenshot / asset / sentence — nothing in the repo matches.

- **Agreement header edits** [p82]
  - The job name goes between Contractor name and Client.
  - "New Job" → "Godzilla's Concrete Patio Agreement".
  - "Between Paperwork Monster and Godzilla effective May 7, 2026".
  - "The Deal in Plain English" → "Quick Summary".
  - "Contract for new job" → should be the job name (we have no job details at that point).
  - **NW-57 ◩ 1 of 5 done.** Effort M.
  - Header order `quote-doc.tsx:285-414`: logo/business eyebrow → doc-tag pill `#{id}` + status pill → `<h1>{heroTitle}` →
    parties line → To/From cards → "01 The deal in plain English".
    ✅ "Between … effective …" — `:361-378` (`quoteDoc.between/and/effective`, `lang/en.json:802,800,847`; es "Entre"/"y"/"vigente").
    ❌ job name in the parties line — absent (`:361-378`). ❌ "<Customer>'s <Job> Agreement" — `heroTitle` `:240-242` is the raw
    job name; "New job" leaks from `generateJobOptions.newJob` (`lang/en.json:1100`, `generate-job-options:244`),
    `polishJobDetails.fallbackSummary` (`:1709`), `asstChat.newJob` (`:271`, `AsstChat.tsx:230,1900,1939,2103,2258,3429`).
    ❌ "Quick Summary" — `quoteDoc.plainEnglish` (`:864` "The deal in plain English" / es "El trato en palabras simples"), zero hits
    for "Quick summary"/"Resumen rápido". ⚠ "Contract for new job" — no such string in any `.ts/.tsx/.json`; best candidate is the
    thread title fallback at `AsstChat.tsx:3429`; needs the screenshot.
  - Fix: retitle `plainEnglish` in both dicts; new `quoteDoc.agreementTitle` "{customer}'s {job} Agreement" / "Acuerdo de {job} de
    {customer}" driving `heroTitle`; interpolate the job name into `:361-378`; mirror in `render-quote-pdf`. Tests
    `public-quote-signature.cy.ts` (row 16), `ux-page-copy.test.ts`.

- Remove all the Excel sub-headers and the "in plain English" sub-header. 02 Payment Schedule and 03 Terms stay the same, updated to match the Dragon's quote-preview comments. Fine print includes only items 1–14. [p57]
  - **◩ PARTIAL** — 14 items ✓; but "01 The deal in plain English" still renders (`quote-doc.tsx:411`, `quoteDoc.plainEnglish`
    `lang/en.json:864`), so Payment Schedule is 03 and Terms 04; the Description/Qty/Amount table header is still forced
    (`quote-doc.tsx:420-433` → `doc-parts.tsx:426-445`, `lang/en.json:880-882`). Ties to NW-57's "Quick Summary".

## Code at the cited lines (read from this tree while packaging)

### `front-end/components/quote-doc.tsx:408-414`

```
408:               stating who does what for whom, before the itemized sections. */
409:           }
410:           <section style="margin-top:36px">
411:             <SectionHeader n={num()} title={t.plainEnglish} />
412:             <p style={`margin:0;color:${INK};font-size:15px;line-height:1.6`}>
413:               {t.plainEnglishBody(businessLabel, customerName)}
414:             </p>
```
