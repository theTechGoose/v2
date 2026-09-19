# New Working Issues — triaged

Source: `new working issues.pdf` (84 pages, dated 2026-09-18). Page numbers are in brackets.
Pages 2–32 are the open **Quote Flow Tasks**. Page 33 is a **COMPLETED TASKS** divider; everything after it is in the second half of this file.
"Dragon" = the contractor using the app. "Unicorn" = the contractor's customer.

**Triage (2026-09-18)** against worktree `new-working-issues` @ `7a53141` (= `develop` `a0ec81d` + the transcript commit). Every
item keeps the client's words, then gets an `NW-nn` id and a triage block. All evidence is `file:line` in this tree; nothing was
live-driven, so anything code alone cannot prove is marked ⚠. Baseline: `cd jest && npx jest --selectProjects unit` → **38 suites,
416 passed, 1 skipped, 0 failed** — every `shared/quote-flow/*` contract module from the earlier TDD rounds exists and is green; the
open question per item is whether it is *wired into the UI*, which is what the triage answers. `front-end/ui-breakdown/**` is a
generated design artefact, not served code — excluded from all searches.

Legend: 🐛 confirmed bug · ⬜ not built · ◩ partially built · ✅ already done · ❓ product decision needed · ⚠ cannot verify from code.
Effort: S ≤ half a day · M ≈ 1–2 days · L ≥ 3 days.

---

## Triage summary

### Counts (open half, pp. 2–32, 36 items → NW-01…NW-36)

| Status | Items |
|---|---|
| 🐛 confirmed bug (17) | NW-04, NW-05, NW-07, NW-08, NW-10, NW-11, NW-12, NW-13, NW-16, NW-17, NW-18, NW-20, NW-24, NW-25, NW-30, NW-34, NW-36 |
| ⬜ not built (5) | NW-02, NW-09, NW-15, NW-26, NW-32 |
| ◩ partially built (11) | NW-01, NW-06, NW-14, NW-19, NW-23, NW-27, NW-28, NW-29, NW-31, NW-33, NW-35 |
| ❓ product decision (1, +NW-02) | NW-03 |
| ⚠ cannot verify (2) | NW-21, NW-22 |
| ✅ already done | none in the open half |

Second half (pp. 34–84, NW-37…NW-58): of the 22 "not labeled completed" top-level items, **10 are already done**, 6 partially, 3 not
built, 1 confirmed bug (the sender name, NW-47), 1 product question (pricing, NW-37), 1 unverifiable (the missing .docx, NW-46).
Of the 24 "labeled COMPLETED" items, **18 verified done, 5 partially, 1 not found** — see the per-item verdicts.

### Seven root causes that each close several items

1. **Production may be running on the stub LLM.** `backend/src/agents/mod-root.ts:53-61` binds `OpenAILLMClient` only when
   `AGENTS_LLM_CLIENT === "openai"`, else `StubLLMClient`, which echoes `"(stub) <input>"` (`…/llm/implementations/stub/mod.ts:44`).
   Only `serve.ts:42` (dev) and `backend/deno.json:3-4` set it; the composed prod task `deno.json:6` (`deno serve … mod.ts`) does
   **not**, and there is no deploy config in the repo (no `.github`, `Dockerfile`, `fly.toml`). ⚠ If the deploy dashboard does not
   inject it, every job-options and price call runs the deterministic fallbacks — which produce *exactly* the screenshots in
   NW-05 and NW-11, and the un-grounded prices in NW-12. **Check the deploy env first; it is the single highest-leverage unknown in this document.**
2. **The quote is born `sent`.** `front-end/islands/AsstChat.tsx:2155-2158` posts `status: "sent"` at creation; the store default
   is `draft` (`backend/src/paperwork/domain/data/quote-store/mod.ts:28`). Explains the premature SENT badge (NW-10) and
   undermines the Draft→Sent→Viewed→Accepted lifecycle (NW-44).
3. **One pricing prompt owns three complaints.** `prompts.suggestPrices` (`lang/en.json:1773` = `lang/es.json:1773`) dictates
   Basic/Standard/Premium labels, never receives the contractor's zip, and never states whether prices include materials
   (NW-08, NW-09, NW-12).
4. **No contractor-side "payment received" surface.** Backend has `POST /payments` + 9 methods + auto-flip to paid; the front-end
   client is read-only (`front-end/clients/payments.ts:35-41`). Closes NW-27, NW-31 (out for payment), NW-32, NW-33 and gives
   NW-29 its hook.
5. **Three forward moves push no back-snapshot** (`AsstChat.tsx:1746-1777`, `:3014-3031`, `:2599-2632`), so back at wizard
   step 0 (= customer) falls through to `/dashboard` (NW-19, NW-20).
6. **Two mirrored "echo the raw text" fallbacks** (`AsstChat.tsx:223-251`, `generate-job-options/mod.ts:233-269`) plus a
   prompt that *instructs* mirroring (`prompts.polishJobDetails.system`, `lang/en.json:1771`) — NW-05, NW-11.
7. **The invoice starter bypasses the quote wizard** (`AsstChat.tsx:1857-1866` `if (invoiceFlow) { openInvoiceCustomerStep(); return; }`)
   and mints without `quoteId`/`lineItems` (`:3431-3439`) — all six of NW-13…NW-18.

### Product decisions the client must make (code cannot)

- **NW-02 vs p61 COMPLETED:** house contact (`hello@paperworkmonster.com` / 866-767-8399) on the customer doc footer directly
  reverses the earlier "Questions before signing? Call <contractor phone> or email <contractor email>" item that shipped.
- **NW-03 / NW-38:** "Just give me a quick quote" is byte-identical to "I know my price" (only the greeting differs) and is still
  live despite "REMOVE THIS."
- **NW-04 / NW-07:** on the job-details step, does the composer or the "Write it myself" box survive? Only the box owns
  "Professionalize that"; a green Cypress spec pins each.
- **NW-37:** the $15-Starter / no-Free pricing ask is superseded by Hans's 2026-08-31 recap that shipped (Free $0 / $99 / $199 /
  custom). Which one stands?
- **NW-44:** lifecycle ships as "Accepted", client wrote "Approved".
- **NW-21 "Yam"**, **NW-53c logo**, **NW-53g "Quote and Agreement change"**, **NW-57 "Contract for new job"** need the
  screenshot / asset / sentence — nothing in the repo matches.
- **NW-51c dialects** and **NW-56 standalone contract drafting** are scope calls, not bugs.

---

## Landing page

- Default language must be Spanish. The toggle at the top should read "Yo hablo Espanol | I speak English", with "Yo hablo Espanol" selected by default. [p2]
  - **NW-01 ◩ PARTIALLY BUILT — default ✅, labels ✅, order ❌ (EN button renders first).** Effort S.
  - Evidence: default is unconditionally Spanish — `front-end/lib/lang.ts:374-381` `pickLangFromAcceptLanguage()` returns `"es"`
    for everyone; `lang.ts:15` `langSignal("es")`; `routes/index.tsx:199-203` precedence `?lang` > `pm_lang` cookie > es;
    `static/landing-scripts.js:359`. The toggle at `routes/index.tsx:288-310` already carries the exact strings ("I speak English" /
    "Yo hablo Español") and the `on` class binds to `lang === "es"`, but the `data-lang="en"` button is the first child. Strings
    are hard-coded in the route (no lang key); `/landing` orders ES first (`routes/landing.tsx:119-131`), so the two landings
    disagree. JS/CSS are order-agnostic (`landing-scripts.js:448-471`, `landing.css:3114-3119`).
  - Fix: swap the two `<button>` blocks at `routes/index.tsx:289-309`; keep the accent ("Español"). Optionally extract both labels
    to `lang/*.json` for parity with `/landing`.
  - Tests: none pin label/order (`cypress/e2e/landing-mobile-390.cy.ts:66-82` measures alignment only; `jest/integration/landing-pages.int.test.ts:113-120` pins `<html lang="es">`).

- Footer contact info should be email `hello@paperworkmonster.com` and phone `866-767-8399`. (Screenshot: the "Questions about your project?" footer currently shows the contractor's own phone and gmail.) [p24]
  - **NW-02 ⬜ NOT BUILT + ❓ contradicts p61 COMPLETED.** Effort S (M with the decision).
  - Evidence: the footer is one component, `front-end/components/quote-doc.tsx:695-742`, gated on `contractor?.phoneNumber || contractor?.email`,
    rendering `quoteDoc.qBefore` ("Questions before signing?", `lang/en.json:868`) or `quoteDoc.qSigned` ("Questions about your
    project?", `:869`; variant from `shared/quote-flow/public-doc-state.ts:32-69`) + `callWord`/`orWord`/`emailWord`/`lookForward`
    (`:807/:862/:848/:853`). The values come from the contractor's *user row*: `backend/src/paperwork/entrypoints/public-controller/mod.ts:906-934`
    `loadContractor` → `phoneNumber: user?.phoneNumber, email: user?.email`. Same footer duplicated on the public invoice
    `front-end/routes/i/[id].tsx:507-546` (`publicInvoice.footer.*`, `lang/en.json:1808-1813`). Zero hits for
    `hello@paperworkmonster.com` anywhere; the only 866 number is the landing footer `routes/index.tsx:1220`.
  - Cause: by design — the p61 "COMPLETED" item ("Call 540-333-1334 or email hp@hans.work!") is this template filled with Hans's
    own profile. The new ask reverses that policy.
  - Fix (if house contact wins): `shared/quote-flow/support-contact.ts` constants; swap them in at `quote-doc.tsx:695-742` and
    `routes/i/[id].tsx:507-546`; drop the render gate so the footer always shows. Leave `public-controller` alone — the From block
    (NW-06) still needs the contractor's contact.
  - Tests: `jest/unit/public-doc-state.test.ts:144-152` + `cypress/e2e/public-doc-state.cy.ts:305-318` pin the variant switch only.

- What is the difference between "Just give me a quick quote" and "I know my price, write it up"? [p25]
  - **NW-03 ❓ PRODUCT QUESTION — answered: there is no difference.** Effort S to remove.
  - Evidence: `AsstChat.tsx:3225-3251` `startKnownPriceFlow` and `startQuickQuoteFlow` are identical except `setFlowChip(...)`;
    the comment at `:3219-3224` says "Per roadmap p.11 the two are merged". `flowChip` is read only to pick the greeting bubble
    (`:4335-4347`) and for invoice chips (`:4371`); `submitJobDetails` branches only on `suggestPricing` (`:2440-2451`), false for
    both. Greetings: `shared/quote-flow/starter-chips.ts:22-45` (knownPrice "Great — you know your price…", quickQuote "Quick quote
    coming up…"); the intents at `:16-21` are never consumed. Its own header says "today a dup of knownPrice" (`:9-11`).
    Chip still live: `AsstChat.tsx:4886-4892`, `asstChat.prompt.quickQuote` (`lang/en.json:357` / `es.json:357`). Logged open in
    `TDD-QUOTE-FLOW.md:44` row 21; `cypress/e2e/quotes-help-me-price.cy.ts:79-85` is an `it.skip("[DECIDE p17]…")`.
  - Fix (if "REMOVE THIS" on p35 stands, see NW-38): delete the button, the handler, the `quickQuote` entries in `starter-chips.ts`,
    and the lang key; update `jest/unit/assistant-contracts.test.ts:143-160` (pins four chips) and the skipped Cypress case.

## My Assistant → "I know my price, write it up"

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

- The AI must never echo the user's raw input back as the suggested description. (Screenshot: all three "I Need To" options just repeat "I need to replace a toile for $500".) We are the ones professionalizing the quotes. Claude and ChatGPT get this right every time. Until this is solved we cannot produce even simple quotes and invoices. [p4]
  - **NW-05 🐛 CONFIRMED in three places; the screenshot is reproducible from source, and the prod path CAN produce it.** Effort L.
  - Evidence — the echo: `backend/src/agents/domain/coordinators/generate-job-options/mod.ts:233-269` `fallbackOptions()` splits raw
    on `[\n.;]`, so "I need to replace a toile for $500" (no separators) → `base = [raw]`; opt1 = raw, opt2 = raw, opt3 = raw +
    `generateJobOptions.jobsiteCleanup` (`lang/en.json:1099`). Title: `clampJobName` (`:210-221`) takes the first three words
    title-cased → **"I Need To"**, then `versionTitle` appends " · Short version" / " · Wider scope"
    (`shared/quote-flow/version-titles.ts:44-51`). The frontend mirrors it in `AsstChat.tsx:223-251` `localFallbackOptions()` and
    **paints it first, before any server call** (`:1899-1903`, `:1936-1940`), keeping it if the request fails or the user touched
    anything (`optionsTouchedRef` `:1916`, `:1955`). `polish-job-details/mod.ts:152-160` also returns `description: raw`.
  - When it happens: (1) stub LLM — `backend/src/agents/mod-root.ts:53-61` binds `StubLLMClient` unless `AGENTS_LLM_CLIENT==="openai"`;
    the stub's `"(stub) …"` fails `tryParseJson` (`:186-203`) → `normalizeOptions` → `[]` → fallback, every time.
    `TESTS-UX-PROBLEMS.md:134-135` and `jest/integration/ux-job-name.int.test.ts:25-31` document this as the known behaviour under
    test. ⚠ Prod: root `deno.json:6` `start` does not set the var; only `backend/deno.json:3-4` and `serve.ts:40-42` do; no deploy
    config in the repo. (2) real LLM but failure/timeout: `generate-job-options/mod.ts:114-117` catch + FE catch `:1907-1913`.
    (3) healthy LLM: the echo still flashes first. (4) Prompt: `prompts.generateJobOptions` (`lang/en.json:1763`) never forbids
    verbatim output; `prompts.polishJobDetails.system` (`:1771`) literally says "mirror it back cleaned-up rather than padding".
  - Fix: (a) verify/force `AGENTS_LLM_CLIENT=openai` on the composed prod entry and fail loudly at boot when the key is absent;
    (b) rewrite both fallbacks to derive scope bullets (strip "I need to…", drop the price clause) or show an honest "couldn't
    draft — write it yourself" instead of echoing; show the `asstChat.jobOpts.writing` spinner (`:3898-3906`) instead of the
    heuristic paint; (c) add "never return the contractor's sentence verbatim" to `prompts.generateJobOptions` and delete the
    "mirror it back" clause, in both dicts.
  - Tests: none pin "no echo". `ux-job-name.int.test.ts:163,181`, `jest/unit/ux-job-name-es.test.ts`, `cypress/e2e/ux-help-me-price.cy.ts:76,88`
    *depend on* the fallback and will need updating. Same defect as NW-13 (p20).

- Make sure the "From" block includes email and website when the Dragon has provided them. (Screenshot shows only name and phone.) [p5]
  - **NW-06 ◩ email already wired everywhere; website does not exist in the data model; plus one real bug.** Effort S (prop) / M (website).
  - Evidence — email renders in all four From surfaces: `front-end/components/quote-doc.tsx:396-403` → `PartyCard`
    (`doc-parts.tsx:183-248`, email row `:223-239`); assistant preview `AsstChat.tsx:5571-5625` (`from.email`); PDF
    `render-quote-pdf/mod.ts:161-166`; email template `send-paperwork-email/mod.ts:392-403`. Source `public-controller/mod.ts:920-926`
    `email: user?.email` (Settings `SettingsPage.tsx:361-372`). Onboarding lets the email be skipped (`lang/en.json:165`
    "name@yourbusiness.com — or 'skip'"), so an empty field renders nothing — the likely screenshot cause.
  - 🐛 Bug: `front-end/routes/assistant/index.tsx:97-104` mounts `<AsstChat>` **without the `from` prop** (compare
    `routes/assistant/[threadId].tsx:148-153`), so a conversation started at `/assistant` drops the whole From block (`:5571` guard).
  - Website: no field anywhere — `backend/src/users/dto/business-identity.ts:110-172` has none, `PublicContractor`
    (`public-controller:878-903`) has none, Settings has no input, `PartyCard` has no prop. `front-end/clients/profile.ts:20`
    `websiteUrl?` is a dead FE-only type.
  - Fix: (1) one-liner `from={{…}}` in `routes/assistant/index.tsx:97`; (2) add `websiteUrl` through DTO → store → `PublicContractor`
    → Settings input → `PartyCard`/preview/PDF; (3) nudge when email is empty (precedent `fromNeedsName` `:5587-5598`).
  - Tests: `jest/unit/ux-page-copy.test.ts:58-69` + `cypress/e2e/ux-doc-preview.cy.ts` (UX-15 phone) only.

## My Assistant → "I know the job, help me price it"

- Again shows both "Write it myself" and the "Ex: Customer wants…" placeholder. We don't need both. [p6]
  - **NW-07 🐛 same component as NW-04.** `startHelpMePriceFlow` (`AsstChat.tsx:3260`) and `startKnownPriceFlow` (`:3226`) both land on
    the single `chat__details-flow` arm (`:4326`). One fix closes both. Effort S once NW-04's product call is made.

- The price tiers cannot be "Basic / Standard / Premium" with descriptions like "Basic paint job with minimal prep". That sounds terrible, like you'll do shit work for less money. Use the structure we settled on earlier (names may have changed): [p7]
  - **Competitive** — price-conscious bid when the job is straightforward and winning the work is the priority.
  - **Market** — typical professional price for this type of work in your area.
  - **Premium** — appropriate for urgent scheduling, difficult access, higher service expectations, or other job complexity.
  - **NW-08 🐛 NOT BUILT as specified — "Competitive"/"Market" appear nowhere in lang or backend.** Effort M.
  - Evidence: the prompt `prompts.suggestPrices` (`lang/en.json:1773`, byte-identical in `es.json:1773`) dictates
    `{ "tier": "basic", "label": "Basic" … "standard" … "premium" }` and "ascending price: basic < standard < premium".
    `backend/src/agents/domain/coordinators/suggest-prices/mod.ts:19` types `tier: "basic"|"standard"|"premium"`; `normalize()`
    `:73-104` forces ids positionally and takes the model's `label` verbatim, else `suggestPrices.tier.*` (`lang/en.json:2368-2370`
    Basic/Premium/Standard; `es` Básico/Premium/Estándar); fallback rationales `:2365-2367` ("Core scope, essentials only" /
    "Premium materials, extra finish" / "Full scope, typical materials"). `AsstChat.tsx:4793-4816` renders `t.label` + `t.rationale`
    raw — "Basic paint job with minimal prep" is LLM rationale text.
  - Fix: rewrite the prompt in both dicts with `competitive|market|premium` and the three client definitions as rationale
    guidance (better: fixed localized labels client-side, LLM supplies numbers only); rename the `suggestPrices.tier.*` /
    fallback keys; widen the union + `tiers`/`labels` arrays at `suggest-prices/mod.ts:19,75-78,124-142`. No AsstChat change.
  - Tests: `cypress/e2e/quotes-help-me-price.cy.ts:54-55` only counts three `[data-cy=pricing-option]` + custom.

- When calculating the price, are you using the Dragon's zip code? [p7]
  - **NW-09 ⬜ answered from code: NO — nothing geographic reaches the pricing call.** Effort M.
  - Evidence: `front-end/clients/assistant.ts:365-372` posts `{ raw }` only; `job-details-controller/mod.ts:84-98` passes
    `{userId, raw, lang}` (its siblings `polishDetails`/`generateOptions` *do* read `BusinessIdentityStore` at `:32-50`);
    `suggest-prices/mod.ts:7-15` input = `userId, raw, lang`; `:56-62` content = `"Raw job description:\n${raw}"`; the prompt says
    "typical US small-contractor pricing" (national). Data exists unused: `backend/src/users/dto/business-address.ts:9,19` `postal?`.
  - Fix: inject the address store into `SuggestPrices`, add zip/city/state to the input and a "price for this market" rule to
    the prompt. Tests: none.

- The Quote + Agreement card shows a "SENT" badge in the top right before I have actually sent it. [p8]
  - **NW-10 🐛 CONFIRMED — the quote row is created with `status:"sent"`.** Effort S (FE) / M (with backend).
  - Evidence: review-card chip `AsstChat.tsx:5400-5407` reads `statusChipLabel(quote?.status ?? lockedPayload.status)`
    (`:325-340` → `status.sent`, `lang/en.json:2362` "Sent"). `startQuoteFromRaw` (`:2155-2158`, called from `onPriceContinue`
    `:1874`) posts `POST /quotes { ...quoteFields, status: "sent" }` — the store default is `draft`
    (`backend/src/paperwork/domain/data/quote-store/mod.ts:28`). The real send is `confirmSendFromReview` `:2816`. On the chat
    action-card path, `lock-quote/mod.ts:80` also stamps `sent`+`sentAt` at *lock* time and `:120` puts it on the card payload.
    Contradicts `shared/quote-flow/quote-status.ts:10-15` (draft→sent→viewed→accepted).
  - Fix: drop `status:"sent"` at `:2157` (let the store default), and move the flip out of `lock-quote` into the actual send
    coordinator (adjust the `sentAt`-derived stage, `lock-quote/mod.ts:74-79`).
  - Tests: `jest/unit/quote-status.test.ts`, `jest/integration/quote-lifecycle.int.test.ts:23` ("freshly created quote is a
    draft"), `cypress/e2e/quotes-status-badges.cy.ts:68` — all bypass the assistant path; nothing asserts `.quote-review__chip`.

- Confirm the "Confirm your job details" page is working correctly. (Screenshot: the three options are the raw text verbatim; "Wider scope" only adds "Jobsite cleanup".) [p20]
  - **NW-11 🐛 CONFIRMED — the screenshot is the client-side heuristic, painted before the LLM answers.** Effort M (shares NW-05).
  - Evidence: `openJobPickerForConfirm` `AsstChat.tsx:1933-1945` sets `setOptionsLoading(false)`, paints `localFallbackOptions`
    (`:223-251`: opt1 = raw bullets, opt2 = minus last, opt3 = + `asstChat.jobsiteCleanup` `lang/en.json:264`), then awaits
    `generateJobOptions` and swaps only if `!optionsTouchedRef.current`. "· Wider scope" from `shared/quote-flow/version-titles.ts:25-31`.
    Backend fallback identical (`generate-job-options/mod.ts:240-252`). Headings `lang/en.json:251-252`, rendered `:3887,3892`.
  - Fix: `setOptionsLoading(true)` at `:1936` and await before painting (spinner branch exists `:3898-3906`); keep the heuristic
    strictly as an error path and make both fallbacks honest. Tests: `cypress/e2e/quotes-help-me-price.cy.ts:39` pins flow shape only.

- Price comparison for the same scope (2,000 sq ft house, two coats, baseboard and crown molding, 12 door jambs, 15 windows, all ceilings): PM offered $3,000 / $4,500 / $6,000; Claude estimated roughly $7,500–$11,600; ChatGPT estimated $6,500–$16,000. For PM I don't know whether that includes materials. That is a vital question. [p21]
  - **NW-12 🐛 answered from code: the basis is UNDEFINED — the prompt never says whether materials are included.** Effort M (L for a quantity-based estimator).
  - Evidence: `prompts.suggestPrices` (`lang/en.json:1773`) has only "Base the numbers on typical US small-contractor pricing …
    reasonable mid-market range" — no materials/labor statement. The fallback copy `lang/en.json:2366-2367` mentions "materials"
    (implying included) but the live LLM never receives that instruction. No app math: `normalize()` `suggest-prices/mod.ts:73-104`
    rounds, rejects ≤0, sorts — no multiplier. Fallback constants `:124-142` are $500/$850/$1,200 (1 : 1.7 : 2.4), which does
    **not** match 3000/4500/6000 (1 : 1.5 : 2) → the client's numbers were raw `gpt-4o-mini` output
    (`backend/src/agents/domain/data/openai/mod.ts:17` `DEFAULT_MODEL`, `OPENAI_MODEL` override). The repo itself calls that model
    unreliable for this domain (`lock-quote/mod.ts:30-32`).
  - Fix: state the basis in the prompt ("prices INCLUDE labor and materials unless the contractor says otherwise; say so in the
    rationale"), require reasoning from quantities (sq ft, coats, openings), surface the basis on the tier card; consider a
    stronger model for this call. Tests: none assert magnitude, ratio or a materials disclosure.

## My Assistant → "Job's done, need invoice"

Flow as built (`AsstChat.tsx`): chip `:4893-4899` → `startInvoiceFlow` `:3275-3316` (fetches first 3 won quotes as chips) → details
`:4327-4576` → price `:4749-4868` → `onPriceContinue` `:1857-1866` **returns before the wizard** → customer `:4730-4747` →
`createInvoiceFromFlow` `:3333-3410` (due = today+30) → review card `:4676-4728` (amount, name, one date input) →
`saveInvoiceFromReview` `:3414-3458` `POST /invoices {customerId, amount, dueDate, issuedDate, status:"sent", jobName, description}` —
**no `quoteId`, no `lineItems`** (`:3431-3439`) → success card `:4577-4675`. Backend parity path exists and is green
(`invoice-controller/mod.ts:213-224` derives from `quoteId`; `public-controller/mod.ts:707-728` emits terms/dates/`signedQuoteUrl`
only with `quoteId`) — the assistant just never uses it.

- On the landing page we do not say "Write it myself". Go through the same prompt as "I know my price, write it up". The invoice needs all the same terms as a quote, and that process is already built. [p9]
  - **NW-13 🐛 CONFIRMED — asks 0 of the 4 term questions; backend parity unused.** Effort L (with NW-24).
  - Evidence: quote wizard = customer / start_date / wraps / payment_terms / warranty
    (`backend/src/agents/domain/business/terms-wizard-spec/mod.ts:21-119`; questions `lang/en.json:910,932,945,923,936`) then job
    picker, preview, send. Invoice = details → price → customer → due date → save; comment `:3270-3274` "no signature, no terms".
  - Fix: route the invoice chip through the same wizard (swap `wraps` for a completion-date step) and mint with `quoteId`.
  - Tests: `jest/integration/invoice-parity.int.test.ts` pins the *API* only; nothing drives the assistant chip's questions.

- If you select the invoice of an existing client, the next page must show what they paid, what they owe, the terms, etc. Drafting a brand-new invoice that is not from a quote can keep the current screen, but selecting an existing quote must go down that path. [p10]
  - **NW-14 ◩ FE not built; backend partially exposes it.** Effort M + S.
  - Evidence: no picker — three chips at `AsstChat.tsx:3298-3313` whose `.map` **drops `id` and `customerId`** (label
    `acceptedJobChipLabel`, `shared/quote-flow/quick-quote-prefill.ts:122-136`). After selection (`:4377-4393`) → price capture with
    a recap only (`:4769-4780`). Backend: `ComputeInvoiceBalance {amount, paidTotal, balance}` (`compute-invoice-balance/mod.ts:36-58`)
    is only a side effect of `payment-controller` (`:28,53,63`) — no read endpoint; `GET /payments?invoiceId=` (`:32-41`) exists;
    public payload has `siblings[]`/`agreementTotal`/`terms` (`public-controller:675-720`) only with `quoteId`. 🐛 Side-find:
    `build-customer-cards/mod.ts:107-118` `balanceCents` counts only `status === "pending"`, but the lifecycle is
    `scheduled|draft|sent|viewed|claimed|paid|void` (`backend/src/paperwork/dto/invoice.ts:16-23`) → a `sent` invoice shows $0 owed on `/customers`.
  - Fix: carry `{id, customerId}` on the chips; on pick, show a quote-summary card from `GET /quotes/:id` + a new
    `GET /invoices?quoteId=` (reuse `billedTotalCents` from `shared/quote-flow/milestone-reconcile.ts`).

- If I select an existing quote it should already know who the customer is. (Screenshot: it asks "What's the price?" again.) [p11]
  - **NW-15 ⬜ CONFIRMED.** Effort M.
  - Evidence: `:4377-4393` sets `priceCents` (prefill only) and `prefillCustomerName` (a *name string*, passed as `initialName`
    `:4742`) then `setPriceCaptureOpen(true)` → heading `asstChat.price.whatTitle` (`lang/en.json:349` "What's the price?") — the
    screenshot. `createInvoiceFromFlow` still requires a pick/create (`:3379` `needCustomer`). `POST /invoices` has no `quoteId`.
  - Fix: keep `{quoteId, customerId}`; on pick, skip to a review seeded from `GET /quotes/:id` with the price *editable*, not asked.
    Tests: none (`cypress/e2e/ux-assistant-prefill.cy.ts` is quick-quote only).

- This entire process is really bad. It is not different from the quote. We need to preview it, edit it, provide all the relevant information, etc. [p12]
  - **NW-16 🐛 CONFIRMED — a real invoice preview exists but is unreachable from this flow.** Effort M.
  - Evidence: the review card `:4676-4728` shows amount (read-only), name, due date, save — nothing else. The real preview is the
    quote review's doc-type toggle `reviewDocType` `:5477-5531` (`asstChat.preview.invoiceModeNote` `lang/en.json:310`,
    `sendInvoice` `:325`) — and even that path (`confirmSendInvoiceSwap` `:3467-3540`) posts without `quoteId`/`lineItems`
    (`:3478-3486`), so the public `/i/:id` renders the amount-only shape.
  - Fix: reuse the quote-review preview with `reviewDocType="invoice"`; add `quoteId` + `lineItems` to both `POST /invoices`.
    Tests: `cypress/e2e/ux-invoice-review.cy.ts` (UX-31) pins only "a review exists, due date ≠ today"; `invoice-parity.cy.ts` pins `/i` + `[data-cy=invoice-edit]` on `/invoices`.

- The chip at the bottom reads "I know the job, help me price it.Write it myself". Needs a space after the period and a period at the end of "myself". [p26]
  - **NW-17 ⚠ concatenation not reproducible in the render tree; 🐛 the missing period is real.** Effort S.
  - Evidence: `asstChat.prompt.helpPrice` (`lang/en.json:354` "I know the job, help me price it.") renders once, as a chip
    (`:4879-4885`); `asstChat.jobOpts.customTitle` (`:256` "Write it myself", no period) at `:4186/:4409/:4418`. Chips and the
    details step are exclusive ternary branches (`:3875, :4327, :4577, :4676, :4730, :4749`, else `:4870-4901`). The nearest
    adjacency: the prompt bubble ends "." and the next sibling is the `.chat__details-writeself` pill → a text extraction reads
    "….✎ Write it myself". Dead key noticed: `asstChat.price.backToPrompts` (`:342`) has zero references.
  - Fix: add the period to `customTitle` in both dicts; give `.chat__details-writeself` a separator/margin (`static/assistant-page.css:8225-8241`).

- This is a different prompt path and structure from the quote. It should be the same: if there is no quote to select, go through the same questions as the quote (skip how long it took, but ask for the completion date). Right now there is no preview, just "Invoice ready 🎉 … Send it now". That is not what we want. [p27]
  - **NW-18 🐛 CONFIRMED (same fix as NW-13/NW-16).** Effort L.
  - Evidence: copy `asstChat.invoiceFlow.readyTitle` (`lang/en.json:244` "Invoice ready 🎉", render `:4585`), `readySub` (`:243`),
    `sendNow` (`:247`, `:4635`). The invoice is created `status:"sent"` (`:3437`) *before* "Send it now" posts `/email` + `/text`
    (`:4602,:4608`). Skipped vs the quote: start_date ❌, wraps ❌ (correct per the ask), payment_terms ❌ (raw `dueDate` `:4699-4710`),
    warranty ❌, job picker ❌ (`:2445-2449`), preview ❌; **completion date does not exist anywhere** (only `issuedDate: today` `:3430,:3436`).
  - Fix: `terms-wizard-spec` gets a `completion_date` step for invoice mode (new `termsWizard.completionDate.*` keys, both dicts);
    land on the shared preview; mint with `quoteId`.

## Quote flow: steps, back button, customers

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

- Back button fails after you enter the price and go to the customer step. Hitting back takes you to the dashboard. [p31]
  - **NW-20 🐛 CONFIRMED for the chat/CTA entry; fixed for the price-panel entry by `4a1457a` but unpinned.** Effort S + S (spec).
  - Evidence: `customer` is wizard step **0** (`terms-wizard-spec/mod.ts:22-34`), so `assistant-back.ts:50` `(stepIdx ?? 0) > 0` is
    false and `:53` returns `"exit-dashboard"` (`AsstChat.tsx:1135-1137` → `/dashboard`; also `:1104-1110`) unless the snapshot stack
    is non-empty. Price panel path pushes before the hard navigation (`:2180-2184`, restored `:1145-1156`). Chat → action card →
    "Lock it in" → CTA → `transition-to-terms` pushes nothing (`:1746-1777`, `:3014-3031`, `:2599-2632`) → depth 0 + step 0 → dashboard.
  - Fix: the two `pushHistory()` calls from NW-19; optionally let the resolver treat "step 0 with a bound quote" as rewind-to-price.
  - Tests: **none** walk chip → details → price → customer → back. `jest/unit/assistant-back.test.ts:47-50` asserts the *current*
    exit behaviour ("empty stack at the wizard's first step → exit") and must be revised.

- The new-customer name field placeholder says "Yam". [p14]
  - **NW-21 ⚠ CANNOT VERIFY — "Yam" occurs nowhere in the repo except this transcript.** Effort S once located.
  - Evidence: placeholder = `tFor("asstChat.customerStep.name")` (`AsstChat.tsx:7778`, used `:7786-7787`; `lang/en.json:193` "Name" /
    `es` "Nombre"); `tFor` falls back to the key, never to arbitrary text (`front-end/lib/i18n.ts:33-36`). Most likely the client
    saw a prefilled *value*: `initialName → createName → value={createName}` (`:7666-7672`, `:7788`) from `prefillCustomerName`
    (`:4742`, `:6729`) ← `extractCustomerName()` (`shared/quote-flow/quick-quote-prefill.ts:66-98`, lifts Capitalized tokens after
    "for"/"para"; carried via `sessionStorage pm:custprefill:<convId>` `:2197-2203`). A sentence containing "…for Yam…" yields exactly "Yam".
  - Fix: need the screenshot or typed sentence. If prefill, tighten `extractCustomerName`. Tests: `jest/unit/ux-quick-quote-prefill.test.ts`.

- I created a new customer ("Incredible Hulk", business "Green Machine") and it did not save. [p15]
  - **NW-22 ⚠ not reproducible from code — the create path is real and persists `businessName`; two UI mechanisms explain the report.** Effort M.
  - Evidence: quote wizard form `:7826-7851` → `submitCustomerStep` `:3073-3093` → `POST /agents/wizard/answer` →
    `handle-wizard-answer/mod.ts:238-291` `customers.create({name, email?, phoneNumber?, isBusiness?, businessName?})`
    (`customer-store/mod.ts:35-45`); invoice flow `:3359-3370` → `POST /customers`. `/customers` lists every row
    (`build-customer-cards/mod.ts:55-70`); `ClientsBoard.tsx:127,150-151` renders `businessName`.
    Mechanism 1: the dropdown's text input is a **search filter** (`:7955-7974`); no-match renders `common.noMatches`
    (`:7978-7983`) with no create affordance — the real create is the separate "+ New customer" button (`:8009-8018`,
    `lang/en.json:195`). Mechanism 2: Next is silently disabled without a phone or email — `:7760` `hasContact`, `:7775-7776`
    `submitDisabled = … || !hasContact || emailIsOwn || phoneIsOwn` (hint `asstChat.customerStep.needContact` `:194`), whereas
    `ClientsPage.tsx:235` allows name-only. Also `handle-wizard-answer:254-272` throws if the contact equals the contractor's own.
  - Fix: add a `Create "<search>"` row in the no-match state (`:7978-7983` → `openCreate()` + `setCreateName(search)`); replace
    the silent disable with a visible error, or align the gate with the Customers page.
  - Tests: `jest/integration/customer-pick.int.test.ts:36-50`, `jest/unit/customer-step.test.ts`, `cypress/e2e/ux-assistant-pick-customer.cy.ts:74-88`
    all pin `pick_existing`; none pins "created in the assistant → appears on /customers" or the no-contact case.

- "When does the job start?" has a "Job Completed" option. Remove it and put "Pick a date" in its place. Change "Next Month" to "Next month". [p22]
  - **NW-23 ◩ "Pick a date" already exists (last option, real calendar); the ask reduces to one delete + one lowercase.** Effort S.
  - Evidence: `terms-wizard-spec/mod.ts:36-50` `start_date` options: `asap` "Right away" (`lang/en.json:926`), `next_week`
    "Next week" (`:931`), `next_month` **"Next Month"** (`:930`; es "El próximo mes"), `job_completed` "Job Completed" (`:928`,
    hand-added at `:43-47` "Roadmap p.4/5: paperwork written AFTER the work happened", paired with `due_now` `:71-73`), `custom`
    "Pick a date" (`:927`, `isCustom` → `CustomDatePickerForm` `AsstChat.tsx:6874-6883`, `:8184+`). The `wraps` step has its own
    separate `job_completed` (`:60-63`) — not a shared list.
  - Fix: delete `:43-47`; `lang/en.json:930` → "Next month" (lookup tables already carry both spellings: `front-end/lib/term-i18n.ts:24-25`,
    `render-quote-pdf/mod.ts:863-864`, `render-invoice-pdf/mod.ts:707-708`). Tests: none pin labels; `i18n-dictionary-consistency` enforces key parity.

- Change "Job Completed" to "Job completed" (lowercase c). [p23]
  - **NW-24 🐛 copy change with a persistence trap.** Effort S.
  - Evidence: `lang/en.json:890` `quoteDoc.termValue.jobCompleted`, `:928` `termsWizard.startDate.jobCompleted`, `:941`
    `termsWizard.wraps.jobCompleted`, `:2185` `renderQuotePdf.termValue.jobCompleted`. ES already "Trabajo terminado". Term values
    are **persisted in English and re-localized by exact string match**: `front-end/lib/term-i18n.ts:26`, `render-quote-pdf/mod.ts:865`,
    `render-invoice-pdf/mod.ts:709` key on `"Job Completed"`.
  - Fix: lowercase the four values and add a `"Job completed"` entry beside the old key in all three maps (pattern: "Next Month"/"Next month").

## Sending, signing, and the customer link

- On "send": the email went out but the text failed with Twilio 400, error 21211 "Invalid 'To' Phone Number: +1555555XXXX". Assume it is just because I used a fake cell number. I did receive the quote via email. [p16]
  - **NW-25 🐛 the guess is right (Twilio rejects 555 fictional numbers with 21211), but three defects sit under it.** Effort M.
  - Evidence: the only gate before Twilio is shape-only — `send-paperwork-sms/mod.ts:365-373` `normalizeE164` (10 digits → +1,
    11 starting 1 → +); `users/domain/business/normalize-phone/mod.ts:8-28` same (its own test uses `(512) 555-1234` as valid). No
    fictional/21211 guard anywhere in `backend/`. `users/domain/data/sms/mod.ts:93-99` returns the raw Twilio JSON as the reason
    string. Assistant quote send is honest (`send-quote/mod.ts:237-241` → `sendQuote.divider.emailedTextFailed`,
    `lang/en.json:2206`; recovery card `AsstChat.tsx:5036-5038` matches `/Invalid|21211/`). **Invoice sends are not**:
    `InvoicesPage.tsx:1494-1498` `delivered: email.delivered || text.delivered`; `:1684-1687` and `:1717-1719` reload on
    `delivered`; `d.text` is never read; `dispatchFailureCopy` `:1504-1513` reports only email.
  - Fix: reject the 555 exchange in `normalizeE164`/`normalize-phone` with a translated reason; map Twilio 21211/21610/21614 to
    lang keys in `sms/mod.ts`; per-channel outcomes in `InvoicesPage.tsx:1494`.
  - Tests: `jest/unit/send-result.test.ts:60-124` (P-09), `cypress/e2e/invoice-send-honesty.cy.ts` (no-channel case only). Nothing pins 555 rejection or partial failure.

- From the emailed link I filled in the "Ask a question" box at the bottom of the quote ("Question sent — your contractor will follow up directly"), but I never received the question. Where does it go? [p17]
  - **NW-26 ⬜ answered: into one notification KV row that no shipped UI displays in full. Nothing is emailed or texted.** Effort M.
  - Evidence: `PublicQuoteActions.tsx:318-325` → `POST /api/quotes/:id/inquiry {question, contactBack, name}`; success copy
    `lang/en.json:1886` "✓ Question sent" / `:1885` "Your contractor will follow up directly." Backend
    `public-controller/mod.ts:574-603` only emits a domain event (JSDoc `:569-573`: "lands as a notification on the contractor's bell
    + activity feed"). Only sink: `notify-on-event/mod.ts:237-247` (`customer_replied`, title `notify.quote.inquiry`
    `lang/en.json:1502` "{name} asked a question", body truncated to 140). Why nothing arrives: (1) the bell is not built —
    `DashTopbar.tsx:159-162`; (2) the activity feed renders the title only, never `n.body` — `DashboardPage.tsx:250-258`; (3)
    `contactBack` is dropped (`public-controller:598` → never read); (4) no `SendInquiryAlert` (compare `SendAcceptedAlert` fired at
    `:497`); (5) `/messages` is a 302 to `/assistant` (`routes/messages/index.tsx:6-12`).
  - Fix: new `send-inquiry-alert` coordinator (model on `send-accepted-alert`) that emails + texts the contractor the full
    question and `contactBack`, logged via `LogPaperworkMessage`; render `n.body` in the feed.
  - Tests: `backend/src/paperwork/entrypoints/public-controller/e2e.test.ts:208-225` asserts `ok` only; `cypress/e2e/public-doc-state.cy.ts:320` (P-63) panel state only.

- How do you mark an invoice paid? We are not taking payments, so the client has to tell us payment has been received. (Screenshot: the "Out for payment" invoice detail only offers Discount, Change order, View invoice, Open, Mute.) [p18]
  - **NW-27 ◩ answered: today only *after the customer clicks "I sent it"* on `/i/:id`. No contractor-initiated path.** Effort M.
  - Evidence: stage derived `InvoicesPage.tsx:192-204` (paid > claimed > scheduled > drafting > overdue > out); `out` action row
    `:2278-2318` = View invoice / Open / Mute, detail panel `:1156-1180` = Edit / Discount / Change order — exactly the screenshot.
    `confirm-payment/mod.ts:59-62` hard-requires `invoice.paymentIntent` (409 `no_payment_intent` for `out`). `POST /payments`
    exists (`payment-controller/mod.ts:22-30`) but `front-end/clients/payments.ts:35-41` is read-only; `/invoices/record-payment/voice|photo`
    (`invoice-controller:378-410`) have zero FE callers. Customer path: `PublicInvoiceClaim.tsx:33-34,91-99` "I sent it" → `claimed`.
  - Fix: "Payment received" on `out`/`overdue` → method picker (reuse `PublicInvoiceClaim.tsx:142-232` chips, `PaymentMethod` union
    `clients/payments.ts:12-21`) → `POST /payments` (add `create` to the client); relax `ConfirmPayment` to accept an explicit
    `{amount, method, reference?}` without an intent so the receipt path fires. Root cause #4 — same fix as NW-32/34/35.

- 04 SIGN HERE: "By signing below, Thing agrees to everything above." (currently "agree"). Contractor box: "CONTRACTOR SIGNATURE", business name (HANS LLC), the signature, "By: Hans Pedersen", "Date: May 23, 2026". Customer box: "YOUR SIGNATURE — Sign & type name below". Everything else the same. (The Spanish signed view already has this layout.) [p19]
  - **NW-28 ◩ the named sentence is already built and wired; the client saw the no-customer-name fallback. EN/ES layout divergence is not reproducible.** Effort S (M with PDF parity).
  - Evidence: `lang/en.json:805` `quoteDoc.bySigning` "By signing below, you agree…" and `:806` `bySigningNamed` "By signing below,
    {name} agrees…" (es `:806` "…{name} acepta…"); `shared/quote-flow/signature-block.ts:33-41` builds `agreementLine`, business
    heading, `By: <name>`, `Date: May 23, 2026`. `quote-doc.tsx:250-271` picks the named form whenever `customerName` resolves
    (`t.bySigning` `:147-150`), for **both** languages (one markup tree `:491-601`). `customerName` = `quote.customer?.name?.trim()`
    (`:222`) — so "you agree" appears only when no customer is bound, which lines up with NW-22. Contractor heading
    `quoteDoc.contractorSignature` (`:841`, CSS uppercase `:505-512`), `By:` `:804`, `Date:` `:843`, customer heading
    `quoteDoc.yourSignature` (`:906`, uppercase `:585-589`), subline `signTypeBelow` `:872`. Cosmetic divergences: EN-with-name
    instruction lacks the "↓" (`:269-271`); `sig.customer.heading` "YOUR Signature" is dead copy (card uses `t.yourSignature` `:588`).
    **PDF** (`render-quote-pdf/mod.ts:544-672`) has no "By signing below" sentence and uses "CONTRACTOR"/"CLIENT SIGNED"
    (`lang/en.json:2173/2172`); email HTML has no signature block.
  - Fix: default `clientName` to `acceptedName ?? customer.name` and drop the `lang === "en" && sig` fork; align the "↓"; add the
    sentence + "YOUR SIGNATURE" to the PDF block.
  - Tests: `jest/unit/signature-block.test.ts:20-40` green; `cypress/e2e/public-quote-signature.cy.ts:101-124` pins the named EN case.
    None for the no-name fallback, ES, or the PDF. `TDD-QUOTE-FLOW.md:41` row 18.

## Invoices tab

Stage table from `front-end/islands/InvoicesPage.tsx` (stage `:192-202`; CTA `:1576-1586` → handlers `:1722-1732`; card back `:2270-2320`):

| Backend status | UI stage / track title | Front CTA → action | Card-back extras |
|---|---|---|---|
| sent/viewed past due | `overdue` — "Overdue · needs a poke" (`lang/en.json:1251`) | "Send nudge" (`:1144`) → `doSendText` → `POST /invoices/:id/text` (re-texts the whole invoice) | Open; Mute/Muted (`:2299-2314` → `PUT {remindersMuted}`) |
| `claimed` | `claimed` — "Awaiting confirmation" (`:1248`) | "Okay, I got it" (`:1141`) → `doConfirmReceived` → `POST /confirm-payment` → **paid** | Open; "Didn't get it" (`:2288-2298` → `/reject-claim`); "Text client" (`:2316-2318`) |
| sent/viewed not due | `out` — "Out for payment" (`:1250`) | "View invoice" (`:1143`) → opens `/i/:id` | Open; Mute only |
| `scheduled` | `scheduled` — "Upcoming" (`:1253`) | "Send now" (`:1146`) → `doSendNow` → dispatch | Open; Text client |
| draft / pending w/o issuedDate | `drafting` (`:1249`) | "Finish + send" (`:1142`) → `PUT status:sent` + dispatch | Open; Text client |
| `paid` | `paid` — "Paid this month" (`:1252`) | "View receipt" (`:1145`) | adjust panel hidden (`:1985`) |
| `void` | **not mapped** — falls into out/overdue | — | — |

- When an invoice is paid it must also be emailed to the Unicorn with "Paid" on it so everyone is on the same page. [p28]
  - **NW-29 ◩ a *receipt* PDF is emailed on one of three paid paths; the invoice stamped "Paid" is never sent.** Effort M.
  - Evidence: `confirm-payment/mod.ts:78-81` flips paid; `:107-131` emails only if `customer.email`, subject
    `confirmPayment.email.subject` (`lang/en.json:768` "Receipt for invoice #{id}") with a **receipt** PDF (`render-receipt-pdf/mod.ts:22-33`,
    eyebrow "RECEIPT" `:2102`); `:149-190` SMS + comms log. `compute-invoice-balance/mod.ts:40-51` (from `POST/PUT/DELETE /payments`)
    and `invoice-controller:253-264` (`PUT` status) email **nothing**. `send-paperwork-email/mod.ts:31` `PaperworkKind = "quote"|"invoice"`
    — no paid variant; the invoice template's status row (`:1339-1348`, `shared/quote-flow/email-format.ts:76-83` "Paid"/"Pagado")
    exists but the money card still says AMOUNT DUE (`:1352-1360`) and nothing calls it on the paid transition.
  - Fix: a `paid` branch in `SendPaperworkEmail` (or `RenderInvoicePdf({paid:true})`) called from a shared `MarkInvoicePaid`
    coordinator that both `ConfirmPayment` and `ComputeInvoiceBalance` use. Tests: `jest/integration/ux-payment-receipt.int.test.ts:69-140` (receipt only).

- There is no real way to tell invoices apart other than customer name and price. There is a lot of wasted space that could show the job description. [p28]
  - **NW-30 🐛 CONFIRMED — the data exists; the row never projects it.** Effort S.
  - Evidence: card row `InvoicesPage.tsx:1923-1928` = initials, `{client} · {invoiceRef}`, `fmtMoney(amount)`, stage subline
    (`:1587-1619`); `EnrichedInvoice` `:135-145` has no job field. DTO carries `jobName` + `description`
    (`backend/src/paperwork/dto/invoice.ts`), persisted (`invoice-store/mod.ts:20-27`), derived from the quote
    (`invoice-controller:215-217`), and already read by the *detail* headline via `strField(inv,"jobName")` (`:1110`, `:1135-1137`).
    `front-end/clients/dashboard.ts:99-138` omits both fields (index signature).
  - Fix: add them to the `Invoice` type, project in `enrich()` (`:163-212`), render as the card title. Tests: none for the list row.

- Double-check every invoice stage and what you can do in it: [p28]
  - **Awaiting confirmation** — has an "Ok I got it" button, but also needs a nudge button, because "Ok I got it" marks it as paid.
  - **Out for payment** — has no way to say payment received. Needs a "payment received" option, then you pick how it was paid from the payment options.
  - **Upcoming** — needs a "send it later" button with a date picker (if there is no start date, how do they know when to send the invoice?). Or a reminder text and email to the Dragon to approve that the job is done and send the final invoice.
  - **NW-31 ◩ confirmed: "Ok I got it" mints a Payment and sets paid (`confirm-payment/mod.ts:65-81`); nudge is mislabeled/miswired; payment-received and schedule-send are not built.** Effort L.
  - Nudge: backend has the whole cadence — `SendPaymentReminder`, `ScheduleInvoiceNudges`, `reminderHistory` day 3/7/14/30,
    `cron-controller/mod.ts:37-64` (`POST /cron/run-reminders`, `/cron/run-nudges`, `/cron/invoice-reminder` whose doc-comment `:53-54`
    says it "backs the 'Send nudge' button on the overdue card") — **zero front-end callers of `/cron/*`**; "Send nudge" actually
    re-texts the full invoice (`paperwork-email-controller/mod.ts:163`). On *Awaiting confirmation* the only nudge-ish control is
    "Text client" on the flipped card back.
  - Payment received w/ method: root cause #4 (NW-27). Backend `dto/payment.ts:7-18` has 9 methods; UI chips exist only customer-side.
  - Send later: `scheduledFor` is read-only in the FE (sort key `:389`, subline `:1606` "Scheduled to send {date}"); `NewInvoiceModal`
    has `dueDate` (`:2345-2349`) but no `scheduledFor`; backend accepts it (`send-signed-confirmation/mod.ts:180-181` sets it for
    milestones) and `/cron/run-nudges` would ping the Dragon — never called from the app.
  - Fix: (a) claimed → split into "Send a nudge" (`POST /cron/invoice-reminder`) + "Okay, I got it"; (b) out/overdue → "Payment
    received" → method → `POST /payments`; (c) `scheduledFor` date input on Upcoming + `NewInvoiceModal`, wire `/cron/run-nudges`.
  - Tests: `cypress/e2e/invoice-detail-panel.cy.ts`, `invoice-adjustments.cy.ts`, `jest/integration/invoice-integrity.int.test.ts`
    (discount/CO); `ux-payment-receipt.int.test.ts` (claim → confirm). Nothing pins nudge, payment-received or schedule-send.

## Payments

- If the Dragon marks an invoice as paid it should show up here. This is how payments are recorded. [p29]
  - **NW-32 ⬜ the plumbing works; the tab is empty only because no Dragon-side mark-paid action exists.** Effort M (shares NW-27).
  - Evidence: `PaymentsPage.tsx:271-277` lists `GET /payments` rows only (`payment-controller/mod.ts:32-42`); a Payment row is
    minted on confirm (`confirm-payment:65-71`) and `POST /payments` auto-flips the invoice via `ComputeInvoiceBalance` (`:41-51`).
    A raw `PUT status:"paid"` creates no row (the UI never does it — `InvoicesPage.tsx:1710` only sets `sent`). The empty-state
    copy already promises it (`lang/en.json:1690` "…once a customer pays an invoice it lands here automatically").
  - Fix: NW-27's "Payment received" → `POST /payments`; nothing else needed. Tests: none (`ux-money-pages-polish.cy.ts:108-126` hero only).

- "Record a payment" takes you to the quote/invoice chat. What is that button for? [p29]
  - **NW-33 ◩ answered: it is a dead-end placeholder — it pre-fills the chat composer and stops.** Effort M.
  - Evidence: `PaymentsPage.tsx:557-576` `href="/assistant?seed=<paymentsPage.hero.recordSeed>"` (`lang/en.json:1640-1641` "Record a
    payment" / "Record a payment I just received."); `AsstChat.tsx:1295-1304` reads `?seed=` into `setDraft()` and never sends; the
    assistant has no payment intent (`handle-chat-message/mod.ts` mentions payment only for onboarding handles `:192,534-566`;
    `shared/quote-flow/intent-parsers.ts` exports only skip/confirm). Sibling "Export this month" (`:567-575`) is the same pattern
    although `GET /invoices/export.csv` exists (`invoice-controller:313`).
  - Fix: in-page Record-payment modal (invoice picker + amount + method chips + date) → `POST /payments`; point Export at the CSV endpoint.

## Customers

- Format phone numbers as (555) 123-4567 as they are typed. That is sexy. [p30]
  - **NW-34 🐛 the as-typed mask exists — on the login/landing inputs only — and is never applied to any customer input.** Effort S.
  - Evidence: no mask on `ClientsPage.tsx:196-205` (submitted verbatim `:76`), `AsstChat.tsx:7809-7816` (`createPhone`),
    `InvoicesPage.tsx:2342` (`newPhone`). `shared/quote-flow/format-helpers.ts:66-70` `formatPhoneDisplay` is display-only and
    yields "+1 (512) 555-6999". The real as-typed mask is duplicated inline in `LoginForm.tsx:12-18` (`value` `:75`),
    `TrialSignup.tsx:11`, `LandingScripts.tsx:586-596,625` → "(512) 555-1234". Settings uses `fmtPhone` display-only (`SettingsPage.tsx:16,1559`); WelcomeWizard has no phone input.
  - Fix: export `formatPhoneInput` from `format-helpers.ts`, apply as `value={formatPhoneInput(x)}` on the three customer inputs,
    de-duplicate the auth screens. Tests: `jest/unit/format-helpers.test.ts:78-87` (P-64 display), `clients-page-quality.cy.ts:81` (tel href). None for as-typed.

- You can create customers from the Customers page but not from My Assistant, yet the new-customer input shows up in the My Assistant dropdown. [p30]
  - **NW-35 ◩ both paths persist to the same `CustomerStore`; the "input in the dropdown" is a search box, not a create.** Effort S–M (same fix as NW-22).
  - Evidence: Customers page `ClientsPage.tsx:73-78` → `POST /customers` (`customer-controller/mod.ts:20-24`); assistant
    `+ New customer` (`AsstChat.tsx:8012-8019`) → `handle-wizard-answer/mod.ts:274-291` `customers.create(...)`; invoice flow
    `:3360-3370` → `POST /customers`. Dropdown input `:7955-7974` only filters; the contact gate `:7775-7776` silently disables Next.
  - Fix: `Create "<search>"` row in the no-match state; visible error instead of a disabled button. Tests: none pin `create_new` → `/customers`.

- Customers tab: remove the "Who's on your books" chart (Property mgmt / Homeowners / Small biz / HOAs / Unsorted). We do not collect this data. [p32]
  - **NW-36 🐛 confirmed: the field it charts is declared but has zero write sites.** Effort S.
  - Evidence: `ClientsSections.tsx:251-289` `ClientsSegments` (title `clientsSegments.title`, `lang/en.json:702-708` / `es.json`
    "Quién está en tu lista"), mounted `ClientsPage.tsx:159`, fed by `GET /analytics/clients/segments` (`clients-controller/mod.ts:78-103`,
    which emits the four real segments even at count 0 and puts everyone in `unsorted`). `segment` is declared
    (`crm/dto/customer.ts:4-5,27-29`) but no create/update call sends it (`ClientsPage:73-78`, `handle-wizard-answer:274-286`,
    `AsstChat:3362-3367`, `clients.ts:82-89` signature lacks it); the `?segment=` URL param on `/clients` filters by *status*
    (`ClientsBoard.tsx:52-56`). Only the demo seed populates it (`lib/clients-seed.ts:405-408`).
  - Fix: delete the mount, the component (`:238-289`), the `segments()` fetch (`ClientsPage:101-106`, `clients.ts:60-80`) and the
    `clientsSegments.*` / `clientsSeed.segment.*` keys (`lang/*.json:693-708`); optionally the endpoint. Tests: none.

---

## After the "COMPLETED TASKS" divider (pp. 33–84)

Page 33 is a divider reading "COMPLETED TASKS". Only some pages after it are actually labeled COMPLETED. The unlabeled ones are listed first, as written.

### Not labeled completed

- **Pricing** [p34]
  - No Free tier.
  - Get rid of the % for now.
  - Starter package at $15 per month: "We can legitimize your business for less than a Netflix no-ad subscription", quotes etc.
  - $99 and $199 tiers.
  - **NW-37 ❓ SUPERSEDED — half done, half deliberately not.** `shared/quote-flow/pricing-plans.ts:2-10` records that Hans's
    "PM – Meeting Recap & Action Items August 27-28, 2026" (sent 2026-08-31) replaced this page: Monster Free $0 / Monster $99 /
    Monster Assist $199 / Monster Projects custom, Assist Plus hidden (`:73-216`); rendered `routes/index.tsx:33-41,870-1010` and
    `routes/landing.tsx:236-331`; copy `lang/en.json:1366-1396`, `:1737-1751`. No "%" in any pricing key; no "$15", "Starter" or
    "Netflix" anywhere. Commits `6492671`, `a0ec81d`. Pinned by `jest/unit/pricing-plans.test.ts:24-38`, `cypress/e2e/landing-pricing.cy.ts:28-75`.
    Decision needed; if it flips back: `pricing-plans.ts` + both dicts + both tests. Effort S/M.

- "We need to build out the Just give me a quick quote" with "REMOVE THIS." written over it. [p35]
  - **NW-38 ⬜ removal not done — chip live** (`AsstChat.tsx:4886-4892`, `startQuickQuoteFlow` `:3236-3251`, `starter-chips.ts:14,20,32-34,44-45`,
    `asstChat.prompt.quickQuote` `lang/*.json:357`). Keep `shared/quote-flow/quick-quote-prefill.ts` — also used by the other
    starters via `AsstChat.tsx:2439`. See NW-03. Effort S.

- Sidebar collapse: the arrow between HANS LLC and Settings that minimizes the sidebar should work like QuickBooks, showing the hamburger plus an arrow to minimize. Use the same pattern for the PM Assistant conversations panel and remove the existing button. [p36]
  - **NW-39 ◩ conversations panel matches exactly; the sidebar collapses QuickBooks-style but has no in-rail control.** Effort S.
  - Evidence: `DashSidebar.tsx:127-130` persisted state, `:171-180` `toggle()`, `:281-291` true icon rail; the **only** trigger is
    the topbar hamburger (`DashTopbar.tsx:139-148` → `pm:sb-toggle`, `DashSidebar:137-151`). No `[data-cy=sidebar-collapse|expand]`
    in any island (only in `cypress/e2e/dashboard-assistant-access.cy.ts` and `TDD-QUOTE-FLOW.md:58` — currently unsatisfiable).
    `AsstThreads.tsx:144-176` has the hamburger ⇄ hamburger+arrow button (`asst-threads-expand/collapse`). Duplicate Settings link
    already removed (`DashSidebar:358-361`).
  - Fix: a button above the `sb__footer` business-name link (`DashSidebar:319`) reusing `AsstThreads:160-176` icons and `toggle()`.

- Add a business name on the Wizard. [p37]
  - **NW-40 ✅ DONE (both readings):** welcome wizard `WelcomeWizard.tsx:241-280` `BusinessNameStep` (step `:1009-1012`); assistant
    customer step `shared/quote-flow/wizard-steps.ts:12-17` + `AsstChat.tsx:7795-7805` (`businessNamePlaceholder`), persisted `:7847`;
    conversational onboarding `handle-chat-message/mod.ts:240-243,311-348`. Tests: `wizard-steps.test.ts`, `quotes-wizard-navigation.cy.ts`, `onboarding-wizard.cy.ts`.

- Job details bullets: very cool addition, but it needs a "Professionalize that" button (or similar) when you add a bullet. Right now it takes exactly what I typed. It should break it down, make it professional, and let the person accept or edit it. [p38]
  - **NW-41 ✅ DONE:** adding/editing a bullet pops "Want me to professionalize that?" (`AsstChat.tsx:2037-2050`, `:2026-2035`, popup
    `:4287-4320`, `lang/en.json:350`) → `professionalizeBullet` (`:2053-2073`); the "Write it myself" editor has the literal
    `data-cy="professionalize-btn"` (`:4505-4535`) with a propose → accept/edit review (`:4454-4481`,
    `shared/quote-flow/professionalize.ts`); copy `lang/en.json:436-439` "Professionalize that" / es "Hazlo profesional". Minor
    divergence: the *bullet* path applies the LLM text on "Yes" (`:2066`) without the accept/edit review. Tests:
    `professionalize.test.ts`, `professionalize.int.test.ts`, `quotes-professionalize.cy.ts`.

- **Invoice edits** [p39]
  - Build the invoice with all the same information as the quote, except the 1–14 items under Terms and no signature block. Maybe include a link to the signed quote if one exists.
  - Make it editable.
  - Add change orders. A change order must trigger an approval to the Unicorn.
  - **NW-42 ✅ DONE on the API + `/invoices` + `/i` surfaces** — derive-from-quote `invoice-controller/mod.ts:205-231`; no terms / no
    signature `shared/quote-flow/invoice-from-quote.ts:41-42`, `routes/i/[id].tsx:203-206,393,430-433,568`; `signedQuoteUrl` when
    accepted (`invoice-from-quote.ts:43-45`, `public-controller:725`, `routes/i/[id].tsx:88,570-577`); editable `PUT /invoices/:id`
    (`:253-264`) + `InvoicesPage.tsx:978`; change orders → NW-50. **But** the *assistant's* invoice flow never uses this path (NW-13…NW-18).
    Tests: `invoice-from-quote.test.ts`, `invoice-parity.int.test.ts`, `invoice-parity.cy.ts`, `invoice-detail-panel.cy.ts`.

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

- Quote badge: "Draft", then "Sent" once sent, then "Viewed", then "Approved" once they sign. Refer to "Quote & Agreement - Preview.docx" for the updates. [p41]
  - **NW-44 ✅ DONE, ships as "Accepted" (❓ wording).** `shared/quote-flow/quote-status.ts:8-14` forward-only flow; badge
    `QuotesPage.tsx:96-113,170-176` (`data-cy="quote-status-badge"`); `viewed` on non-owner public read `public-controller:415,420`;
    labels `lang/en.json:2006-2009,2447`. Rationale for "Accepted" at `quote-status.ts:5-7`. **But** the assistant creates quotes
    already `sent` (NW-10), so "Draft" is never observed from that path. Rename = 2 keys + `BADGE_LABELS`.

- "Copy link" from the quote detail is not the full quote, just a simple version of it. [p42]
  - **NW-45 ✅ fixed** — `QuotesPage.tsx:153-162` always copies `/q/:id` ("never a summary variant"); `/s/:code` is a pure 302
    (`routes/s/[code].tsx:27-33`); `shared/quote-flow/share-link.ts`. Tests `share-link.test.ts`, `quotes-copy-link.cy.ts`.

- Refer to the doc "Quote & Agreement - Final.docx". [p43]
  - **NW-46 ⚠** the .docx is not in the repo (`TDD-QUOTE-FLOW.md:87-91` flags it). The concrete asks from it are NW-54…NW-57.

- The email: remove the quotation marks from the subject. I meant it should say that particular thing, not literally keep the quotes. (Screenshot also shows the contractor name rendered as "I" / "I know the job" / "I from help me price it." — the flow label is being used as the sender name.) [p44]
  - **NW-47 subject ✅ done; sender name 🐛 CONFIRMED, mechanism located and reproduces the screenshot exactly.** Effort S.
  - Subject: `lang/en.json:1575` `paperworkEmail.quote.subject` "{businessName} Quote for {customerName}, {jobName}" — no quotes;
    built `send-paperwork-email/mod.ts:505-515` via `shared/quote-flow/email-format.ts:140-144`. (`email-subject.ts` is test-only.)
  - Sender name: email uses `user.name` (`send-paperwork-email:500-505`), SMS uses its first token (`send-paperwork-sms:250-253` →
    `outbound-identity.ts:185-191`) in "Hi {hi}, this is {who} from {biz}." (`lang/en.json:1593`). Both are written by the first-turn
    onboarding branch `handle-chat-message/mod.ts:232` `const userVolunteered = isFirstTurn && extractNameAndBusiness(text);` →
    `:236-243` `users.update({name})` + `identity.upsert({businessName})` — **without the `looksLikeJobRequest` guard** its sibling
    has at `:267`. Trace of "I know the job, help me price it" through `onboarding/mod.ts:131-187`: ≤80 chars ✓, `QUOTE_SIGNAL_RE`
    (`:41-42`) has no "price" ✓, 8 words ✓, `PREFIX_RE` (`:38-39`) doesn't match "I know" ✓, `SEPARATOR_RE` splits on ", " →
    name = "I know the job" (4 tokens ≤4 ✓), business = "help me price it" (16 chars ✓) → sender "I", business "help me price it".
    Verified by reading the source in this triage.
  - Fix: `isFirstTurn && !looksLikeJobRequest(text) && extractNameAndBusiness(text)` at `:232`; reject name parts starting with a
    pronoun/verb in `onboarding/mod.ts:163-165`; block the four `asstChat.prompt.*` strings outright.
  - Tests: `email-subject.test.ts` (subject); `ux-outbound-gate.test.ts` + `outbound-*-content.cy.ts` (P-06 placeholder leak). None pin this case.

- Text-message template to the customer: [p45]
  > Hi [Customer Name], this is [Contractor Name] from [Business Name].
  > Your Quote + Agreement for [Job Name] is ready:
  > [LINK]
  > Please let me know if you have any questions. I look forward to working with you!
  - **NW-48 ✅ DONE verbatim (EN); ES equivalent.** `lang/en.json:1588-1595` (`paperworkSms.intro.hiWhoBiz`, `body.ready`,
    `body.closing`), composed `send-paperwork-sms/mod.ts:303-337` with graceful fallbacks (`:280-282`); ES `lang/es.json:1588-1595`.
    Only divergence: `{url}` inline after "is ready:" rather than on its own line. Tests `sms-template.test.ts`, `sms-i18n.test.ts`, `outbound-sms-content.cy.ts`.

- Build out "I know the job, help me price it": [p46]
  - First screen is Job Details, then ask any questions needed.
  - Next screen confirms the details.
  - Then three pricing options plus a fourth custom one so they can choose.
  - Then the rest of the steps.
  - **NW-49 ✅ all stages exist** — entry `AsstChat.tsx:3256-3266`, follow-up fields `:72,:882-890`, confirm-details
    `:4216-4245` (`data-cy="confirm-details"`), three tiers `:4787-4800` + `pricing-option-custom` `:4824`, rest of steps. **Quality**
    of what those stages produce is NW-08/09/11/12. Tests `quotes-help-me-price.cy.ts`, `ux-help-me-price.cy.ts`.

- Invoices: this is not working. We just need to adjust invoices through a discount or a change order. A change order triggers a new link so the Unicorn can approve. [p47]
  - **NW-50 ✅ DONE** — `shared/quote-flow/invoice-adjustments.ts` (immutable discount / change order); endpoints
    `invoice-controller/mod.ts:60,106,139,174,196`; UI `InvoicesPage.tsx:957-1101` (`invoice-discount-btn`, `invoice-change-order-btn`);
    public approval `routes/co/[id].tsx` + `PublicChangeOrderActions.tsx:15-41`; contractor alert `send-change-order-alert` (`daad55e`).
    Tests `invoice-adjustments.test.ts`, `invoice-adjust.int.test.ts`, `invoice-adjustments.cy.ts`.

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

- Delete scope: do not delete data, flag it as "deleted". When someone signs up with the same phone number, offer to create a new account or recover the old one. [p58]
  - **NW-52 ⬜ NOT BUILT — every delete is a hard KV delete; repeat-phone signup silently logs into the old account.** Effort L.
  - Evidence: zero hits for `deletedAt|isDeleted|softDelete|archived`. Hard deletes: `core/data/repository/mod.ts:75-78`;
    quotes `quote-store/mod.ts:93-100`; customers `customer-store/mod.ts:88-95`; account `me-controller/mod.ts:51-59` →
    `user-store/mod.ts:168-175` (also deletes `user_by_phone`, releasing the number); nuclear `wipe-account/mod.ts:28-78`
    (`GET /me/wipe`). UI `DeleteQuoteButton.tsx:27-38` confirm → delete → reload. Signup: `verify-otp/mod.ts:178-192` is pure
    find-or-create; `user-store.create` (`:53`) guards one account per phone.
  - Fix: nullable `deletedAt` on User/Quote/Customer DTOs; stores `update({deletedAt})` + filter from lists; `verify-otp` returns
    `{recoverable:true}` for a flagged user so `/verify` can offer recover / start fresh. Tests: none.

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

- The new Quote/Contract is both. We do not need to send a separate contract. Keep the ability to draft contracts, but most people will send one legally binding quote with all the job details. [p81]
  - **NW-56 ✅ merge done / ⬜ "keep drafting contracts" — nothing to keep.** Effort S (vocabulary) / L (if standalone drafting must exist).
  - Evidence: no Contracts nav (`DashSidebar.tsx:25-27`); `/contracts` is a 302 stub to `/quotes` (`routes/contracts/index.tsx`);
    no contract store/DTO/controller in `backend/src` (only `contract-defaults` settings presets). The `ux-problems.md:30-36` UX-02
    "auto-created draft contract" hypothesis is disproven (`TESTS-UX-PROBLEMS.md:107-108`). Residual "contract" vocabulary is
    cosmetic: `ICN.contract`, `static/public-contract.css`, landing demo tab `LandingScripts.tsx:188-233`.

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

- **Stretch goals**: look at competitors, add their best features, and easy import. [p84]
  - **NW-58 ⬜** export only — `GET /invoices/export.csv` (`invoice-controller:312-371`, `InvoicesPage.tsx:769`); no import
    endpoint, parser or UI (zero hits for csv import / importar / vcf). Effort L.

### Labeled COMPLETED — verified against code

- Payment methods: Venmo, CashApp, Zelle, PayPal, Check, Cash. For handles, an input "here is my handle" with re-type to confirm. [p49]
  - **✅ VERIFIED** `SettingsPage.tsx:1000-1044` (six rows), `business-identity.ts:121`, `payment-terms-controller:69`; handle
    `settings.yourHandle` "Your handle" + `retypeConfirm` + `noMatch` (`SettingsPage:1248-1284`). Cash has no field; check address optional.
- Fix the logo upload button (error at the bottom of the screenshot: "POST /files failed: 500"). [p50]
  - **✅ VERIFIED** chunked KV store (`file-store/mod.ts:37,91`), structured 413 above 8 MiB (`files-controller:18,54-70`), localized errors (`SettingsPage:321-333`).
- Invoice: he just needs to send an invoice. Clients need a business name (done on the Clients screen; the wizard still lacked it). [p51]
  - **✅ VERIFIED** `ClientsPage.tsx:187` + `crm/dto/customer.ts:41,79`; wizard now has it (`AsstChat.tsx:7798`, `wizard-steps.ts:12-17`).
- New "Job done need to invoice" button. [p52]
  - **✅ VERIFIED** `AsstChat.tsx:4893-4899`, `asstChat.prompt.invoiceDone` (`lang/en.json:355`), `starter-chips.ts:15-20`. (What it leads to is NW-13…18.)
- "Job Completed" button. [p53–54]
  - **✅ VERIFIED** `terms-wizard-spec/mod.ts:44-48` (start_date) and `:61-64` (wraps); `lang/en.json:928,941,890`. (p22/p23 now ask to remove it from start_date and lowercase it — NW-23/24.)
- "Due Now" button. [p55]
  - **✅ VERIFIED** `terms-wizard-spec:73-79`, `lang/en.json:916-917`, `doc-parts.tsx:361-364`.
- Make the Toilet Replacement job editable. [p56]
  - **◩ PARTIAL** — editable on the job-details picker (`AsstChat.tsx:3996,4091-4140`) but read-only on the review card (`:5864-5876`). Same gap as NW-19.
- Remove all the Excel sub-headers and the "in plain English" sub-header. 02 Payment Schedule and 03 Terms stay the same, updated to match the Dragon's quote-preview comments. Fine print includes only items 1–14. [p57]
  - **◩ PARTIAL** — 14 items ✓; but "01 The deal in plain English" still renders (`quote-doc.tsx:411`, `quoteDoc.plainEnglish`
    `lang/en.json:864`), so Payment Schedule is 03 and Terms 04; the Description/Qty/Amount table header is still forced
    (`quote-doc.tsx:420-433` → `doc-parts.tsx:426-445`, `lang/en.json:880-882`). Ties to NW-57's "Quick Summary".
- Job Details options: header "Pick the closest job description below and make any changes you want." Three clickable options generated from the description, each bullet with an "x" to delete (and restore), plus a final input bullet for the Dragon's own text. [p59]
  - **✅ VERIFIED** `asstChat.jobOpts.sub` (`lang/en.json:262`, render `:3893`); three options (`generate-job-options:36,156`); delete/restore `:4091-4095` (soft flag `:176-182`); add bullet `:4119,4140`; custom tile `:4186`. (Content quality is NW-05/11.)
- 04 Sign Here: "By signing below, you agree to everything above." "Contractor Signature" not "Contractor Signed". Footer: "Questions before signing? Call 540-333-1334 or email hp@hans.work! I look forward to working with you." [p61]
  - **✅ VERIFIED** (section number is 05 because of p57's leftover) — `lang/en.json:805-806`, `quote-doc.tsx:497-503`; `contractorSignature` `:841`/`:511`; footer templated from the contractor profile `quote-doc.tsx:712-740`. **Conflicts with NW-02.**
- Delete the "select review" step. Go straight to Review. [p64]
  - **✅ VERIFIED** `AsstChat.tsx:1578-1595` auto-opens the review on `continue_cta` (`handle-wizard-answer:187-191`).
- New Conversation copy: "Your PM Assistant is here to help! Click on a box or the text field below to get started!" with the three options and "Not sure? Just tell me about the job." [p65]
  - **◩ PARTIAL** copy matches (`lang/en.json:219,232,167`); **four** boxes render, not three (`AsstChat.tsx:4872-4899`) — the quick-quote chip, NW-38.
- New Job screen: Scope of Work, Price, Add more details (optional), Talk or type, Start Quote / Edit Job. [p66]
  - **⬜ NOT FOUND** — none of those strings exist in `lang/` or `front-end/`; the shipped equivalent is chip → `asstChat.details.promptRest` (`lang/en.json:208`) → price → picker. Only `tapToTalk`/`voiceMemo` (`:170-171`).
- "What's the price? I'll build the job details around it." Work on the zeros. [p67]
  - **✅ VERIFIED** `lang/en.json:349,343`; `MoneyInput.tsx:381-397` strips leading zeros, `:106` drops trailing `.00`, `:407` zero words.
- Kill Step 1 (past-jobs template: Home Job / Business Job / Start from scratch). [p68]
  - **✅ VERIFIED** zero matches; spec starts at `customer` (`terms-wizard-spec:22-35`); dead legacy map `AsstChat.tsx:88-100`.
- Step 2: Pick a Customer. Dropdown of existing customers plus "+ New Customer" (Name, Phone, Email optional). [p69–70]
  - **✅ VERIFIED** `shared/quote-flow/customer-step.ts:20-33`, `lang/en.json:192-200`, form `AsstChat.tsx:7778-7820`. (UX gaps: NW-22/35.)
- Step 3: When does the job start? Right away / Next week / Next Month / Pick a date (calendar). [p71]
  - **✅ VERIFIED** `terms-wizard-spec:36-51`, `lang/en.json:926-932` (+ the extra "Job Completed" that p22 now removes — NW-23).
- Step 4: How long will the job take? 1 day / 2–3 days / 1 week / 2 weeks / Custom (opens in chat). Custom buttons consistent with the other steps. [p72–73]
  - **✅ VERIFIED** `:52-67`, `lang/en.json:940-947` (+ "Job Completed").
- Step 5: When do you want to get paid? On completion / 50/50 / 30/30/40 / Deposit + balance / Custom (same as Payments). [p74–75]
  - **✅ VERIFIED** `:68-107`, `lang/en.json:912-925` ("Payment upon completion" = `net_15`; + "Due Now").
- Step 6: Warranty. No warranty / 6 months / 1 year / 2 years / Custom. [p76–77]
  - **◩ PARTIAL** five slots (`:108-123`) but labels read "12 months" / "24 months", not "1 year" / "2 years" (`lang/en.json:933-939`).
- Step 7: Cancellation notice. Eliminate the choice and just use 7 days. [p78]
  - **✅ VERIFIED** no `termination` step (`terms-wizard-spec:19-125`, comment `:9-14`); fixed clause `lang/en.json:833` (PDF `:2143`); dead fallback `AsstChat.tsx:137-141`.
- Kill the dispute-venue step. Keep "Small claims / local court" in the contract text only. [p79]
  - **✅ VERIFIED** no step; `quoteDoc.clause.disputeResolution.body` (`lang/en.json:815`, PDF `:2125`); dead fallback `AsstChat:142-155`.
- Remove the governing-law step. Fixed language: "This agreement is governed by the laws of the state where the work is performed, without regard to conflict of law rules." [p80]
  - **◩ PARTIAL** step gone (dead fallback `AsstChat:156-159`) but the body (`lang/en.json:819`) stops at "…where the work is performed." — the clause ", without regard to conflict of law rules." is missing (both dicts + PDF twin).
- Replace the long legal section with the required notices only: Governing Law, Scope of Work, Payment Terms, Change Orders, Customer Responsibilities, Delays and Unforeseen Conditions, Warranty, Limitation of Liability, Right to Stop Work, Termination, Dispute Resolution, Permits and Compliance, Indemnification, Entire Agreement. [p83]
  - **✅ VERIFIED (one title differs)** — `clauseKeys` `quote-doc.tsx:99-114`, `<ol>` `:478-486`, titles `lang/en.json:809-836`; item 2 is titled "Job Details" (`quoteDoc.clause.jobDetails.title`), not "Scope of Work".

---

## Suggested order of attack

1. **Verify the deploy env** for `AGENTS_LLM_CLIENT` / `OPENAI_API_KEY` (root cause #1). If absent, that alone explains NW-05, NW-11 and the price magnitudes in NW-12.
2. **Small, certain fixes** (one sitting): NW-01 toggle order · NW-10 drop `status:"sent"` · NW-19/20 three `pushHistory()` calls ·
   NW-23/24 start-date options + casing · NW-17 period · NW-30 job name on invoice rows · NW-34 phone mask · NW-36 delete the chart ·
   NW-47 first-turn name guard · NW-06 missing `from` prop · NW-54 "Terms and Conditions" key · governing-law clause tail · warranty "1 year/2 years".
3. **One prompt rewrite** closes NW-08 + NW-09 + NW-12 (`prompts.suggestPrices`, both dicts, + `suggest-prices/mod.ts`).
4. **One new surface** — contractor "Payment received → method → `POST /payments`" — closes NW-27, NW-31(b), NW-32, NW-33 and hooks NW-29.
5. **Invoice flow through the quote wizard** (NW-13…NW-18, root cause #7) — the largest single piece; the backend half is already green.
6. **Non-echoing fallbacks + spinner** (NW-05/NW-11) — will break the three specs that currently assume the echo.
7. **Decisions**, then their small follow-ups: NW-02 footer contact, NW-03/NW-38 quick-quote chip, NW-04/NW-07 which affordance, NW-37 pricing, NW-44 "Approved".

Per the repo's TDD rule every fix above starts as a `REQ-nnn` entry with a red test (unit + integration + e2e where they apply)
before implementation; the "Tests" lines per item name what already exists so the red suites extend rather than duplicate.
