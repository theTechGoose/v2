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

- [ ] **1 / 19. Every customer record carries the contractor's own email/phone — and the contract sends to the contractor**

  Customer picker (~1:56) shows all customers with email `hanspede35@gmail.com` and phone `+15403331334` (the contractor's). Send confirmation (~2:55): delivered to the contractor, not the customer.

  - **Root cause:** Backend send path is correct (no contractor fallback) — `customer-store/mod.ts` create, `handle-wizard-answer/mod.ts:167` create_new, `send-paperwork-email/mod.ts:73`, `send-paperwork-sms/mod.ts:73` all use the customer's own contact. The rows were *created* with Hans's contact and nothing guards it.
  - **Fix steps:**
    1. [ ] **Frontend guard** — `AsstChat.tsx` `CustomerStepPanel` (~5226-5283): read the contractor's own contact from `props.from` (email/phone passed via `[threadId].tsx:147`); normalize (lowercase email; strip non-digits from phone) and block submit (set `localErr`, extend `submitDisabled`) when the entered customer email or phone equals the contractor's.
    2. [ ] **Require contact** — in the same panel, require at least one of email/phone before `onSubmit("create_new", …)`.
    3. [ ] **Backend guard** — `handle-wizard-answer/mod.ts` (~167-182): inject `UserStore`, fetch the creating user, and reject/`console.warn` when `create.email` (lowercased) equals the creator's email.
    4. [ ] **Data cleanup** — audit existing rows where `customer.email == user.email` (by `userId`) and correct/flag them (manual; don't auto-rewrite).
  - [ ] **Validate fix:** Create a customer with a distinct email/phone, run the wizard; the contract-drafting **TO** block and send-confirmation show that customer's contact. Saving a customer with the contractor's own email is blocked/warned.

- [ ] **2. Dashboard KPIs contradict each other**

  "ACTIVE JOBS 15" KPI vs list header "5 active" (~0:08); "OUTSTANDING $0.09 — 0 invoices".

  - **Root cause:** `DashboardPage.tsx:254` hardcodes `activeJobs: 0` in `pickKpis()`, overridden at `:390` with `jobs.length` (two-source drift vs list header `DashSections.tsx:227`). Outstanding sums aging-bucket cents with no zero-clamp when `invoices.pending === 0`.
  - **Fix steps:**
    1. [ ] `DashboardPage.tsx` `pickKpis()` (~252): compute `const pending = stats?.invoices.pending ?? 0;` and `const activeJobs = stats?.jobs?.length ?? 0;`.
    2. [ ] In the same return: `activeJobs,` and `outstanding: pending === 0 ? 0 : owed,` (remove the hardcoded `activeJobs: 0`).
    3. [ ] `DashboardPage.tsx:390`: change `const kpis = { ...pickKpis(stats), activeJobs: jobs.length };` → `const kpis = pickKpis(stats);` (single source).
  - [ ] **Validate fix:** ACTIVE JOBS KPI equals the list-header count; OUTSTANDING reads `$0.00` when invoice count is 0. Re-check across accounts.

- [ ] **3 / 13. Relative timestamp badge in the chat header is wrong / fluctuates**

  Header pill shows random "Nd ago" for a brand-new conversation (~2:08-2:42).

  - **Root cause:** `AsstThreads.tsx:205` `fmtTime()` recomputes `Date.now()-t` every render; the header dispatch `AsstChat.tsx:909` (`pm:asst-header`) carries no timestamp, and the source `createdAt` units are suspect (ms vs s).
  - **Fix steps:**
    1. [ ] Confirm the conversation `createdAt`/`updatedAt` units end-to-end (ISO string vs ms epoch) and normalize via `tsOf()` so the diff is correct.
    2. [ ] `AsstThreads.tsx:205` `fmtTime`: return `"just now"` for `diff < 60_000` (not `"now"`); keep m/h/weekday/date tiers.
    3. [ ] `AsstChat.tsx:909`: include `timestamp: customer?.createdAt ?? messages[0]?.createdAt` in the `pm:asst-header` detail so the header has a real source.
    4. [ ] Stop per-render drift: render the badge from the normalized timestamp once; if a live tick is wanted, update via a single 30s interval, not on every render.
  - [ ] **Validate fix:** Fresh conversation reads "just now" and stays stable across wizard steps — never "Nd ago" or jumping.

---

## Layout / responsiveness (keyboard)

- [ ] **4. Huge empty void when the keyboard opens** *(already fixed — verify only)*

  - **Root cause:** Fixed in `9d660f4`/`8dd9e79`: `MobileViewport.tsx:17-32` mirrors `visualViewport.height` into `--app-vh`; `assistant-page.css` uses `var(--app-vh, 100dvh)` for the shell/composer heights (e.g. `:8468`, `:8472`).
  - **Fix steps:**
    1. [ ] No code change — confirm on a real device; only act if the void reproduces.
  - [ ] **Validate fix:** On a phone, focus the composer and the price input — the field docks just above the keyboard, no empty band.

- [ ] **5. Composer placeholder text is clipped / unreadable**

  - **Root cause:** `AsstComposer.tsx:44-47` — `<textarea rows={1}>` too short for the ~100-char placeholder.
  - **Fix steps:**
    1. [ ] `AsstComposer.tsx:47`: change `rows={1}` → `rows={3}` (or raise the textarea min-height); alternatively shorten the placeholder to one line.
  - [ ] **Validate fix:** Empty composer on mobile + desktop shows the full placeholder, no mid-word truncation.

---

## Visual / affordance

- [ ] **6. Mic button is bright red in its idle (not-recording) state**

  - **Root cause:** `AsstComposer.tsx:64-66` mic button has no recording-state styling; `recording` lives in `AsstChat.tsx:621` and isn't passed down.
  - **Fix steps:**
    1. [ ] `AsstChat.tsx` Props (~378) + the `<AsstComposer …>` render: thread `recording={recording}`.
    2. [ ] `AsstComposer.tsx:9` Props: add `recording?: boolean`.
    3. [ ] `AsstComposer.tsx:64-66`: `class={`composer__btn ${recording ? "composer__btn--recording" : ""}`}`.
    4. [ ] `assistant.css`: idle `.composer__btn` stays neutral; add `.composer__btn--recording { color: var(--brand-pink); }` (red only while recording).
  - [ ] **Validate fix:** Idle mic neutral; record → red; stop → neutral. *(Idle-neutral is the video-observed state; the recording-red half was not shown in the video.)*

- [ ] **7. Currency formatting is inconsistent**

  - **Root cause:** Chat preview `AsstChat.tsx:3409-3414` uses `toLocaleString({ minimumFractionDigits: 0 })`; public agreement `routes/c/[id].tsx:630` uses `fmtMoneyExact()` (`lib/format.ts:26`, 2 decimals).
  - **Fix steps:**
    1. [ ] `AsstChat.tsx:3409-3414`: replace the inline `toLocaleString` with `const totalStr = fmtMoneyExact(totalCentsForBreakdown);`.
    2. [ ] Ensure `fmtMoneyExact` is imported from `../../lib/format.ts`.
  - [ ] **Validate fix:** Amount is identical format across chat draft, contract summary, and recipient agreement.

---

## Minor / friction signals

- [ ] **8 / 17. Slow start / no obvious primary on the "get started" screen**

  - **Root cause:** `AsstChat.tsx:2595-2604` empty state renders chips + textarea + mic with no hierarchy / no auto-focus.
  - **Fix steps:**
    1. [ ] Auto-focus the composer textarea when the empty state shows (`queueMicrotask(() => taRef.current?.focus())` in an effect gated on the empty state).
    2. [ ] `assistant.css`: emphasize `.chat__empty-title` and de-emphasize the chips (`.chat__empty-chips { opacity: .7 }`) so the text field reads as primary.
  - [ ] **Validate fix:** Opening cold shows one obviously-primary action. *(Visual hierarchy is checkable; "faster time-to-first-input" is a behavioral signal, not a single-shot check.)*

- [ ] **9. Em-dash empty states read as missing data**

  - **Root cause:** `DashboardPage.tsx:50` `fmtDue()` returns bare `—`; `DashSections.tsx:115-118` sets `avgJobVal = "—"` when `avgJob === 0`.
  - **Fix steps:**
    1. [ ] `DashboardPage.tsx:51`: `if (!iso) return "No due date";`.
    2. [ ] `DashSections.tsx:115-118`: `avgJobVal = props.avgJob > 0 ? … : "No paid jobs yet";` and blank the sub-label in that case.
  - [ ] **Validate fix:** A job with no due date and the AVG. PAID JOB KPI with no paid jobs show explicit copy, not `—`.

---

## Second pass — Correctness / clarity

- [ ] **10. Three job-description options all titled "Toilet Replacement"**

  - **Root cause:** `generate-job-options/mod.ts:34-54` prompt asks for "different phrasings of the SAME job" but never requires a unique `jobName`; `normalizeOptions()` (~110) doesn't de-dupe.
  - **Fix steps:**
    1. [ ] `mod.ts` SYSTEM_PROMPT (~45): add "Each option MUST have a UNIQUE jobName — do not repeat the same jobName."
    2. [ ] `normalizeOptions()` (~136, before `return out`): detect duplicate `jobName`s and disambiguate (e.g. append a variant suffix) or regenerate.
  - [ ] **Validate fix:** Job Details step shows three distinctly-titled cards; no two share a heading.

- [ ] **11. Signature-pad helper text doesn't clear when drawing**

  - **Root cause:** `PublicSignContract.tsx` — placeholder gated on `!hasInk`, but `setHasInk(true)` fires only in `onPointerUp` (~140), so it stays through the first stroke.
  - **Fix steps:**
    1. [ ] `PublicSignContract.tsx` `onPointerDown` (~115-121): add `setHasInk(true);` after pointer capture.
  - [ ] **Validate fix:** Placeholder disappears on the first stroke, never overlapping ink.

- [ ] **12. Wizard step numbering is inconsistent**

  - **Root cause:** `AsstChat.tsx:4298` renders `Step {stepIdx+1}` only for wizard messages; the Job Details picker (`jobOptionsOpen`, ~2606) isn't a wizard message and gets no number.
  - **Fix steps:**
    1. [ ] Pick one model and apply consistently: either give the Job Details head a computed step label, **or** drop step numbers everywhere (`AsstChat.tsx:2606` head stays title-only and the wizard `:4298` number is removed) for a uniform look.
  - [ ] **Validate fix:** Every wizard step is numbered consistently — or none are.

- [ ] **13.** *(Same root cause/fix as #3 — fluctuating header timestamp; tracked there.)*
  - [ ] **Validate fix:** Covered by #3.

## Second pass — Visual / hierarchy

- [ ] **14. Nav drawer over-uses red; "My Assistant" looks destructive**

  - **Root cause:** `dashboard.css` — `.sb__textus` (~483) bright-pink bg + glow + `pm-assistant-shake`; `.nav-item--active` (~623) quiet white; `.nav-item__count` (~647-662) pink regardless of context.
  - **Fix steps:**
    1. [ ] `.sb__textus` (~483): drop the loud pink/glow/shake — neutral `rgba(255,255,255,.12)` bg, no `box-shadow`, remove the `animation` rule.
    2. [ ] `.nav-item--active` (~623): `background: var(--brand-green); color:#fff;` with a soft green shadow.
    3. [ ] `.nav-item__count` (~647-662): neutral `rgba(255,255,255,.25)` bg (and `.35` when active) instead of pink.
  - [ ] **Validate fix:** Active item reads as primary (green/neutral), "My Assistant" isn't the loudest element, badges aren't alert-red.

- [ ] **15. Duplicate "YOUR SIGNATURE" label + two signature-looking boxes**

  - **Root cause:** `routes/c/[id].tsx:799-814` renders a red-dashed "YOUR SIGNATURE" preview slot above `PublicSignContract` (~816), whose own pad is also red-dashed (`PublicSignContract.tsx:295/356`).
  - **Fix steps:**
    1. [ ] `routes/c/[id].tsx:799-814`: render the preview slot only when `signed === true` (drop the unsigned-state else branch to `null`), leaving the actual pad as the single target.
  - [ ] **Validate fix:** Unsigned public page shows exactly one signature target; label not duplicated.

## Second pass — Performance / polish

- [ ] **16. Dashboard re-shows full skeleton loaders on return**

  - **Root cause:** `DashboardPage.tsx:343` inits `loading:true` and the mount effect (~342-379) always re-fetches; `lib/dash-cache.ts` exists (sidebar uses it) but the page doesn't.
  - **Fix steps:**
    1. [ ] Import `readCached, refreshDash` from `../lib/dash-cache.ts`.
    2. [ ] `DashboardPage.tsx:343`: lazy-init state from `readCached()` (render cached stats/jobs, `loading:false`) when present, else `INITIAL`.
    3. [ ] Keep the fetch as a background refresh (and/or call `refreshDash()`); update state when it returns.
  - [ ] **Validate fix:** Navigate away and back — cached content shows immediately, no full-screen skeleton flash.

## Second pass — Trivial

- [ ] **18. Agreement ID letter-case inconsistency**

  - **Root cause:** Chat `AsstChat.tsx:3438` `contractId.slice(0,8)` (no transform) vs agreement `routes/c/[id].tsx:447/903` `.toUpperCase()`.
  - **Fix steps:**
    1. [ ] `AsstChat.tsx:3438`: `#{contractId.slice(0, 8).toUpperCase()}`.
  - [ ] **Validate fix:** ID case matches in chat draft and recipient footer.

---

## Third pass — Visual / hierarchy

- [ ] **20. Red overused on the customer-facing agreement**

  - **Root cause:** `routes/c/[id].tsx` business name (`:418` `color:PINK_DARK`), doc chip (`:445` pink bg + `PINK_DARK`), status pill (`:470-471`). Color constants exist (~122-126): `TEAL #144852`, `GREEN #519843`, `INK #1c2c30`.
  - **Fix steps:**
    1. [ ] `:418`: business name `color:${PINK_DARK}` → `${TEAL}` (or `INK`).
    2. [ ] `:445`: doc chip bg → `rgba(20,72,82,0.10)`, text → `${TEAL}`.
    3. [ ] `:470-471`: keep red only if a true alert; otherwise neutral/amber for the "awaiting" info pill (leave signed/declined states as-is).
  - [ ] **Validate fix:** Business name and info chips are non-red; red only for genuine alerts.

## Third pass — Trivial

- [ ] **21. Cents overlap the close button on the amount-entry card**

  - **Root cause:** `MoneyInput.tsx` — `.mi__amount` flex row has no right gap, so `.mi__dec` (cents, ~32px) crowds `.mi__clear` (✕) at larger amounts (CSS ~574-590).
  - **Fix steps:**
    1. [ ] CSS: add `margin-right: 12px` to `.mi__amount` (or `margin-right: 8px` to `.mi__dec`) so cents never reach the ✕.
  - [ ] **Validate fix:** Across amount lengths, cents never overlap the close button.

- [ ] **22. Loading buttons show text but no spinner**

  - **Root cause:** Text-only swaps — `AsstChat.tsx:2794/2976` (`sending ? "Setting up…"`), `PublicSignContract.tsx:438` (`submitting ? "Signing…"`).
  - **Fix steps:**
    1. [ ] Add a `.spinner` CSS class + `@keyframes spin` (shared/assistant CSS).
    2. [ ] `AsstChat.tsx:2794` & `:2976`: render `<span class="spinner" aria-hidden="true"/> Setting up…` in the loading branch.
    3. [ ] `PublicSignContract.tsx:438`: render the spinner before `Signing…`.
  - [ ] **Validate fix:** "Setting up…"/"Signing…" show a spinner.

---

## Fourth pass — completeness sweep

- [ ] **23. "Time to complete" picker highlights two options at once**

  - **Root cause:** `AsstChat.tsx:3869-3873` adds `wiz-opt--selected` when `opt.label === t.value`, but that class has no CSS definition and a stale `:hover`/`:focus` stays styled — two options look selected.
  - **Fix steps:**
    1. [ ] `assistant.css` (~3240): add a real `.wiz-opt--selected` rule (green bg/border) and a `:hover` that doesn't read as selected.
    2. [ ] `AsstChat.tsx` term-pick handler: ensure single-select state (clear the prior answer for the step before setting the new one); trim/normalize the `opt.label === t.value` compare.
  - [ ] **Validate fix:** Tapping options leaves exactly one selected style at any time.

---

## Fifth pass

- [ ] **24. Price-entry hint shows desktop keyboard shortcuts on a phone**

  - **Root cause:** `MoneyInput.tsx:264-268` hard-codes "↑ ↓ to nudge $10 · Shift = $100" with no touch detection.
  - **Fix steps:**
    1. [ ] Add `isTouchOnly` state + effect using `matchMedia("(hover: none) and (pointer: coarse)")` (listen for changes).
    2. [ ] `:264-268`: render `"Tap a preset or type an amount"` when `isTouchOnly`, else the keyboard-shortcut hint.
  - [ ] **Validate fix:** Touch device hides/replaces the ↑↓/Shift hint; desktop still shows it.

- [ ] **25. Customer-facing agreement shows a blank white screen while loading**

  - **Root cause:** `routes/c/[id].tsx:315-356` is synchronous SSR awaiting `ssrBackendGet(...)`; blank until the server responds, no skeleton.
  - **Fix steps:**
    1. [ ] `:349-351`: three-branch render — `err` → `ErrorCard`; `contract` → `ContractDoc`; else → `LoadingSkeleton`.
    2. [ ] Add a small `LoadingSkeleton` component (spinner/placeholder, ~:374). *(If SSR blocks before any HTML flushes, move the fetch into a hydrating island so the skeleton paints first.)*
  - [ ] **Validate fix:** Public link on throttled network shows a skeleton/spinner, not blank white.

- [ ] **26. "Send the 30 quotes pending" reads as a one-tap bulk action**

  - **Root cause:** `DashSections.tsx:30-34` — it's a plain `<a href="/quotes">` whose label "Send the N quotes pending" *implies* a one-tap bulk send though it only navigates.
  - **Fix steps:**
    1. [ ] `DashSections.tsx:32`: relabel to `Review the ${pluralize(pendingQuotes,"quote")} pending` (navigation intent). *(If a real bulk send is wanted instead, make it a button with a confirm/preview step.)*
  - [ ] **Validate fix:** Hero button clearly navigates (no implied auto-send), or shows a confirm/preview before any bulk send. *(Video showed the button but never its tap behavior.)*

---

## Sixth pass — outbound SMS thread (~3:00)

- [ ] **27. Inconsistent SMS link formats — long UUID vs short code**

  - **Root cause:** `send-paperwork-sms/mod.ts:187-205` `mintShortUrl()` returns `/s/{code}` on success but its catch fallback builds the long `/q|/c|/i/{id}` UUID URL; mint can fail on KV collision (`shortlink-store/mod.ts` `MAX_COLLISION_RETRIES = 4`).
  - **Fix steps:**
    1. [ ] `shortlink-store/mod.ts`: raise `MAX_COLLISION_RETRIES` (e.g. 10) and, on exhaustion, register a deterministic base62 code (hash of `userId:kind:id`) instead of throwing — so callers always get a `/s/` link.
    2. [ ] `send-paperwork-sms/mod.ts:195-197`: replace the long-UUID fallback with the short-code path; `console.warn` with resource context.
  - [ ] **Validate fix:** Both the quote link and signed-copy/invoice link use the short-code format; no raw UUID in any SMS.

- [ ] **28. Outbound texts trip iOS "unknown sender — may be spam"**

  - **Root cause:** `users/.../data/sms/mod.ts:40-50` sends from `TWILIO_FROM` as-is; that number isn't a registered 10DLC/branded sender, so carriers flag it. Infra/config, not app UI.
  - **Fix steps:**
    1. [ ] **External:** register `TWILIO_FROM` as a 10DLC/branded sender in Twilio (carrier vetting takes days).
    2. [ ] `sms/mod.ts` send (~40-50): if `TWILIO_FROM` isn't valid E.164 (`/^\+[1-9]\d{1,14}$/`), `console.error` a startup warning linking the 10DLC docs.
    3. [ ] Document the `TWILIO_FROM` 10DLC requirement in the service JSDoc/deploy docs.
  - [ ] **Validate fix:** Test text to a fresh device from the production sender shows no "unknown sender / Report Spam" banner. *(External validation — not in-app.)*

---

## Seventh pass

- [ ] **29. Missing space before the separator in the agreement subtitle (trivial)**

  - **Root cause:** `routes/c/[id].tsx:493` — `{customerName}` (`:489`) has no trailing space and the next fragment starts `· {t.effective}`, rendering "Bond·".
  - **Fix steps:**
    1. [ ] `:493`: prepend `{" "}` before the `·` (→ "James Bond · effective …").
  - [ ] **Validate fix:** Subtitle reads "James Bond · effective …" with a space.

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
