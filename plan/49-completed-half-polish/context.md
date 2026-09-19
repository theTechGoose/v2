# 7.13 ✅→S — Three cheap polish items from the "COMPLETED" half · slug `completed-half-polish`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 7.13) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

- [ ] **NW-53f** price autofocus in help-me-price: `AsstChat.tsx` `autoFocus={!suggestPricing}` → `autoFocus`; RED e2e `quotes-help-me-price.cy.ts:71-73` asserts `cy.focused()` is the money input after picking a tier.
- [ ] **NW-53b** negative pin: `quotes-help-me-price.cy.ts` add `cy.get("textarea.composer__input").should("not.exist")` on the price and picker steps (passes on arrival — pin).
- [ ] **NW-48** SMS link on its own line: `lang/*.json:1588-1595` put `{url}` after a `\n`; RED unit `jest/unit/sms-template.test.ts` asserts the URL is on its own line.

---

## Phase context (verbatim from the plan, `Phase 7 — Remaining medium items (no decision needed; any order; after Phases 1–5 if time is short)`)



## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- Text-message template to the customer: [p45]
  > Hi [Customer Name], this is [Contractor Name] from [Business Name].
  > Your Quote + Agreement for [Job Name] is ready:
  > [LINK]
  > Please let me know if you have any questions. I look forward to working with you!
  - **NW-48 ✅ DONE verbatim (EN); ES equivalent.** `lang/en.json:1588-1595` (`paperworkSms.intro.hiWhoBiz`, `body.ready`,
    `body.closing`), composed `send-paperwork-sms/mod.ts:303-337` with graceful fallbacks (`:280-282`); ES `lang/es.json:1588-1595`.
    Only divergence: `{url}` inline after "is ready:" rather than on its own line. Tests `sms-template.test.ts`, `sms-i18n.test.ts`, `outbound-sms-content.cy.ts`.

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

## Code at the cited lines (read from this tree while packaging)

### `cypress/e2e/quotes-help-me-price.cy.ts:71-73`

```
71:     cy.get("[data-cy=confirm-details]", { timeout: 20_000 }).should("be.visible").click();
72:     cy.get("[data-cy=pricing-option-custom]", { timeout: 20_000 }).click();
73:     cy.focused().type("725{enter}");
```
