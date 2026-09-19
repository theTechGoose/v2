# 7.7 ◩ NW-55 — Expandable "Terms and Conditions", a Cancelation row, and a Send dialog with Keep/Cancel (M) · slug `nw-55-agreement-presentation`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 7.7) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

(Invoice number: wait for 6.7.) **Why.** The clause `<ol>` is always open (`quote-doc.tsx:477-485`); cancelation is only clause 10 (`lang/*.json:833`) and lacks "work completed will be paid for";
the send channels are a caret menu with no title and no Keep/Cancel (`AsstChat.tsx:6374-6380`, keys `:316-319`).

- [ ] RED e2e (`public-quote-signature.cy.ts`): `details[data-cy=terms-details]` is collapsed on load, `summary` reads "Terms and Conditions", clicking opens 14 `li`; the term grid has a "Cancelation" row containing "7 days"; (`ux-send-moment.cy.ts`) clicking Send opens `[data-cy=send-dialog]` titled "How do you want to send to customer?" with three channel options and Keep / Cancel; Cancel closes without sending.
- [ ] RED jest unit (dictionary): `quoteDoc.clause.termination.body` ends with "Work completed before cancelation will be paid for." (es "El trabajo realizado antes de la cancelación se pagará."); same for the PDF twin.
- [ ] EDIT `quote-doc.tsx:477-485`: wrap the `<ol>` in `<details data-cy="terms-details"><summary>{t.terms}</summary>…</details>` (PDF stays flat); add a `cancellation` row to the term grid (`AsstChat.tsx:486-493` term rows + `TermGrid` labels, key `quoteDoc.termLabel.cancellation` "Cancelation" / "Cancelación", value "7 days' notice" / "Aviso de 7 días").
- [ ] EDIT `AsstChat.tsx:6374-6420`: promote the caret menu to a modal (`data-cy="send-dialog"`) with title key `asstChat.send.howTitle`, the existing three channel keys, `asstChat.send.keep` "Keep" / "Guardar" (saves the choice, sends), `asstChat.send.cancel` "Cancel" / "Cancelar".

## Phase context (verbatim from the plan, `Phase 7 — Remaining medium items (no decision needed; any order; after Phases 1–5 if time is short)`)



## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- Quote sent from the link: rename "fine print, in plain english" to "Terms and Conditions" and include the items from the previous slide and from slide 13. The contractor signature should carry the contractor's name. [p62]
  - **NW-54 ◩ 14 notices ✓, contractor name ✓, rename ✗ — and the web page and the PDF currently use two different names.** Effort S.
  - Evidence: PDF section 05 `renderQuotePdf.section.finePrint` (`lang/en.json:2165` "Fine print, in plain English" / es "Letra
    chica, en lenguaje claro", `render-quote-pdf/mod.ts:473-483`); web page heads the list with `quoteDoc.terms` (`:902` "Terms").
    No "Terms and Conditions"/"Términos y Condiciones" string exists. 14 clauses in the same order on both renderers
    (`quote-doc.tsx:99-114,465-477`; `render-quote-pdf:484-500`). Signature `quote-doc.tsx:505-531` + `signature-block.test.ts:26-35`.
  - Fix: one new key `quoteDoc.termsAndConditions` used at `quote-doc.tsx:456` and `render-quote-pdf:479`, both dicts.

- **Job Quote & Agreement layout** [p63]
  - Invoice number. Job Details (e.g. "Kitchen backsplash tile install 30 sq ft, porcelain tile"; Start: ASAP; Time to complete: 2–3 days). Payment (Total $1,200: $600 to start, $600 when the job is done). Warranty (6-month workmanship warranty). Cancelation (either side can cancel with 7-day notice; work completed will be paid for).
  - At the bottom, an expandable "Terms & Conditions" containing all the required notices from slide 13.
  - The quote has a pencil and is editable.
  - "Send to client" opens "How do you want to send to customer?" with Text / Email / Text + Email and Keep / Cancel.
  - **NW-55 ◩ content ✓, pencil ✓; four presentation asks missing.** Effort M.
  - Done: Job Details + term grid (`quote-doc.tsx:415-433,456-464`, labels `lang/en.json:885-887`); payment schedule
    (`:436-442`, `doc-parts.tsx:337+`); warranty row + clause (`:886`, `:835-836`); pencil (`static/assistant-page.css:6512-6540`,
    `AsstChat.tsx:5666,5681,5704,6137,6176`).
  - Missing: (1) **invoice number** — only a derived `#{id.slice(0,8)}` (`quote-doc.tsx:325`, `AsstChat:5393-5400`,
    `InvoicesPage:207` `INV-…`, public invoice footer only `routes/i/[id].tsx:557-562`); no stored sequence anywhere.
    (2) **Cancelation row** — exists only as clause 10 (`lang/en.json:833-834` "Either party may cancel … 7 days' written notice")
    and the "work completed will be paid for" half is absent; no `cancellation` term row (`AsstChat.tsx:486-493`).
    (3) **Expandable T&C** — zero `<details>/<summary>/aria-expanded` in `quote-doc.tsx`/`doc-parts.tsx`/`routes/q/[id].tsx`; clauses are an always-open `<ol>` (`:465-477`).
    (4) **Send dialog** — the three channels exist as a caret dropdown (`AsstChat.tsx:701-702`, `:6266-6290`, menu `:6375`,
    `lang/en.json:316-319` "Text + Email"/"Text only"/"Email only"/"Copy link") with no title and **no Keep/Cancel** (zero hits for `"Keep`).
  - Fix: `<details>` wrapper headed by NW-54's key; append the paid-for-work sentence to `termination.body` (web + PDF keys, both
    dicts); promote the caret menu to a modal with Keep/Cancel (`:6266-6420`); decide whether a real invoice number sequence is wanted.
  - Tests: `ux-send-moment.cy.ts`, `ux-doc-preview.cy.ts`, `public-quote-signature.cy.ts`, `invoice-parity.cy.ts`. None pin the four missing items.

## Code at the cited lines (read from this tree while packaging)

### `front-end/components/quote-doc.tsx:477-485`

```
477:                 <ol
478:                   style={`margin:22px 0 0;padding-left:20px;color:${INK};font-size:14px;line-height:1.65`}
479:                 >
480:                   {t.clauses.map(([title, body]) => (
481:                     <li key={title}>
482:                       <strong>{title}.</strong> {body}
483:                     </li>
484:                   ))}
485:                 </ol>
```

### `front-end/islands/AsstChat.tsx:6374-6380`

```
6374:                                   <div
6375:                                     class="quote-review__send-menu"
6376:                                     role="menu"
6377:                                   >
6378:                                     <button
6379:                                       type="button"
6380:                                       role="menuitem"
```

### `front-end/islands/AsstChat.tsx:316-319`

```
316:   if (/payment|venmo|zelle|cash app|how.*get paid/.test(text)) {
317:     return tFor(lang, "asstChat.composer.payment");
318:   }
319:   return tFor(lang, "asstChat.composer.default");
```

### `front-end/islands/AsstChat.tsx:486-493`

```
486: const TERM_LABEL_KEYS: Record<string, string> = {
487:   config: "asstChat.preview.termLabel.config",
488:   start_date: "asstChat.preview.termLabel.startDate",
489:   wraps: "asstChat.preview.termLabel.wraps",
490:   time_to_complete: "asstChat.preview.termLabel.timeToComplete",
491:   payment_terms: "asstChat.preview.termLabel.payment",
492:   warranty: "asstChat.preview.termLabel.warranty",
493: };
```

### `front-end/islands/AsstChat.tsx:6374-6420`

```
6374:                                   <div
6375:                                     class="quote-review__send-menu"
6376:                                     role="menu"
6377:                                   >
6378:                                     <button
6379:                                       type="button"
6380:                                       role="menuitem"
6381:                                       class={`quote-review__send-menu-item${
6382:                                         sendChannel === "both"
6383:                                           ? " is-current"
6384:                                           : ""
6385:                                       }`}
6386:                                       onClick={() => {
6387:                                         setSendChannel("both");
6388:                                         setChannelMenuOpen(false);
6389:                                       }}
6390:                                     >
6391:                                       <I d={ICN.send} size={13} sw={2.4} />
6392:                                       <span class="quote-review__send-menu-label">
6393:                                         {tFor(
6394:                                           previewLang,
6395:                                           "asstChat.preview.menuBoth",
6396:                                         )}
6397:                                       </span>
6398:                                       <span class="quote-review__send-menu-tag">
6399:                                         {tFor(
6400:                                           previewLang,
6401:                                           "asstChat.preview.recommended",
6402:                                         )}
6403:                                       </span>
6404:                                     </button>
6405:                                     <button
6406:                                       type="button"
6407:                                       role="menuitem"
6408:                                       class={`quote-review__send-menu-item${
6409:                                         sendChannel === "sms"
6410:                                           ? " is-current"
6411:                                           : ""
6412:                                       }`}
6413:                                       onClick={() => {
6414:                                         setSendChannel("sms");
6415:                                         setChannelMenuOpen(false);
6416:                                       }}
6417:                                     >
6418:                                       <I d={ICN.phone} size={13} sw={2.4} />
6419:                                       <span class="quote-review__send-menu-label">
6420:                                         {tFor(
```
