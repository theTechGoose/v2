# 1.5 ◩ NW-19b — Job Details is editable on the review card (M) · slug `nw-19-job-details-pencil`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 1.5) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Goal.** The review card's Job Details section gets a pencil that reopens the job picker; every other field already has one.
**Why.** `AsstChat.tsx:5853-5879` renders Job Details as a plain `<ul>`/`<p>`; the editable pattern is `class="… quote-review__editable"` +
`contentEditable` + `onBlur` (`:5665-5690`) or the pencil buttons (`:6137`, `:6176`).

- [ ] RED — e2e: `cypress/e2e/ux-doc-preview.cy.ts` add `it("REQ-NNN NW-19 Job Details on the review card has an edit control")`: reach the
      review card the way that spec already does, then `cy.get("[data-cy=review-job-details-edit]").click()` → `.chat__jobopts` (the picker) is visible. Run → fails (no such element).
- [ ] EDIT `AsstChat.tsx:5857-5863`: inside the section label row add
      `<button type="button" class="quote-review__term-edit" data-cy="review-job-details-edit" aria-label={tFor(previewLang,"common.edit")} onClick={() => void openJobPicker()}>✎</button>`
      (`openJobPicker` is at `:1890`; it reads `jobPolishRawRef`/`quote.description`). After the picker's `applyJobOption` (`:2220`) the review re-renders from `polishedDescription` — verify that path updates the card; if not, call the same setter `applyJobOption` uses.
- [ ] Unit/integration: `n/a — component wiring; the picker itself is already covered by quotes-professionalize.cy.ts`.
- [ ] Done when: clicking the pencil shows the three-option picker, picking one updates the Job Details bullets on the card.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- Fix the Go Back button for all of the tasks. Job Details is not editable on the review card, so they need a back button. [p13]
  - **NW-19 ◩ one universal back exists on every screen; three forward moves push no snapshot; Job Details is definitively read-only on the review card.** Effort S + M.
  - Evidence: single header back `front-end/islands/ChatHeaderLive.tsx:56-68` (dispatches `pm:asst-back`; in the shell
    `routes/assistant/[threadId].tsx:138`, `index.tsx:93`); per-step backs removed by design (`AsstChat.tsx:6935-6939`, `:7856-7859`,
    `:4737-4738`, `:4751-4753`); resolver `shared/quote-flow/assistant-back.ts:46-54` (invoiceResult → exit; viewStack → pop;
    preview or stepIdx>0 → rewind; else exit-dashboard). Commit `4a1457a` added the price→wizard snapshot (`:2182-2184`
    `pushHistory(); persistStackAs(convId)`). **Missing `pushHistory()`**: `sendText→submitTurn` `:1746-1777`, `lockActionCard`
    `:3014-3031`, `submitContinueCta` `toPhase==="terms"` `:2599-2632`. Job Details on the review card `:5853-5878` is plain
    `<ul>/<p>`; every other field is `contentEditable` or has a pencil (`:5666-5667`, `:5681-5686`, `:5704-5709`, `:6176-6177`, `:6137`).
  - Fix: `pushHistory()` at the top of those three; a `quote-review__term-edit`-style pencil on Job Details (`:5857-5878`) that
    reopens the picker.
  - Tests: `cypress/e2e/ux-assistant-single-back.cy.ts:36-99`, `assistant-history.cy.ts:38-98`, `quotes-wizard-navigation.cy.ts:36`,
    `jest/unit/assistant-back.test.ts`, `wizard-nav.test.ts`. None for Job Details editability.

- Make the Toilet Replacement job editable. [p56]
  - **◩ PARTIAL** — editable on the job-details picker (`AsstChat.tsx:3996,4091-4140`) but read-only on the review card (`:5864-5876`). Same gap as NW-19.

## Code at the cited lines (read from this tree while packaging)

### `front-end/islands/AsstChat.tsx:5853-5879`

```
5853:                           {(() => {
5854:                             const lines = detailLines(polishedDescription);
5855:                             if (lines.length === 0) return null;
5856:                             return (
5857:                               <section class="quote-review__section">
5858:                                 <div class="quote-review__section-label">
5859:                                   {tFor(
5860:                                     previewLang,
5861:                                     "asstChat.preview.jobDetails",
5862:                                   )}
5863:                                 </div>
5864:                                 {lines.length > 1
5865:                                   ? (
5866:                                     <ul class="quote-review__details">
5867:                                       {lines.map((l, i) => (
5868:                                         <li key={i}>{l}</li>
5869:                                       ))}
5870:                                     </ul>
5871:                                   )
5872:                                   : (
5873:                                     <p class="quote-review__details-text">
5874:                                       {lines[0]}
5875:                                     </p>
5876:                                   )}
5877:                               </section>
5878:                             );
5879:                           })()}
```

### `front-end/islands/AsstChat.tsx:5665-5690`

```
5665:                                 <div
5666:                                   class="quote-review__hero-name quote-review__editable"
5667:                                   contentEditable
5668:                                   spellcheck
5669:                                   lang="en"
5670:                                   onBlur={(e) =>
5671:                                     onEditCustomerName(
5672:                                       customer.id,
5673:                                       customer.name,
5674:                                       e.currentTarget as HTMLElement,
5675:                                     )}
5676:                                 >
5677:                                   {customer.name}
5678:                                 </div>
5679:                                 <div class="quote-review__hero-meta">
5680:                                   <span
5681:                                     class={`quote-review__editable quote-review__hero-field${
5682:                                       customer.email
5683:                                         ? ""
5684:                                         : " quote-review__hero-field--empty"
5685:                                     }`}
5686:                                     contentEditable
5687:                                     spellcheck={false}
5688:                                     data-placeholder={tFor(
5689:                                       previewLang,
5690:                                       "asstChat.preview.addEmail",
```

### `front-end/islands/AsstChat.tsx:6134-6140`

```
6134:                                             <dd>
6135:                                               <button
6136:                                                 type="button"
6137:                                                 class="quote-review__term-edit"
6138:                                                 onClick={() =>
6139:                                                   setEditingTermStepId(
6140:                                                     t.stepId,
```

### `front-end/islands/AsstChat.tsx:6173-6179`

```
6173:                                 $
6174:                               </span>
6175:                               <span
6176:                                 class="quote-review__total-num quote-review__editable"
6177:                                 contentEditable
6178:                                 spellcheck={false}
6179:                                 inputMode="decimal"
```

### `front-end/islands/AsstChat.tsx:5857-5863`

```
5857:                               <section class="quote-review__section">
5858:                                 <div class="quote-review__section-label">
5859:                                   {tFor(
5860:                                     previewLang,
5861:                                     "asstChat.preview.jobDetails",
5862:                                   )}
5863:                                 </div>
```

### `front-end/islands/AsstChat.tsx:1887-1893`

```
1887:    * (so the screen is never blank) and silently swap in the LLM options when
1888:    * they land, unless the user has already started editing.
1889:    */
1890:   async function openJobPicker() {
1891:     const raw = (jobPolishRawRef.current ?? quote?.description ?? "").trim();
1892:     optionsTouchedRef.current = false;
1893:     // No snapshot here: this picker is the end-of-wizard "send step" (it
```

### `front-end/islands/AsstChat.tsx:2217-2223`

```
2217:    * its price line. Patches the existing quote (created in phase 1), then
2218:    * opens the deferred quote review.
2219:    */
2220:   async function applyJobOption() {
2221:     if (sending) return;
2222:     let opt = jobOptions?.find((o) => o.id === selectedOptionId);
2223:     // "Write it myself" — synthesize a draft from the free-text box: each
```
