# 7.8 ◩ NW-57 — Agreement header: "<Customer>'s <Job> Agreement", job name in the parties line, "Quick Summary" (M) · slug `nw-57-agreement-header` — after 6.6

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 7.8) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** `heroTitle` is the raw job name (`quote-doc.tsx:239-242`); the parties line (`:361-378`) has no job name; "New job" leaks from `generateJobOptions.newJob`/`asstChat.newJob`; "Quick Summary" does not exist (`quoteDoc.plainEnglish` `:864`).

- [ ] RED e2e (`public-quote-signature.cy.ts`): `h1` reads "Godzilla's Concrete Patio Agreement" for customer Godzilla + job "Concrete Patio"; the parties line contains the job name; the section reads "Quick Summary". RED jest unit (`ux-page-copy.test.ts`): a new pure `agreementTitle({customer, job, lang})` → EN "Godzilla's Concrete Patio Agreement", ES "Acuerdo de Concrete Patio de Godzilla".
- [ ] EDIT: new helper in `shared/quote-flow/agreement-title.ts`; `quote-doc.tsx:240-242` use it when a customer is bound; `:363-367` interpolate the job name (new key `quoteDoc.betweenFor` "Between {contractor} and {customer} for {job}"); `quoteDoc.plainEnglish` → "Quick Summary" / "Resumen rápido"; mirror the title in `render-quote-pdf`. Replace the "New job" fallbacks with the job name when one exists.

## Phase context (verbatim from the plan, `Phase 7 — Remaining medium items (no decision needed; any order; after Phases 1–5 if time is short)`)



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

## Code at the cited lines (read from this tree while packaging)

### `front-end/components/quote-doc.tsx:239-242`

```
239:   const jobNameRaw = (quote.jobNameByLang?.[lang] ?? quote.jobName)?.trim();
240:   const heroTitle = (jobNameRaw && jobNameRaw.length > 0)
241:     ? jobNameRaw
242:     : summary.replace(/\b\w/g, (c) => c.toUpperCase());
```

### `front-end/components/quote-doc.tsx:361-378`

```
361:           {customerName && (
362:             <div style={`margin-top:10px;color:${MUTED};font-size:14px`}>
363:               {t.between}{" "}
364:               <strong style={`color:${INK}`}>{businessLabel}</strong>{" "}
365:               {t.contractorTag} {t.and}{" "}
366:               <strong style={`color:${INK}`}>{customerName}</strong>{" "}
367:               {t.clientTag}
368:               {effective
369:                 ? (
370:                   <>
371:                     {" "}· {t.effective}{" "}
372:                     <strong style={`color:${INK}`}>
373:                       {fmtDate(effective, lang)}
374:                     </strong>
375:                   </>
376:                 )
377:                 : null}
378:             </div>
```

### `front-end/components/quote-doc.tsx:240-242`

```
240:   const heroTitle = (jobNameRaw && jobNameRaw.length > 0)
241:     ? jobNameRaw
242:     : summary.replace(/\b\w/g, (c) => c.toUpperCase());
```

### `front-end/components/quote-doc.tsx:363-367`

```
363:               {t.between}{" "}
364:               <strong style={`color:${INK}`}>{businessLabel}</strong>{" "}
365:               {t.contractorTag} {t.and}{" "}
366:               <strong style={`color:${INK}`}>{customerName}</strong>{" "}
367:               {t.clientTag}
```
