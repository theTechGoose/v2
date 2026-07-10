# First-Sign-In Onboarding Wizard — Plan

> **PROMPT — read this before touching anything below.**
>
> **High-level goal:** Replace the hard, chat-parsing onboarding with a first-sign-in wizard at `/welcome` that (1) asks exactly **one question at a time** with real typed inputs, (2) **fills out all the info the app needs** (every dashboard SetupChecklist item: name, business name, email, state + address, payment methods, logo, insurance), saving each answer immediately through the existing profile endpoints, and (3) **educates the user on how to use the assistant** (why-we-ask microcopy, "Meet Bossie" example prompts, a branded "see what your customer sees" sample quote, and a finish that lands them in a seeded assistant conversation).
>
> **Work method:** Think step by step, sequentially. Do the checkboxes **in order, one at a time**. After **every** checkbox, do its nested **Validate** checkbox before moving on: write the test(s) for that step first or alongside, then **run them plus the prior tests** so nothing regresses. Never batch several steps and validate at the end. If a validation fails, fix it before proceeding.
>
> **Commands you will use for validation:**
> - Serve the app (needed for Cypress): `deno task serve` — frontend :5280, backend :4280. **Restart it after any `lang/*.json` edit** (Vite caches them).
> - Backend tests: `cd backend && deno task test`
> - Frontend gate (fmt+lint+typecheck): `cd front-end && deno task check`
> - Onboarding e2e: `cd cypress && npm run run:onboarding` (runs `e2e/onboarding-*.cy.ts`; use `cy.startFreshOnboarding(phone)` for a real wipe→OTP→verify fresh user)
>
> **Hard constraints (from prior feedback — do not violate):**
> - **Never gate navigation on profile completeness.** The wizard is entered by ONE redirect at first sign-in and by voluntary `/welcome` visits. No middleware anywhere else may redirect incomplete profiles (the old `loadProfileGate` trap must not come back). Skipping everything must be possible and permanent.
> - **Payments are manual-only** — the payment question collects accepted methods + handles for invoices (Venmo/Zelle/CashApp/check/cash/ACH), no card processing.
> - **All data user-owned** — every write goes through the authed profile endpoints, keyed by the session user.
> - **Do not modify `front-end/islands/AsstChat.tsx`** (8,451 lines). The wizard is a new island; assistant hand-off is done by seeding messages server-side.
> - Keep the existing chat onboarding state machine (`handle-chat-message`) untouched as a backstop for existing half-onboarded users; we only stop routing NEW users into it (Phase 5, last).
> - Every new user-facing string gets keys in BOTH `lang/en.json` and `lang/es.json`.

---

- [ ] **1. Backend groundwork: completion flag + state prefill (additive only, no UX change)**
  - [ ] 1.1 Add `onboardedAt?: string` and `onboardingSkipped?: boolean` to the `User` interface in `backend/src/users/dto/user.ts` (NOT to `UpdateUserDto` — clients must not set it via `PUT /me`), and make sure `UserStore.update` persists/returns them.
    - [ ] Validate: add a colocated user-store test proving the fields round-trip; `cd backend && deno task test` green.
  - [ ] 1.2 Add `POST /me/onboarded` (same controller area as `PUT /me` / `GET /me/wipe` in the users module): auth-required, body `{ skipped?: boolean }`, sets `onboardedAt` to the server's now-ISO and `onboardingSkipped`, idempotent (second call keeps the first timestamp). Add a front-end proxy route if `/api/me/*` routes are proxied like `verify.ts` is (mirror the existing pattern in `front-end/routes/api/`).
    - [ ] Validate: colocated endpoint test (unauth → 401, first call sets, second call is a no-op); `cd backend && deno task test` green.
  - [ ] 1.3 Move `US_STATES`, `AREA_CODE_STATE`, `areaCodeFromPhone`, `stateFromPhone` from `backend/src/agents/domain/business/onboarding/mod.ts` into a shared module (e.g. `backend/src/core/business/us-states/mod.ts`) and **re-export them from the old path** so all existing imports/tests keep working.
    - [ ] Validate: `cd backend && deno task test` fully green (the untouched onboarding-parser tests passing proves the re-export is faithful).
  - [ ] 1.4 Extend the profile snapshot (`users/entrypoints/profile-composite-controller`, `GET /profile`): include `user.onboardedAt` and a new top-level `suggestedState` computed with `stateFromPhone(user.phoneNumber)` (only when `address.state` is empty). Mirror the two fields in `front-end/clients/profile.ts` types.
    - [ ] Validate: snapshot test asserting `suggestedState` for a known area code (e.g. +1843 → SC) and its absence when address.state is set; `cd backend && deno task test` green; `cd front-end && deno task check` green.
  - [ ] Validate phase 1: `cd backend && deno task test` and `cd front-end && deno task check` both green; `cd cypress && npm run run:onboarding` still passes exactly as before this phase (no behavior change yet).

- [ ] **2. `/welcome` route + one-question-at-a-time wizard shell (reachable only by direct URL for now)**
  - [ ] 2.1 Create `front-end/routes/welcome.tsx`: SSR handler — no session → 302 `/`; load the profile snapshot in-process (same `ssrBackendGetAuthed` pattern as `routes/assistant/index.tsx`); `user.onboardedAt` set → 302 `/dashboard`; otherwise render a **full-screen focused layout** (no `DashSidebar` — logo + wizard only) mounting a new `WelcomeWizard` island with the snapshot + `suggestedState` as props.
    - [ ] Validate: new spec `cypress/e2e/onboarding-wizard.cy.ts` — logged-out `/welcome` redirects to `/`; a user who POSTs `/api/me/onboarded` then visits `/welcome` lands on `/dashboard`. Run `npm run run:onboarding`.
  - [ ] 2.2 Create `front-end/islands/WelcomeWizard.tsx` — the step engine only: an ordered step registry `{ key, isComplete(snapshot), skippable, render }`; on mount jump to the **first incomplete step** (this is the resume mechanism — profile data IS the wizard state, no separate persistence); one question per screen with: big question heading, one input area, primary **Continue** (disabled until valid), **Skip** (skippable steps only), **Back**, a real `role="progressbar"` with `aria-valuenow` + visible "Step X of N", and a low-key **"Skip setup for now"** escape that POSTs `/api/me/onboarded {skipped:true}` and goes to `/dashboard`.
    - [ ] Validate: `cd front-end && deno task check`; Cypress — `/welcome` renders a `[role="progressbar"]` and "Skip setup for now" lands on `/dashboard`, and re-visiting `/welcome` afterwards bounces to `/dashboard` (skip is permanent, no re-trap).
  - [ ] 2.3 Wire the first real question end-to-end — **Name**: text input (`autocomplete="name"`, Enter submits), prefilled from `user.name` EXCEPT when it's the seeded placeholder ("New user"/"Nuevo usuario" → prefill empty), saves via `profileClient.updateUser({ name })`, advances on success, inline error + stay on failure.
    - [ ] Validate: Cypress — `cy.startFreshOnboarding(PHONE)`, visit `/welcome`, answer the name, assert `/api/me` returns it; reload `/welcome` and assert the wizard resumes at the NEXT question (proves resume). Run `npm run run:onboarding`.
  - [ ] 2.4 Add all shell i18n keys (`welcome.*`: title, stepOf, continue, back, skip, skipSetup, name question + why-line) to `lang/en.json` AND `lang/es.json`; no hardcoded strings in the island. Restart `deno task serve` after editing lang files.
    - [ ] Validate: key-parity check — `deno eval` (or a tiny script) diffing `welcome.*` key sets between en.json and es.json exits clean; `cd front-end && deno task check` green; re-run `npm run run:onboarding`.
  - [ ] Validate phase 2: backend tests + FE check + full `run:onboarding` green; manually confirm `/dashboard`, `/quotes`, `/settings` are all reachable for a brand-new user who typed ONLY their name (no gating anywhere).

- [ ] **3. The data questions — every SetupChecklist item, one focused screen each (each saves immediately)**
  - [ ] 3.1 **Business name** — text input, prefill from `identity.businessName`, save `profileClient.updateIdentity({ businessName })`, skippable. Why-line: it goes on quotes/invoices your customers see.
    - [ ] Validate: Cypress asserts `/api/profile` identity.businessName persisted + resume lands after it; `npm run run:onboarding` green.
  - [ ] 3.2 **Email** — `type="email"` input with inline format validation, save `profileClient.updateUser({ email })`, skippable. Why-line: where quote replies + copies of paperwork land.
    - [ ] Validate: Cypress — invalid email blocks Continue with a visible message; valid email persists to `/api/me`; suite green.
  - [ ] 3.3 **State** — searchable dropdown/chip-grid of `US_STATES`; when `suggestedState` is present, pre-select it and phrase as tap-to-confirm ("Looks like you're in South Carolina — right?" with Confirm / pick-another; mirrors old chat guess UX but with buttons). Save via `profileClient.updateAddress` **merging** into the existing address object (read current snapshot values, send them back with the new state — never clobber street/zip).
    - [ ] Validate: backend/int test or Cypress proof that setting state does not erase other address fields; Cypress — fresh 843-area phone sees SC preselected, confirm persists `address.state === "SC"`; suite green.
  - [ ] 3.4 **Business address** — one screen, one question ("Where's the business based?"): street, unit (optional), city, zip (`inputmode="numeric"`) as small fields; merge-save through `updateAddress`; skippable ("Solo / no office — skip").
    - [ ] Validate: Cypress fills it and asserts all fields on `/api/profile.address` (street + postal both present — this was old audit bug #4); suite green.
  - [ ] 3.5 **How you get paid** — method chips (venmo / zelle / cashapp / check / cash / ach); tapping a chip reveals its handle input (Venmo `@handle`, Zelle email-or-phone, CashApp `$cashtag`; check/cash/ach need no handle); multiple selectable; save `updateIdentity({ acceptedPaymentMethods })` built by **merging over the existing map from the snapshot** (`enabled: true` + handle per chosen method — read-modify-write, don't drop methods enabled elsewhere). Skippable. Manual-payments only — no card fields.
    - [ ] Validate: Cypress — pick Venmo + handle, assert `/api/profile` identity.acceptedPaymentMethods.venmo.enabled === true with the handle, and a pre-enabled method (seed one via `PUT /api/profile/identity` in the test) survives the merge; suite green.
  - [ ] 3.6 **Logo** — upload via the existing `front-end/clients/files.ts` flow (same as Settings), image preview, save `updateIdentity({ logoFileId })`, skippable.
    - [ ] Validate: Cypress uploads a small fixture PNG, asserts `identity.logoFileId` set; suite green.
  - [ ] 3.7 **Insurance** — one screen: provider + policy number (coverage/expiry stay in Settings), save `profileClient.updateInsurance`, skippable. Why-line: lets you attach proof-of-insurance to bids.
    - [ ] Validate: Cypress asserts `insurance.provider` persisted; suite green.
  - [ ] 3.8 Every data screen carries its one-line **"why we ask"** microcopy (en + es) — this is education layer 1 (what the assistant does with each piece of data).
    - [ ] Validate: key-parity check for all new `welcome.*` keys passes; visual spot-check of each step at 375px width (Cypress `cy.viewport(375, 700)` walkthrough).
  - [ ] Validate phase 3: **the "all info" proof** — a Cypress run that answers ALL questions then visits `/dashboard` and asserts the SetupChecklist card does NOT render (it self-hides only when every item is done); plus a second run that skips everything and asserts the checklist DOES render (safety net intact). Backend tests + FE check + full `run:onboarding` green.

- [ ] **4. Education + finish: teach the assistant, hand off into it**
  - [ ] 4.1 **"Meet Bossie" screen(s)** after the data questions (always shown, Next-only): 2–3 cards of concrete things to type — quote ("Paver patio for the Nguyens — $3,700"), invoice ("Invoice Maria for the deck job"), follow-up ("Nudge Tom about the bathroom quote") — mirroring what `handle-chat-message` actually supports; en + es.
    - [ ] Validate: Cypress — after the last data step the Meet-Bossie screen appears with the three example prompts visible; suite green.
  - [ ] 4.2 **"See what your customer sees"** — expose the existing idempotent `EnsureSampleQuote` coordinator behind an authed endpoint (check first whether the chat handoff already exposes one to reuse; if not, add `POST /agents/sample-quote` in the agents module), then a wizard screen with a button that creates/fetches it and links the public quote page (new tab).
    - [ ] Validate: backend test — endpoint is idempotent (two calls, one quote); Cypress — the linked page shows the business name entered in 3.1, never "Dev Business" (old audit bug #1); suite green.
  - [ ] 4.3 **Finish screen** — prompt chips (the 4.1 examples) + "I'll explore on my own". Chip path: extend `StartOnboardingConversation` (`backend/src/agents/domain/coordinators/start-onboarding-conversation/mod.ts`) with an optional `{ handoff: true, examplePrompt?: string }` that — when the profile is complete — seeds the conversation with the existing `ONBOARD_HANDOFF` invitation (plus the chosen example), then navigate to `/assistant/<conversationId>`. Explore path: go to `/dashboard` (the existing `AssistantCoachmark` fires there — leave it as-is). **No AsstChat.tsx changes** — the seeded message does the work.
    - [ ] Validate: backend test for the seeded-handoff branch; Cypress — picking a chip lands on `/assistant/<id>` with a seeded assistant message visible; "explore" lands on `/dashboard` and the coachmark appears once; suite green.
  - [ ] 4.4 **Completion write** — both finish paths POST `/api/me/onboarded { skipped: false }` before navigating; afterwards `/welcome` always 302s to `/dashboard`.
    - [ ] Validate: Cypress — finish, then `cy.visit("/welcome")` asserts redirect to `/dashboard`; suite green.
  - [ ] Validate phase 4: full fresh-user journey spec green (sign up → every question → education → chip → seeded assistant chat), backend tests + FE check green.

- [ ] **5. Flip the entry points (last, so new users only route here once the wizard is whole)**
  - [ ] 5.1 `front-end/routes/api/auth/verify.ts:50` — `redirectTo` for `isNewUser` becomes `/welcome` (returning users keep `/dashboard?welcome=back`).
    - [ ] Validate: Cypress — `cy.startFreshOnboarding` asserts `redirectTo === "/welcome"`; a second login with the same phone asserts `/dashboard?welcome=back`; suite green.
  - [ ] 5.2 `front-end/routes/assistant/index.tsx` — the `?onboard=1` branch now 302s to `/welcome` (keep `POST /agents/conversations/onboarding-start` and the chat state machine untouched as the backstop for existing users who chat with a missing name).
    - [ ] Validate: Cypress — visiting `/assistant?onboard=1` as a not-yet-onboarded user lands on `/welcome`; as an onboarded user lands on `/dashboard` (via /welcome's own guard); suite green.
  - [ ] 5.3 Reconcile `cypress/e2e/onboarding-issues.cy.ts` (red-by-design audit spec for the OLD flow): rewrite the chat-flow tests to their wizard equivalents (#1 sample branding → covered by 4.2's spec, #2 email ask → 3.2, #4 address on settings → 3.4, #8 payment ask → 3.5, #10 tap-to-confirm state → 3.3, #11 visible Skip → 3.4, #14 skip-setup escape → 2.2, #15 real progressbar → 2.2); update #3's `redirectTo` assertion to `/welcome`; keep #6 (OTP paste), #9 (brand), #16 (checklist) unchanged; keep or retire #5 (chat placeholder) with a one-line justification since new users no longer enter chat onboarding.
    - [ ] Validate: `npm run run:onboarding` — the WHOLE onboarding group (both spec files) green.
  - [ ] 5.4 Confirm no gate crept in: grep `front-end/routes/**/_middleware.ts` — every middleware is still auth-only (no profile-completeness redirects, no `/welcome` bounces from other routes).
    - [ ] Validate: Cypress — brand-new user who skipped setup can load `/dashboard`, `/quotes`, `/invoices`, `/clients`, `/settings` with no redirect to `/welcome`.
  - [ ] Validate phase 5: full onboarding + auth Cypress groups green (`npm run run:onboarding`, `npm run run:auth`); backend tests + FE check green.

- [ ] **6. Polish + full regression**
  - [ ] 6.1 Spanish parity sweep: every `welcome.*` / new `onboarding*` key exists in `lang/es.json` with real translations (match the tone of existing es copy); restart serve; walk the wizard as an es-language user.
    - [ ] Validate: key-parity script exits 0; Cypress run where the fresh user signs up via the es landing toggle asserts the first question renders in Spanish.
  - [ ] 6.2 Mobile pass: full wizard walkthrough at `cy.viewport(375, 700)` — no horizontal scroll, inputs use `autocomplete` / `inputmode` / `enterkeyhint`, Continue reachable above the soft keyboard.
    - [ ] Validate: the 375px Cypress walkthrough green; add it to the onboarding spec so it runs forever after.
  - [ ] 6.3 A11y pass: each step's heading focused on advance, labels bound to inputs, progressbar announces value, animations respect `prefers-reduced-motion`; run axe (already a cypress devDependency) on 3 representative steps.
    - [ ] Validate: axe checks report no critical violations in the Cypress run.
  - [ ] 6.4 Full regression: `cd backend && deno task test`; `cd front-end && deno task check`; Cypress groups `run:onboarding`, `run:auth`, `run:dashboard`, `run:settings`, `run:e2e-funnel`.
    - [ ] Validate: all of the above green in one sitting; fix anything red before calling the project done.
  - [ ] Validate phase 6 (final acceptance): one clean end-to-end demo on a wiped phone number — sign up → one-question-at-a-time wizard → all info lands in Settings → education screens → seeded assistant chat → dashboard has no SetupChecklist and shows the coachmark once; plus the skip path — skip everything → dashboard works fully, checklist shows, `/welcome` never traps again.
