# 7.9 ◩ NW-43b — Completion text AND email after send/sign, always both (M) · slug `nw-43b-both-channels`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 7.9) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

**Why.** Channels depend on what the customer has on file (`AsstChat.tsx:698-702`). "Both always" means collecting the missing channel before send.
- [ ] RED e2e: a customer with email only → the send dialog (7.7) shows an inline "Add a phone to also text it" field; filling it saves to the customer and sends both.
- [ ] EDIT: in the send dialog, when the chosen channel needs a contact the customer lacks, show the input (`onEditCustomerField` `:2947` already persists) and then dispatch both.

## Phase context (verbatim from the plan, `Phase 7 — Remaining medium items (no decision needed; any order; after Phases 1–5 if time is short)`)



## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- **Overall tasks** [p40]
  - "My Assistant" needs to be at the top of the dashboard. On mobile you have to open the hamburger to find it, and My Assistant is everything.
    - **NW-43a ✅** `DashboardPage.tsx:433-465` (`data-cy="assistant-cta"`, plain href, pre-hydration). Test `dashboard-assistant-access.cy.ts`.
  - After quotes and signed quotes, send a completion text and email.
    - **NW-43b ◩** on accept `public-controller/mod.ts:442-512` fires `SendAcceptedAlert` (`:497`) + `SendSignedConfirmation`
      (`:118`, SMS via `shared/quote-flow/sms-i18n.ts:69-90`); receipts strip `QuotesPage.tsx:124-127,217-232`. Gap: channels depend
      on what the customer has on file (`AsstChat.tsx:698-702` both/email-only/sms-only) — "both always" would require collecting
      the missing channel before send. Tests `public-completion-notify.cy.ts`, `notifications.int.test.ts`. Effort M.
  - Make it mobile-friendly.
    - **NW-43c ◩⚠** `MobileViewport.tsx` (global), `AsstThreads.tsx:26-90` drawer dock, per-page breakpoints; four specs
      (`responsive-mobile.cy.ts`, `landing-mobile-390.cy.ts`, `ux-landing-mobile.cy.ts`, `ux-dashboard-mobile-390.cy.ts`).
      `TESTS-PROBLEMS.md:141` board ("39 specs, 200 passing") is stale — 60 specs exist now. **Needs a live Cypress run to size.**
  - PM Assistant: the hamburger menu icon does not work.
    - **NW-43d ✅ fixed** — `DashTopbar.tsx:87-91` (hydration-gated `data-cy`, "pre-hydration clicks were the 'hamburger does not
      work' bug"), desktop half `DashSidebar.tsx:137-145`.
  - Settings: make the rest editable — mailing address, insurance upload, tax W-9.
    - **NW-43e ✅** `SettingsPage.tsx:500-604` (`settings-mailing-address`), `:695-860` (`settings-insurance-upload`), `:863-970`
      (`settings-w9-upload`); controllers `business-address`, `business-insurance`, `tax-identity`, `files`. Tests `settings-editable.cy.ts`, `settings.int.test.ts`.
  - There is no back button for the steps. Needs a back button throughout so they can easily be edited.
    - **NW-43f ◩** assistant + welcome wizard done (see NW-19; `WelcomeWizard.tsx:154`); the `/quotes?open=` panel
      (`QuotesPage.tsx:124-260`) and the invoice detail panel have no back/close control. Effort S.
  - "Job Name" must be consistent across the platform. Summarize the job details into a name of three words or less.
    - **NW-43g ✅** `shared/quote-flow/job-name.ts` (`summarizeJobName`, EN/ES stopwords), single write-point `quote-store/mod.ts:36`,
      LLM clamp `polish-job-details/mod.ts:95-101,158`, language-aware reads `sms-i18n.ts:34-46`, `send-paperwork-email:505-508`.
      Tests `job-name.test.ts`, `ux-job-name-es.test.ts`, `job-name.int.test.ts`, `quotes-job-name.cy.ts`.

## Code at the cited lines (read from this tree while packaging)

### `front-end/islands/AsstChat.tsx:698-702`

```
698:   /** Selected channel for the quote-review send action. Smart-defaults
699:    *  from customer.email/phoneNumber: both → both, email-only → email,
700:    *  phone-only → sms. Overridable via the split-button chevron menu. */
701:   const [sendChannel, setSendChannel] = useState<"email" | "sms" | "both">(
702:     "both",
```

### `front-end/islands/AsstChat.tsx:2944-2950`

```
2944:   /** Generic inline-edit handler for the customer's email + phone in the
2945:    *  quote-review hero. Empty next value clears the field (allowed); the
2946:    *  PUT goes through whether the field had a prior value or not. */
2947:   async function onEditCustomerField(
2948:     field: "email" | "phoneNumber",
2949:     customerId: string | undefined,
2950:     original: string | undefined,
```
