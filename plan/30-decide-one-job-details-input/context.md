# 6.3 ❓ NW-04 + NW-07 — On the job-details step, which input survives: the chat composer or the "Write it myself" box? (M) · slug `nw-04-one-details-input`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 6.3) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

Both render today: the composer (`AsstChat.tsx:7262-7286` deliberately keeps it visible and flashes it) and the "✎ Write it myself" pill + editor (`:4402-4432`). Only the box owns "Professionalize that" (`:4505-4535`).
The rest of the roadmap treats the composer as the details input (p60 "input bar", p66 "Talk or type", voice memos live there).

- **Option A (recommended) — keep the composer, delete the step-1 box.** Professionalizing still exists per bullet in the picker (NW-41 ✅) and in the picker's own "Write it myself" tile.
  - [ ] RED e2e: `cypress/e2e/quotes-professionalize.cy.ts:25-27` → after submitting details via the composer, click the picker's "Write it myself" tile and expect `[data-cy=professionalize-btn]` there. `cypress/e2e/ux-help-me-price.cy.ts` gets `cy.get(".chat__details-writeself").should("not.exist")`.
  - [ ] EDIT: delete `:4402-4432` and `openWriteMyself`/`writeMyselfOpen` state if nothing else uses it; if the picker's custom tile editor (`:4163-4200`) lacks the Professionalize button, move the `:4505-4535` block into it. Delete `.chat__details-writeself` CSS (`assistant-page.css:8224-8241`). (This supersedes 1.9.)
- **Option B — keep the box, hide the composer on that step.**
  - [ ] EDIT `:7262`: add `|| (awaitingJobDetails && !submittedJobDetails) || writeMyselfOpen` to `composerHidden`; give the box a mic button (voice currently only lives on the composer, `sendVoice` `:1792`).
  - [ ] RED e2e: `ux-help-me-price.cy.ts:66-69` types into the box instead of `textarea.composer__input`.

## Phase context (verbatim from the plan, `Phase 6 — ❓ Decisions the client must make, with the work each answer unlocks`)

Send §10 (the message at the bottom) to the client. Do not start these tasks until the answer is back; everything above is unblocked meanwhile.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- **NW-04 / NW-07:** on the job-details step, does the composer or the "Write it myself" box survive? Only the box owns
  "Professionalize that"; a green Cypress spec pins each.

- Both the "Write it myself" box and the "Ex: Customer wants a 10x10…" placeholder appear. What is the difference? We don't need both. [p3]
  - **NW-04 🐛 CONFIRMED — two independent affordances on one step; neither hides the other.** Effort M (small edit, product call).
  - Evidence: job-details step `AsstChat.tsx:4327-4366` (bubble + `asstChat.composer.hint`, `lang/en.json:167`); the "✎ Write it
    myself" button `:4399-4412` (`asstChat.jobOpts.customTitle`, `lang/en.json:256` "Write it myself" / `es.json:256` "Escribirlo yo
    mismo") opening the one-item-per-line editor (`customPlaceholder` `:255`, `writeSelf.hint` `:437`); the composer `:7331-7343`
    with `composerPlaceholder()` → `:319` `asstChat.composer.default` (`lang/en.json:164` "Ex: Customer wants a 10'x10' slab, what
    should I charge?"). `composerHidden` (`:7262-7266`) deliberately excludes `awaitingJobDetails`, and `:7283-7284` even adds
    `composer--flash` to *highlight* the composer on this exact step.
  - Difference, from code: the composer is the chat send path (`submitJobDetails` `:2427+`); the box is the structured editor that
    unlocks **Professionalize that** (`openWriteMyself` `:2453`, `professionalizeWmDetails` `:2466-2490`, `data-cy="professionalize-btn"`
    `:4505-4535`). Only the box can professionalize. The separate 4th "Write it myself" tile on the job-options picker
    (`:4163-4200`, `CUSTOM_OPTION_ID`) is the legitimate p59 feature — leave it.
  - Fix: either add `awaitingJobDetails && !submittedJobDetails` to `composerHidden` at `:7262` (keep the box), or remove the
    step-1 button/editor (`:4399-4432`) and move Professionalize onto the composer.
  - Tests: `cypress/e2e/quotes-professionalize.cy.ts:25-27` clicks "write it myself"; `cypress/e2e/ux-help-me-price.cy.ts:70-75`
    types into `textarea.composer__input` on this step — whichever affordance goes, one green spec must change. `TDD-QUOTE-FLOW.md:27` row 4.

- Again shows both "Write it myself" and the "Ex: Customer wants…" placeholder. We don't need both. [p6]
  - **NW-07 🐛 same component as NW-04.** `startHelpMePriceFlow` (`AsstChat.tsx:3260`) and `startKnownPriceFlow` (`:3226`) both land on
    the single `chat__details-flow` arm (`:4326`). One fix closes both. Effort S once NW-04's product call is made.

## Code at the cited lines (read from this tree while packaging)

### `front-end/islands/AsstChat.tsx:7262-7286`

```
7262:         const composerHidden = priceCaptureOpen || jobOptionsOpen ||
7263:           invoiceCustomerOpen || invoiceReview !== null ||
7264:           invoiceResult !== null ||
7265:           (hasUnansweredWizard && !awaitingJobDetails) ||
7266:           previewCtaId !== null;
7267:         // The error strip must survive a hidden composer: wizard-step
7268:         // failures (customer create rejected, network flake) land in
7269:         // `error`, and every wizard step hides the composer — swallowing
7270:         // the banner made those failures read as "the button did nothing".
7271:         if (composerHidden) {
7272:           return error
7273:             ? (
7274:               <div class="composer">
7275:                 <div class="composer__err">{error}</div>
7276:               </div>
7277:             )
7278:             : null;
7279:         }
7280:         return (
7281:           <div
7282:             class={`composer${
7283:               awaitingJobDetails && !submittedJobDetails && !draft.trim()
7284:                 ? " composer--flash"
7285:                 : ""
7286:             }`}
```

### `front-end/islands/AsstChat.tsx:4402-4432`

```
4402:                     {!submittedJobDetails && !writeMyselfOpen
4403:                       ? (
4404:                         <button
4405:                           type="button"
4406:                           class="chat__details-writeself"
4407:                           onClick={openWriteMyself}
4408:                         >
4409:                           ✎ {tFor(lang, "asstChat.jobOpts.customTitle")}
4410:                         </button>
4411:                       )
4412:                       : null}
4413:                     {!submittedJobDetails && writeMyselfOpen
4414:                       ? (
4415:                         <div class="chat__writeself">
4416:                           <div class="chat__writeself-head">
4417:                             <h4 class="chat__writeself-title">
4418:                               {tFor(lang, "asstChat.jobOpts.customTitle")}
4419:                             </h4>
4420:                             <p class="chat__writeself-sub">
4421:                               {tFor(lang, "asstChat.writeSelf.hint")}
4422:                             </p>
4423:                           </div>
4424:                           <textarea
4425:                             ref={wmTaRef}
4426:                             class="chat__writeself-input"
4427:                             rows={5}
4428:                             placeholder={tFor(
4429:                               lang,
4430:                               "asstChat.jobOpts.customPlaceholder",
4431:                             )}
4432:                             defaultValue={wmDraftRef.current}
```

### `front-end/islands/AsstChat.tsx:4505-4535`

```
4505:                             : null}
4506:                           <div class="chat__writeself-actions">
4507:                             {wmHasText && !wmProposal
4508:                               ? (
4509:                                 <button
4510:                                   type="button"
4511:                                   data-cy="professionalize-btn"
4512:                                   class="chat__writeself-pro"
4513:                                   disabled={wmBusy}
4514:                                   onClick={professionalizeWmDetails}
4515:                                 >
4516:                                   {wmBusy
4517:                                     ? (
4518:                                       <>
4519:                                         <span
4520:                                           class="spinner"
4521:                                           aria-hidden="true"
4522:                                         />{" "}
4523:                                         {tFor(
4524:                                           lang,
4525:                                           "asstChat.writeSelf.professionalizing",
4526:                                         )}
4527:                                       </>
4528:                                     )
4529:                                     : tFor(
4530:                                       lang,
4531:                                       "asstChat.writeSelf.professionalize",
4532:                                     )}
4533:                                 </button>
4534:                               )
4535:                               : null}
```

### `cypress/e2e/quotes-professionalize.cy.ts:25-27`

```
25:     cy.contains("button.chat__empty-prompt", "I know my price, write it up.").click();
26:     // Open the "Write it myself" option on the job-details step.
27:     cy.contains(/write it myself/i, { timeout: 10_000 }).click();
```

### `front-end/static/assistant-page.css:8224-8241`

```
8224: /* "Write it myself" trigger on the job-details step (roadmap p.5). */
8225: .chat__details-writeself {
8226:   align-self: flex-start;
8227:   appearance: none;
8228:   border: 1px dashed var(--line, #d8e0d4);
8229:   background: #fff;
8230:   color: var(--brand-teal, #1a535c);
8231:   font-size: 13px;
8232:   font-weight: 700;
8233:   padding: 8px 14px;
8234:   border-radius: 999px;
8235:   cursor: pointer;
8236:   transition: border-color 0.12s, background 0.12s, color 0.12s;
8237: }
8238: .chat__details-writeself:hover {
8239:   border-color: var(--brand-green, #519843);
8240:   background: var(--mint-100, #e8f3e0);
8241: }
```

### `front-end/static/assistant-page.css:4402-4432`

```
4402:   align-items: center;
4403:   gap: 10px;
4404:   margin-top: 18px;
4405:   padding: 0 6px;
4406:   color: var(--fg-muted);
4407:   font-size: 12px;
4408:   font-family: var(--font-heading);
4409:   font-weight: 700;
4410:   letter-spacing: 0.04em;
4411:   text-transform: uppercase;
4412: }
4413: .annot__dot {
4414:   width: 8px;
4415:   height: 8px;
4416:   border-radius: 999px;
4417:   background: var(--brand-pink);
4418: }
4419: 
4420: @media (max-width: 1280px) {
4421:   .stage {
4422:     grid-template-columns: 1fr;
4423:   }
4424:   .phone {
4425:     margin: 0 auto;
4426:     position: static;
4427:   }
4428: }
4429: 
4430: /* ============================================================
4431:    Assistant page
4432:    ============================================================ */
```

### `front-end/static/assistant-page.css:4163-4200`

```
4163:   color: var(--brand-pink);
4164:   opacity: 0.6;
4165: }
4166: .phero__sparkle--1 {
4167:   top: 14px;
4168:   right: 18px;
4169:   transform: rotate(15deg);
4170: }
4171: .phero__sparkle--2 {
4172:   top: 38px;
4173:   right: 48px;
4174:   transform: rotate(-10deg);
4175:   width: 10px;
4176:   height: 10px;
4177:   opacity: 0.45;
4178: }
4179: .phero__win-chip {
4180:   display: inline-flex;
4181:   align-items: center;
4182:   gap: 6px;
4183:   padding: 5px 10px 5px 8px;
4184:   background: var(--brand-green);
4185:   color: #fff;
4186:   border-radius: 999px;
4187:   font-family: var(--font-heading);
4188:   font-weight: 800;
4189:   font-size: 10px;
4190:   letter-spacing: 0.05em;
4191:   text-transform: uppercase;
4192:   margin-bottom: 10px;
4193:   box-shadow: 0 4px 10px rgba(81, 152, 67, 0.28);
4194: }
4195: .phero__win-chip svg {
4196:   color: #fff;
4197: }
4198: .phero__title {
4199:   font-family: var(--font-heading);
4200:   font-weight: 800;
```

### `front-end/static/assistant-page.css:4505-4535`

```
4505: }
4506: .threads__new-kbd {
4507:   margin-left: auto;
4508:   background: rgba(255, 255, 255, 0.2);
4509:   padding: 2px 8px;
4510:   border-radius: 6px;
4511:   font-family: var(--font-mono);
4512:   font-size: 10px;
4513:   font-weight: 700;
4514: }
4515: /* UX-14: a desktop keyboard hint has no business inside a phone drawer. */
4516: @media (max-width: 768px) {
4517:   .threads__new-kbd {
4518:     display: none;
4519:   }
4520: }
4521: .threads__list {
4522:   flex: 1;
4523:   overflow-y: auto;
4524:   padding: 0 8px 12px;
4525: }
4526: .threads__list::-webkit-scrollbar {
4527:   width: 0;
4528: }
4529: .threads__group-label {
4530:   font-size: 10px;
4531:   font-weight: 700;
4532:   letter-spacing: 0.1em;
4533:   text-transform: uppercase;
4534:   color: var(--fg-subtle);
4535:   padding: 12px 10px 6px;
```

### `front-end/static/assistant-page.css:7259-7265`

```
7259: }
7260: 
7261: /* Orb — small (56px) but still uses the multi-layer gradient + halo. */
7262: .rec-panel__orb-wrap {
7263:   flex: 0 0 auto;
7264:   width: 56px;
7265:   height: 56px;
```

### `front-end/static/assistant-page.css:1789-1795`

```
1789: .activity-item__text strong {
1790:   font-family: var(--font-heading);
1791:   font-weight: 800;
1792: }
1793: .activity-item__time {
1794:   font-size: 11px;
1795:   color: var(--fg-subtle);
```

### `cypress/e2e/ux-help-me-price.cy.ts:66-69`

```
66:     cy.get("textarea.composer__input", { timeout: 10_000 })
67:       .should("be.visible")
68:       .type(DETALLES);
69:     cy.get("button.composer__send").click();
```
