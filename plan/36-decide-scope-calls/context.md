# 6.9 ❓ Scope calls (not bugs)

_Packaged 2026-09-18 from `new-working-issues-plan.md` (### 6.9) against worktree `new-working-issues` @ `7a53141`. The bullet below is copied verbatim; the data sections after it are the triage items it closes and the actual code at every line it cites._

## The task (verbatim from the plan)

- **NW-51c** Spanish dialects: one neutral-LatAm dictionary today (`tú`, "cotización"). Recommend: declare neutral as the decision (S: a line in `requirements.md`). Locale-tag overrides are L.
- **NW-56** "Keep the ability to draft contracts": there is no standalone contract feature to keep (`/contracts` is a 302 to `/quotes`). Recommend: confirm the quote IS the contract; no work.
- **NW-58** competitor features + easy import: L; needs a competitor list first. Export exists (`GET /invoices/export.csv`).

---

## Phase context (verbatim from the plan, `Phase 6 — ❓ Decisions the client must make, with the work each answer unlocks`)

Send §10 (the message at the bottom) to the client. Do not start these tasks until the answer is back; everything above is unblocked meanwhile.

## Source items from the triage (`new-working-issues.md`, client's words + verdict + evidence)

- **NW-51c dialects** and **NW-56 standalone contract drafting** are scope calls, not bugs.

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

- The new Quote/Contract is both. We do not need to send a separate contract. Keep the ability to draft contracts, but most people will send one legally binding quote with all the job details. [p81]
  - **NW-56 ✅ merge done / ⬜ "keep drafting contracts" — nothing to keep.** Effort S (vocabulary) / L (if standalone drafting must exist).
  - Evidence: no Contracts nav (`DashSidebar.tsx:25-27`); `/contracts` is a 302 stub to `/quotes` (`routes/contracts/index.tsx`);
    no contract store/DTO/controller in `backend/src` (only `contract-defaults` settings presets). The `ux-problems.md:30-36` UX-02
    "auto-created draft contract" hypothesis is disproven (`TESTS-UX-PROBLEMS.md:107-108`). Residual "contract" vocabulary is
    cosmetic: `ICN.contract`, `static/public-contract.css`, landing demo tab `LandingScripts.tsx:188-233`.

- **Stretch goals**: look at competitors, add their best features, and easy import. [p84]
  - **NW-58 ⬜** export only — `GET /invoices/export.csv` (`invoice-controller:312-371`, `InvoicesPage.tsx:769`); no import
    endpoint, parser or UI (zero hits for csv import / importar / vcf). Effort L.

## Code at the cited lines (read from this tree while packaging)

_(no resolvable file:line citations in this card)_
