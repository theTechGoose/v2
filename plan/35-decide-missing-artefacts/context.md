# 6.8 ❓ Need the artefact before anything can be done

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 6.8) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

- **NW-21 "Yam"** — the string exists nowhere in the repo. Most likely the new-customer *value* was prefilled from your sentence ("…for Yam…" → `extractCustomerName`, `shared/quote-flow/quick-quote-prefill.ts:66-98`). Please send the screenshot or the sentence you typed.
- **NW-53c logo** — send the new artwork (PNG/SVG). `front-end/static/logo-monster.png` is what ships; `components/ui/Brand.tsx` renders a text "P" mark.
- **NW-53g "Quote and Agreement change"** — the bullet is empty; what change?
- **NW-57 "Contract for new job"** — that sentence is not in the code; screenshot please.
- **NW-46 "Quote & Agreement - Final.docx"** — not in the repo; attach it.

## Phase context (verbatim from the plan, `Phase 6 — ❓ Decisions the client must make, with the work each answer unlocks`)

Send §10 (the message at the bottom) to the client. Do not start these tasks until the answer is back; everything above is unblocked meanwhile.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- **NW-21 "Yam"**, **NW-53c logo**, **NW-53g "Quote and Agreement change"**, **NW-57 "Contract for new job"** need the
  screenshot / asset / sentence — nothing in the repo matches.

- The new-customer name field placeholder says "Yam". [p14]
  - **NW-21 ⚠ CANNOT VERIFY — "Yam" occurs nowhere in the repo except this transcript.** Effort S once located.
  - Evidence: placeholder = `tFor("asstChat.customerStep.name")` (`AsstChat.tsx:7778`, used `:7786-7787`; `lang/en.json:193` "Name" /
    `es` "Nombre"); `tFor` falls back to the key, never to arbitrary text (`front-end/lib/i18n.ts:33-36`). Most likely the client
    saw a prefilled *value*: `initialName → createName → value={createName}` (`:7666-7672`, `:7788`) from `prefillCustomerName`
    (`:4742`, `:6729`) ← `extractCustomerName()` (`shared/quote-flow/quick-quote-prefill.ts:66-98`, lifts Capitalized tokens after
    "for"/"para"; carried via `sessionStorage pm:custprefill:<convId>` `:2197-2203`). A sentence containing "…for Yam…" yields exactly "Yam".
  - Fix: need the screenshot or typed sentence. If prefill, tighten `extractCustomerName`. Tests: `jest/unit/ux-quick-quote-prefill.test.ts`.

- Refer to the doc "Quote & Agreement - Final.docx". [p43]
  - **NW-46 ⚠** the .docx is not in the repo (`TDD-QUOTE-FLOW.md:87-91` flags it). The concrete asks from it are NW-54…NW-57.

- **Overall tasks** [p60]
  - After picking one of the three initial options, the next thing for all three is the "Job Details" question. For at least the "I know my price" flow the input bar is then hidden.
    - **NW-53a ✅** all four starters `setAwaitingJobDetails(true)` (`AsstChat.tsx:3225-3316`); after details the price step opens and
      `priceCaptureOpen` is the first term of `composerHidden`. Test `quotes-help-me-price.cy.ts:33-37`.
  - Once a structured flow starts (have a price, have job details, or simple quote), hide the bottom input field after the job description or any required question is answered. If they are tapping options there should be no input field.
    - **NW-53b ✅** `composerHidden` `AsstChat.tsx:7239-7275` (price, job options, invoice steps, any unanswered wizard card, preview CTA).
      No spec asserts the composer is *absent* — worth one negative pin.
  - Update the logo.
    - **NW-53c ⚠** no new asset in the repo; `front-end/static/logo-monster.png` last changed `8d7d222` (2026-08-18).
      `components/ui/Brand.tsx` renders a text "P" mark, not the image — already out of step. `format-helpers.test.ts` caps
      `logo-email.png` < 300 KB (now 229 KB). Needs the artwork.
  - "Paperwork Monsters" → "Paperwork Monster" (drop the s).
    - **NW-53d ✅ in shipped code** (`lang/*.json:473` `brand.name`, `site-meta.ts:19`, `manifest.webmanifest`, `verify-otp:108,119`,
      `send-paperwork-email:422`); 4 stragglers only in the non-served `front-end/ui-breakdown/pages/landing/js/landing-scripts.js:140,147,279,287`.
  - Starting a new conversation with "have price, need job details" should auto-focus the input.
    - **NW-53e ✅** synchronous focus in the click (`AsstChat.tsx:3232-3234`) + effect fallback (`:1436-1442`) + `composer--flash`.
      `cypress quotes-help-me-price.cy.ts:36` checks visible, not focused.
  - Pricing: auto-focus the number field, and pressing Enter on the price should click Continue.
    - **NW-53f ✅** for "I know my price" (`MoneyInput.tsx:73-77` autofocus, `:147-150` Enter → `onSubmit` = `onPriceContinue`,
      `AsstChat.tsx:4845-4851`); autofocus is deliberately **off** in help-me-price (`autoFocus={!suggestPricing}`) — drop the guard
      if wanted there too. Test `quotes-help-me-price.cy.ts:71-73`.
  - ***We need a Quote and Agreement change.
    - **NW-53g ❓** no content in the bullet; presumably the antecedent of NW-54/NW-55/NW-57.

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

### `shared/quote-flow/quick-quote-prefill.ts:66-98`

```
66:     const tokens = rest.split(/\s+/);
67:     let household = false;
68:     let i = 0;
69:     if (tokens[0] && /^familia$/i.test(tokens[0])) {
70:       household = true;
71:       i = 1;
72:     }
73:     const run: string[] = [];
74:     let stopped = false;
75:     for (; i < tokens.length && !stopped; i++) {
76:       let tok = tokens[i];
77:       if (!tok) break;
78:       if (/^[$\d]/.test(tok)) break;
79:       if (/[,;:.]$/.test(tok)) {
80:         tok = tok.replace(/[,;:.]+$/, "");
81:         stopped = true;
82:       }
83:       if (!CAP_TOKEN.test(tok)) {
84:         // EN postfix household word closes the run.
85:         if (run.length > 0 && /^family$/i.test(tok)) {
86:           run.push(tok.toLowerCase());
87:         }
88:         break;
89:       }
90:       run.push(tok);
91:     }
92:     if (run.length === 0) continue;
93:     if (household) return `Familia ${run.join(" ")}`;
94:     return run.join(" ");
95:   }
96:   return null;
97: }
98: 
```
