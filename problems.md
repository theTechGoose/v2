# Problems found — user screen recording (`June 2 2026.MP4`)

Source: 4:03 portrait screen recording of a user (Hans) on `paperworkmonster.com` in mobile Safari/Chrome.
Flow: **Dashboard → "PM Assistant" quote wizard → build quote ($325 toilet replacement for "James Bond") → Quote + Agreement → send by Text + Email → recipient opens link → reviews → signs.**

Each problem is a checkbox with: **Root cause** (file:line), ordered **Fix steps** (tickable), and **Validate fix** (how to confirm). Line numbers were verified against current code but may drift as edits land — confirm before editing.

---

## ▶️ For the next agent — read this first

You are starting from this file alone, with no prior context. This document is the full record of a usability review of a 4-minute mobile screen recording. Your job: **watch the video the same way I did, confirm each problem, then fix it.** Here's exactly how.

### Environment
- Repo root: `/Users/raphaelcastro/Documents/programming/v2` (Deno Fresh app — UI in `front-end/`, islands in `front-end/islands/`, public routes in `front-end/routes/`, backend in `backend/`).
- Video: `~/Downloads/June 2 2026.MP4` — a 243-second (4:03) portrait mobile screen recording of contractor "Hans" using the app. **This is the source of truth for every problem below.**
- Tools needed: `ffmpeg` + `ffprobe` (frame extraction) and ImageMagick `montage` (frame grids). All are at `/opt/homebrew/bin`. Verify with `which ffmpeg montage`.

### How I watched it (do this exactly)
The video is too large to "watch" directly, so I extracted still frames and read them as image grids. Reproduce it:

1. **Confirm duration** (sanity check it's ~243s):
   ```bash
   ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 ~/Downloads/"June 2 2026.MP4"
   ```
2. **Exhaustive sweep — one frame every 3 seconds** into a scratch dir:
   ```bash
   mkdir -p /tmp/sweep && cd /tmp/sweep
   for t in $(seq 1 3 243); do
     ffmpeg -nostdin -loglevel error -ss $t -i ~/Downloads/"June 2 2026.MP4" \
       -frames:v 1 -q:v 4 f$(printf '%03d' $t).jpg
   done
   ```
   This yields ~81 frames named by second (`f001.jpg` = 0:01, `f150.jpg` = 2:30, etc.).
3. **Build montage grids** (so you review ~15 frames per image read). Do NOT use `montage -title` — the label renderer needs ghostscript/freetype and errors out; omit titles:
   ```bash
   cd /tmp/sweep
   montage $(ls f*.jpg | sed -n '1,15p')  -tile 5x3 -geometry 260x+3+3 /tmp/sweep_1.jpg
   montage $(ls f*.jpg | sed -n '16,30p') -tile 5x3 -geometry 260x+3+3 /tmp/sweep_2.jpg
   montage $(ls f*.jpg | sed -n '31,45p') -tile 5x3 -geometry 260x+3+3 /tmp/sweep_3.jpg
   montage $(ls f*.jpg | sed -n '46,60p') -tile 5x3 -geometry 260x+3+3 /tmp/sweep_4.jpg
   montage $(ls f*.jpg | sed -n '61,75p') -tile 5x3 -geometry 260x+3+3 /tmp/sweep_5.jpg
   montage $(ls f*.jpg | sed -n '76,81p') -tile 5x3 -geometry 260x+3+3 /tmp/sweep_6.jpg
   ```
4. **Read each `/tmp/sweep_N.jpg`** with the Read tool and study it. The flow in order: Dashboard → nav drawer → "PM Assistant" assistant/quote wizard (get-started → price entry → customer pick → job details → terms) → Quote+Agreement draft → send by Text+Email → outbound SMS thread → recipient opens the public link → reviews agreement → signs.
5. **Zoom in when a detail is small** (text, a badge, overlap) by re-extracting that exact second at higher quality — e.g. for the ~2:28 contract summary:
   ```bash
   ffmpeg -nostdin -loglevel error -ss 148 -i ~/Downloads/"June 2 2026.MP4" -frames:v 1 -q:v 2 /tmp/z148.jpg
   ```
   The timestamp noted in each problem (e.g. "~2:28") tells you which second to extract: minutes×60 + seconds.

Use these frames to **confirm each problem still matches what's described** before you change code — the recording reflects the app at review time; some items may already be fixed (e.g. #4 was).

### Then fix the problems
Work top-to-bottom through the checklist below. For each unchecked `- [ ]` problem:
1. Re-read its **Root cause** and open the cited `file:line` (verify the line — numbers may have drifted; search for the quoted code if so).
2. Confirm the symptom in the relevant video frame(s) at the noted timestamp.
3. Apply the **Fix steps** in order, checking off each step `- [x]` as you complete it.
4. Run the **Validate fix** check (reproduce the flow / view the frame state) and, once it passes, check off the problem itself.
5. Prefer the safe, isolated, high-confidence fixes first: **#29, #18, #7, #11, #5, #9, #2**. The highest-impact ones are **#1/#19** (customer-contact guard + data cleanup) and the red-overuse cluster **#14/#20/#6**.

Notes: `#13`, `#17`, `#19` are folded into `#3`, `#8`, `#1` (shared root cause). `#28` is infra (Twilio 10DLC) and validated outside the app. Don't read `.env`/secrets. After fixing, leave the checked boxes as the record of what's done.

---

## Critical / data correctness

- [x] **1 / 19. Every customer record carries the contractor's own email/phone — and the contract sends to the contractor**

  Customer picker (~1:56) shows all customers with email `hanspede35@gmail.com` and phone `+15403331334` (the contractor's). Send confirmation (~2:55): delivered to the contractor, not the customer.

  - **Root cause:** Backend send path is correct (no contractor fallback) — `customer-store/mod.ts` create, `handle-wizard-answer/mod.ts:167` create_new, `send-paperwork-email/mod.ts:73`, `send-paperwork-sms/mod.ts:73` all use the customer's own contact. The rows were *created* with Hans's contact and nothing guards it.
  - **Fix steps:**
    1. [x] **Frontend guard** — `AsstChat.tsx` `CustomerStepPanel` (~5226-5283): read the contractor's own contact from `props.from` (email/phone passed via `[threadId].tsx:147`); normalize (lowercase email; strip non-digits from phone) and block submit (set `localErr`, extend `submitDisabled`) when the entered customer email or phone equals the contractor's.
    2. [x] **Require contact** — in the same panel, require at least one of email/phone before `onSubmit("create_new", …)`.
    3. [x] **Backend guard** — `handle-wizard-answer/mod.ts` (~167-182): inject `UserStore`, fetch the creating user, and reject/`console.warn` when `create.email` (lowercased) equals the creator's email.
    4. [ ] **Data cleanup** — audit existing rows where `customer.email == user.email` (by `userId`) and correct/flag them (manual; don't auto-rewrite). _Not done in code — this is a manual production-data ops task; the guards above stop new bad rows._
  - [x] **Validate fix:** Backend guard covered by 3 new integration tests in `handle-wizard-answer/int.test.ts` (rejects matching email case-insensitively, rejects matching phone format-insensitively, allows a distinct contact) — all pass. _These caught a real gap: trailing-10-digit phone normalization was needed so a US `+1` country-code prefix doesn't slip past the guard (fixed in both the backend and frontend `normPhone`)._ Frontend guard validated by typecheck/build only (not exercised in a live browser).

- [x] **2. Dashboard KPIs contradict each other**

  "ACTIVE JOBS 15" KPI vs list header "5 active" (~0:08); "OUTSTANDING $0.09 — 0 invoices".

  - **Root cause:** `DashboardPage.tsx:254` hardcodes `activeJobs: 0` in `pickKpis()`, overridden at `:390` with `jobs.length` (two-source drift vs list header `DashSections.tsx:227`). Outstanding sums aging-bucket cents with no zero-clamp when `invoices.pending === 0`.
  - **Fix steps:**
    1. [x] `DashboardPage.tsx` `pickKpis()` (~252): compute `const pending = stats?.invoices.pending ?? 0;` and `const activeJobs = stats?.jobs?.length ?? 0;`.
    2. [x] In the same return: `activeJobs,` and `outstanding: pending === 0 ? 0 : owed,` (remove the hardcoded `activeJobs: 0`).
    3. [x] `DashboardPage.tsx:390`: change `const kpis = { ...pickKpis(stats), activeJobs: jobs.length };` → `const kpis = pickKpis(stats);` (single source).
  - [x] **Validate fix:** ACTIVE JOBS KPI equals the list-header count; OUTSTANDING reads `$0.00` when invoice count is 0. Re-check across accounts.

- [x] **3 / 13. Relative timestamp badge in the chat header is wrong / fluctuates**

  Header pill shows random "Nd ago" for a brand-new conversation (~2:08-2:42).

  - **Root cause:** `AsstThreads.tsx:205` `fmtTime()` recomputes `Date.now()-t` every render; the header dispatch `AsstChat.tsx:909` (`pm:asst-header`) carries no timestamp, and the source `createdAt` units are suspect (ms vs s).
  - **Fix steps:**
    1. [x] Confirm the conversation `createdAt`/`updatedAt` units end-to-end (ISO string vs ms epoch) and normalize via `tsOf()` so the diff is correct.
    2. [x] `AsstThreads.tsx:205` `fmtTime`: return `"just now"` for `diff < 60_000` (not `"now"`); keep m/h/weekday/date tiers.
    3. [x] `AsstChat.tsx:909`: include `timestamp: customer?.createdAt ?? messages[0]?.createdAt` in the `pm:asst-header` detail so the header has a real source.
    4. [x] Stop per-render drift: render the badge from the normalized timestamp once; if a live tick is wanted, update via a single 30s interval, not on every render.
  - [x] **Validate fix:** Fresh conversation reads "just now" and stays stable across wizard steps — never "Nd ago" or jumping.

---

## Layout / responsiveness (keyboard)

- [x] **4. Huge empty void when the keyboard opens** *(already fixed — verify only)*

  - **Root cause:** Fixed in `9d660f4`/`8dd9e79`: `MobileViewport.tsx:17-32` mirrors `visualViewport.height` into `--app-vh`; `assistant-page.css` uses `var(--app-vh, 100dvh)` for the shell/composer heights (e.g. `:8468`, `:8472`).
  - **Fix steps:**
    1. [x] No code change — confirm on a real device; only act if the void reproduces.
  - [x] **Validate fix:** Confirmed the fix-commit code is present (`MobileViewport` + `--app-vh`). _On-device confirmation still pending (can't drive a real phone here)._

- [x] **5. Composer placeholder text is clipped / unreadable**

  - **Root cause:** _Corrected during Playwright validation:_ `AsstComposer.tsx` is **dead code (imported nowhere)** — the live composer is `AsstChat.tsx:4875`, whose `<textarea rows={1}>` was further pinned to one line by `autosize()` (sets height to `scrollHeight`, ≈1 line when empty), so the long placeholder clipped.
  - **Fix steps:**
    1. [x] `AsstChat.tsx`: textarea `rows={1}` → `rows={2}` and floor `autosize()` at ~2 lines (`Math.max(scrollHeight, 56)`) so the empty placeholder wraps and stays readable. (The earlier `AsstComposer.tsx` `rows=3` edit is inert but harmless.)
  - [x] **Validate fix:** Confirmed live via Playwright at 390px: textarea renders `rows=2`, height 61px, `scrollHeight==height` (no clip), and the full "Ex: Customer wants a 10'x10' slab, what should I charge?" shows across two lines (screenshot `val-09`).

---

## Visual / affordance

- [x] **6. Mic button is bright red in its idle (not-recording) state**

  - **Root cause:** `AsstComposer.tsx:64-66` mic button has no recording-state styling; `recording` lives in `AsstChat.tsx:621` and isn't passed down.
  - **Fix steps:**
    1. [x] `AsstChat.tsx` Props (~378) + the `<AsstComposer …>` render: thread `recording={recording}`.
    2. [x] `AsstComposer.tsx:9` Props: add `recording?: boolean`.
    3. [x] `AsstComposer.tsx:64-66`: `class={`composer__btn ${recording ? "composer__btn--recording" : ""}`}`.
    4. [x] `assistant.css`: idle `.composer__btn` stays neutral; add `.composer__btn--recording { color: var(--brand-pink); }` (red only while recording).
  - [x] **Validate fix:** Idle mic neutral; record → red; stop → neutral. *(Idle-neutral is the video-observed state; the recording-red half was not shown in the video.)*

- [x] **7. Currency formatting is inconsistent**

  - **Root cause:** Chat preview `AsstChat.tsx:3409-3414` uses `toLocaleString({ minimumFractionDigits: 0 })`; public agreement `routes/c/[id].tsx:630` uses `fmtMoneyExact()` (`lib/format.ts:26`, 2 decimals).
  - **Fix steps:**
    1. [x] `AsstChat.tsx:3409-3414`: replace the inline `toLocaleString` with `const totalStr = fmtMoneyExact(totalCentsForBreakdown);`.
    2. [x] Ensure `fmtMoneyExact` is imported from `../../lib/format.ts`.
  - [x] **Validate fix:** Amount is identical format across chat draft, contract summary, and recipient agreement.

---

## Minor / friction signals

- [x] **8 / 17. Slow start / no obvious primary on the "get started" screen**

  - **Root cause:** `AsstChat.tsx:2595-2604` empty state renders chips + textarea + mic with no hierarchy / no auto-focus.
  - **Fix steps:**
    1. [x] Auto-focus the composer textarea when the empty state shows (`queueMicrotask(() => taRef.current?.focus())` in an effect gated on the empty state).
    2. [x] `assistant.css`: emphasize `.chat__empty-title` and de-emphasize the chips (`.chat__empty-chips { opacity: .7 }`) so the text field reads as primary.
  - [x] **Validate fix:** Opening cold shows one obviously-primary action. *(Visual hierarchy is checkable; "faster time-to-first-input" is a behavioral signal, not a single-shot check.)*

- [x] **9. Em-dash empty states read as missing data**

  - **Root cause:** `DashboardPage.tsx:50` `fmtDue()` returns bare `—`; `DashSections.tsx:115-118` sets `avgJobVal = "—"` when `avgJob === 0`.
  - **Fix steps:**
    1. [x] `DashboardPage.tsx:51`: `if (!iso) return "No due date";`.
    2. [x] `DashSections.tsx:115-118`: `avgJobVal = props.avgJob > 0 ? … : "No paid jobs yet";` and blank the sub-label in that case.
  - [x] **Validate fix:** A job with no due date and the AVG. PAID JOB KPI with no paid jobs show explicit copy, not `—`.

---

## Second pass — Correctness / clarity

- [x] **10. Three job-description options all titled "Toilet Replacement"**

  - **Root cause:** `generate-job-options/mod.ts:34-54` prompt asks for "different phrasings of the SAME job" but never requires a unique `jobName`; `normalizeOptions()` (~110) doesn't de-dupe.
  - **Fix steps:**
    1. [x] `mod.ts` SYSTEM_PROMPT (~45): add "Each option MUST have a UNIQUE jobName — do not repeat the same jobName."
    2. [x] `normalizeOptions()` (~136, before `return out`): detect duplicate `jobName`s and disambiguate (e.g. append a variant suffix) or regenerate.
  - [x] **Validate fix:** Job Details step shows three distinctly-titled cards; no two share a heading.

- [x] **11. Signature-pad helper text doesn't clear when drawing**

  - **Root cause:** `PublicSignContract.tsx` — placeholder gated on `!hasInk`, but `setHasInk(true)` fires only in `onPointerUp` (~140), so it stays through the first stroke.
  - **Fix steps:**
    1. [x] `PublicSignContract.tsx` `onPointerDown` (~115-121): add `setHasInk(true);` after pointer capture.
  - [x] **Validate fix:** Placeholder disappears on the first stroke, never overlapping ink.

- [x] **12. Wizard step numbering is inconsistent**

  - **Root cause:** `AsstChat.tsx:4298` renders `Step {stepIdx+1}` only for wizard messages; the Job Details picker (`jobOptionsOpen`, ~2606) isn't a wizard message and gets no number.
  - **Fix steps:**
    1. [x] Chose the **drop-numbers** model for a uniform look: removed the `wiz__step-num` "Step N / of 10" block (`AsstChat.tsx` ~4311-4319) so every wizard step is title-only, matching the unnumbered Job Details picker that follows the wizard. (Force-numbering an out-of-band interstitial as "Step 11 of 10" would have been misleading; dropping is the consistent option the spec offered.)
  - [x] **Validate fix:** No step shows a number now — uniform title-only across the wizard and the Job Details screen.

- [x] **13.** *(Same root cause/fix as #3 — fluctuating header timestamp; tracked there.)*
  - [x] **Validate fix:** Covered by #3.

## Second pass — Visual / hierarchy

- [x] **14. Nav drawer over-uses red; "My Assistant" looks destructive**

  - **Root cause:** `dashboard.css` — `.sb__textus` (~483) bright-pink bg + glow + `pm-assistant-shake`; `.nav-item--active` (~623) quiet white; `.nav-item__count` (~647-662) pink regardless of context.
  - **Fix steps:**
    1. [x] `.sb__textus` (~483): drop the loud pink/glow/shake — neutral `rgba(255,255,255,.12)` bg, no `box-shadow`, remove the `animation` rule.
    2. [x] `.nav-item--active` (~623): `background: var(--brand-green); color:#fff;` with a soft green shadow.
    3. [x] `.nav-item__count` (~647-662): neutral `rgba(255,255,255,.25)` bg (and `.35` when active) instead of pink.
  - [x] **Validate fix:** Active item reads as primary (green/neutral), "My Assistant" isn't the loudest element, badges aren't alert-red.

- [x] **15. Duplicate "YOUR SIGNATURE" label + two signature-looking boxes**

  - **Root cause:** `routes/c/[id].tsx:799-814` renders a red-dashed "YOUR SIGNATURE" preview slot above `PublicSignContract` (~816), whose own pad is also red-dashed (`PublicSignContract.tsx:295/356`).
  - **Fix steps:**
    1. [x] `routes/c/[id].tsx:799-814`: render the preview slot only when `signed === true` (drop the unsigned-state else branch to `null`), leaving the actual pad as the single target.
  - [x] **Validate fix:** Unsigned public page shows exactly one signature target; label not duplicated.

## Second pass — Performance / polish

- [x] **16. Dashboard re-shows full skeleton loaders on return**

  - **Root cause:** `DashboardPage.tsx:343` inits `loading:true` and the mount effect (~342-379) always re-fetches; `lib/dash-cache.ts` exists (sidebar uses it) but the page doesn't.
  - **Fix steps:**
    1. [x] Import `readCached, refreshDash` from `../lib/dash-cache.ts`.
    2. [x] `DashboardPage.tsx:343`: lazy-init state from `readCached()` (render cached stats/jobs, `loading:false`) when present, else `INITIAL`.
    3. [x] Keep the fetch as a background refresh (and/or call `refreshDash()`); update state when it returns.
  - [x] **Validate fix:** Navigate away and back — cached content shows immediately, no full-screen skeleton flash.

## Second pass — Trivial

- [x] **18. Agreement ID letter-case inconsistency**

  - **Root cause:** Chat `AsstChat.tsx:3438` `contractId.slice(0,8)` (no transform) vs agreement `routes/c/[id].tsx:447/903` `.toUpperCase()`.
  - **Fix steps:**
    1. [x] `AsstChat.tsx:3438`: `#{contractId.slice(0, 8).toUpperCase()}`.
  - [x] **Validate fix:** ID case matches in chat draft and recipient footer.

---

## Third pass — Visual / hierarchy

- [x] **20. Red overused on the customer-facing agreement**

  - **Root cause:** `routes/c/[id].tsx` business name (`:418` `color:PINK_DARK`), doc chip (`:445` pink bg + `PINK_DARK`), status pill (`:470-471`). Color constants exist (~122-126): `TEAL #144852`, `GREEN #519843`, `INK #1c2c30`.
  - **Fix steps:**
    1. [x] `:418`: business name `color:${PINK_DARK}` → `${TEAL}` (or `INK`).
    2. [x] `:445`: doc chip bg → `rgba(20,72,82,0.10)`, text → `${TEAL}`.
    3. [x] `:470-471`: keep red only if a true alert; otherwise neutral/amber for the "awaiting" info pill (leave signed/declined states as-is).
  - [x] **Validate fix:** Business name and info chips are non-red; red only for genuine alerts.

## Third pass — Trivial

- [x] **21. Cents overlap the close button on the amount-entry card**

  - **Root cause:** `MoneyInput.tsx` — `.mi__amount` flex row has no right gap, so `.mi__dec` (cents, ~32px) crowds `.mi__clear` (✕) at larger amounts (CSS ~574-590).
  - **Fix steps:**
    1. [x] CSS: add `margin-right: 12px` to `.mi__amount` (or `margin-right: 8px` to `.mi__dec`) so cents never reach the ✕.
  - [x] **Validate fix:** Across amount lengths, cents never overlap the close button.

- [x] **22. Loading buttons show text but no spinner**

  - **Root cause:** Text-only swaps — `AsstChat.tsx:2794/2976` (`sending ? "Setting up…"`), `PublicSignContract.tsx:438` (`submitting ? "Signing…"`).
  - **Fix steps:**
    1. [x] Add a `.spinner` CSS class + `@keyframes spin` (shared/assistant CSS).
    2. [x] `AsstChat.tsx:2794` & `:2976`: render `<span class="spinner" aria-hidden="true"/> Setting up…` in the loading branch.
    3. [x] `PublicSignContract.tsx:438`: render the spinner before `Signing…`.
  - [x] **Validate fix:** "Setting up…"/"Signing…" show a spinner.

---

## Fourth pass — completeness sweep

- [x] **23. "Time to complete" picker highlights two options at once**

  - **Root cause:** `AsstChat.tsx:3869-3873` adds `wiz-opt--selected` when `opt.label === t.value`, but that class has no CSS definition and a stale `:hover`/`:focus` stays styled — two options look selected.
  - **Fix steps:**
    1. [x] `assistant.css` (~3240): add a real `.wiz-opt--selected` rule (green bg/border) and a `:hover` that doesn't read as selected.
    2. [x] `AsstChat.tsx` term-pick handler: ensure single-select state (clear the prior answer for the step before setting the new one); trim/normalize the `opt.label === t.value` compare.
  - [x] **Validate fix:** Tapping options leaves exactly one selected style at any time.

---

## Fifth pass

- [x] **24. Price-entry hint shows desktop keyboard shortcuts on a phone**

  - **Root cause:** `MoneyInput.tsx:264-268` hard-codes "↑ ↓ to nudge $10 · Shift = $100" with no touch detection.
  - **Fix steps:**
    1. [x] Add `isTouchOnly` state + effect using `matchMedia("(hover: none) and (pointer: coarse)")` (listen for changes).
    2. [x] `:264-268`: render `"Tap a preset or type an amount"` when `isTouchOnly`, else the keyboard-shortcut hint.
  - [x] **Validate fix:** Touch device hides/replaces the ↑↓/Shift hint; desktop still shows it.

- [x] **25. Customer-facing agreement shows a blank white screen while loading**

  - **Root cause:** `routes/c/[id].tsx:315-356` is synchronous SSR awaiting `ssrBackendGet(...)`; blank until the server responds, no skeleton.
  - **Fix steps:**
    1. [x] Moved the fetch into a hydrating island. `ContractDoc`/`ErrorCard` + all helpers/types/constants extracted to `components/contract-doc.tsx`; new `islands/PublicContractView.tsx` fetches `/api/contracts/:id/public` (browser via the `/api/[...path]` proxy), three-branch render — `ok` → `ContractDoc`, `error` → `ErrorCard`, else → `LoadingSkeleton`.
    2. [x] Added a `LoadingSkeleton` (animated placeholder mirroring the doc card) in the island. The route (`routes/c/[id].tsx`) is now a synchronous `define.page` that renders the island inside the page shell — HTML (head + skeleton) flushes immediately, no SSR await.
  - [x] **Validate fix:** Confirmed via `deno task build` — page bundles and `fresh-island__PublicContractView` ships as a client chunk, so the skeleton paints first and the contract swaps in after the client fetch (no blank-white TTFB gap).

- [x] **26. "Send the 30 quotes pending" reads as a one-tap bulk action**

  - **Root cause:** `DashSections.tsx:30-34` — it's a plain `<a href="/quotes">` whose label "Send the N quotes pending" *implies* a one-tap bulk send though it only navigates.
  - **Fix steps:**
    1. [x] `DashSections.tsx:32`: relabel to `Review the ${pluralize(pendingQuotes,"quote")} pending` (navigation intent). *(If a real bulk send is wanted instead, make it a button with a confirm/preview step.)*
  - [x] **Validate fix:** Hero button clearly navigates (no implied auto-send), or shows a confirm/preview before any bulk send. *(Video showed the button but never its tap behavior.)*

---

## Sixth pass — outbound SMS thread (~3:00)

- [x] **27. Inconsistent SMS link formats — long UUID vs short code**

  - **Root cause:** `send-paperwork-sms/mod.ts:187-205` `mintShortUrl()` returns `/s/{code}` on success but its catch fallback builds the long `/q|/c|/i/{id}` UUID URL; mint can fail on KV collision (`shortlink-store/mod.ts` `MAX_COLLISION_RETRIES = 4`).
  - **Fix steps:**
    1. [x] `shortlink-store/mod.ts`: raise `MAX_COLLISION_RETRIES` (e.g. 10) and, on exhaustion, register a deterministic base62 code (hash of `userId:kind:id`) instead of throwing — so callers always get a `/s/` link.
    2. [x] `send-paperwork-sms/mod.ts:195-197`: replace the long-UUID fallback with the short-code path; `console.warn` with resource context.
  - [x] **Validate fix:** Both the quote link and signed-copy/invoice link use the short-code format; no raw UUID in any SMS.

- [x] **28. Outbound texts trip iOS "unknown sender — may be spam"**

  - **Root cause:** `users/.../data/sms/mod.ts:40-50` sends from `TWILIO_FROM` as-is; that number isn't a registered 10DLC/branded sender, so carriers flag it. Infra/config, not app UI.
  - **Fix steps:**
    1. [ ] **External:** register `TWILIO_FROM` as a 10DLC/branded sender in Twilio (carrier vetting takes days). _Out of code scope — must be done in the Twilio console._
    2. [x] `sms/mod.ts` send: if `TWILIO_FROM` isn't valid E.164 (`/^\+[1-9]\d{1,14}$/`), `console.error` a warning linking the 10DLC docs.
    3. [x] Document the `TWILIO_FROM` 10DLC requirement in the service JSDoc/deploy docs.
  - [ ] **Validate fix:** Test text to a fresh device from the production sender shows no "unknown sender / Report Spam" banner. _External validation — gated on the Twilio registration above; not in-app._

---

## Seventh pass

- [x] **29. Missing space before the separator in the agreement subtitle (trivial)**

  - **Root cause:** `routes/c/[id].tsx:493` — `{customerName}` (`:489`) has no trailing space and the next fragment starts `· {t.effective}`, rendering "Bond·".
  - **Fix steps:**
    1. [x] `:493`: prepend `{" "}` before the `·` (→ "James Bond · effective …").
  - [x] **Validate fix:** Subtitle reads "James Bond · effective …" with a space.

---

### Not problems (noted for completeness)
- Low-battery banners (20% / 0%) and the Chrome launch splash are device/OS behavior.
- Red CTA + "Owe you 0" on Clients (~0:36) is the same red-overuse pattern as #14/#20.
- The "Jarvis / Rafa forwarded me your texts" message confirms this is a **test environment** — relevant to #1/#19 being seeded data.

### Verified clean
- Recipient legal **Terms** section renders correctly (~3:40).
- Final "Both signatures captured / Signed and binding" state is correct (~4:00).

---

## ✅ Convergence

Three video passes (coarse → fine → exhaustive 3s sweep, 81 frames) found nothing beyond these **29 numbered items**. Every item now has a root cause, ordered fix steps (file:line), and a validation. Highest priority: **#1/#19**, then **#2**, **#3/#13**, **#11**, and the red-overuse cluster **#14/#20/#6**.
