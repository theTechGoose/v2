# 7.12 ◩⚠ NW-43c + NW-51a — Mobile: size it with a live run (S to size) · slug `mobile-responsive-audit`

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 7.12) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

- [ ] Run `cd cypress && npm run run:responsive` plus `e2e/landing-mobile-390.cy.ts`, `ux-landing-mobile.cy.ts`, `ux-dashboard-mobile-390.cy.ts` against the dev server; paste the summary into `TESTS-PROBLEMS.md:141` (the "39 specs" board is stale — 60 exist). Each red becomes its own S/M task with its own REQ.

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

- **Additional stuff** [p48]
  - Flawless mobile view with the same perfect UX translated to small screens.
    - **NW-51a ◩⚠** see NW-43c.
  - Login button on the landing page, top of view, that takes you to a clean login component with the same login flow.
    - **NW-51b ✅** `routes/index.tsx:317-320` (`nav.login`), `routes/landing.tsx:132-139` (`data-cy="landing-login"`),
      `routes/login.tsx` (clean screen, same OTP via `LoginForm.tsx:46-50`). Optional: add `data-cy` on the root link. Test `auth-landing-login.cy.ts`.
  - L10n Spanish translation: Mexican, South American, and Latino dialects.
    - **NW-51c ◩❓** one neutral-LatAm dict: *tú* throughout (0 hits for `usted`), 0 peninsular forms, "cotización" ×107. `Lang` is
      `"en" | "es"` (`front-end/lib/lang.ts`) — no dialect axis. `TDD-QUOTE-FLOW.md:96-97` flags it. Decide "neutral is the
      decision" (S) or add locale-tag overrides falling back to `es` (L). Test `i18n-spanish.cy.ts:75-81`.
  - (This page also contains a stray sales-call script, "HEYYY… John!! It's Ashley from Monster…", which looks pasted by accident.)

## Code at the cited lines (read from this tree while packaging)

_(no resolvable file:line citations in this card)_
