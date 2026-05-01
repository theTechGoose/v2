# Audit walkthrough — round 2 (post-fix verification)

Walked the running app at **1440×900** with a Playwright-driven browser,
took screenshots at each route + key interaction, and recorded what's
broken or weak. Screenshots live in `round2/` (under repo root, alongside
`.playwright-mcp/`).

The dev environment was already up: Vite on `:5173`, backend on `:3000`.
User was already authenticated (Diego / Riley Roofing Co.).

This pass focuses on:
1. **Round-1 regression checks** — every fix from `audit.md` (P0 #1, P1 #3-9) re-verified live.
2. **Sweep across each authed surface** — dashboard, assistant, clients, quotes, contracts, invoices, payments, settings.
3. **Public document spot-checks** — public quote with cents-migrated total.

Findings recorded below; clean pages get a one-line "OK".

---

## Coverage summary (80 scenarios)

| Status                         | Count | Scenarios |
| ------------------------------ | ----- | --------- |
| OK / round-1 fix verified      |    25 | 02, 06, 09, 12, 13, 16, 18, 22, 26, 29, 31–35, 47, 50, 52, 54, 57, 62–69 |
| OK with caveat / minor         |     4 | 13, 23, 47, 77 (overlap with above) |
| ISSUE / new finding (F-numbered) |   8 | 11 (F14), 14 (F16), 15 (F16), 17 (F17), 19 (F18), 20 (F19), 72 (F21), 74 (F23) |
| MISSING (feature not impl.)    |     6 | 04 (F11), 05 (F12), 49 (cf F12), 55 (F20), 73 (F22), 80 (F24) |
| BLOCKED (env / data / auth)    |    27 | 07, 25, 27, 28, 30, 36–39, 41–46, 51, 56, 58–60, 71, 73, 75, 76, 78 |
| PARTIAL                        |    10 | 01, 03, 08, 21, 23, 40, 48, 51, 56, 70, 77, 79, 53 |

(Counts are approximate — some scenarios slot into multiple buckets.)

Critical bugs auto-fixed during the walk:
- F1 — Dashboard quotes side panel rendered cents as dollars (×100 over).
- F2 — AsstChat in-thread quote-review card double-multiplied cents (×10000 over).

Pre-existing round-1 fixes re-verified live: P0 #1 cents migration on
public quote/contract/invoice; P0 #2 payments title-tail; P1 #3 PSideFlow
empty state; P1 #4/#5 sidebar identity contrast + chevron; P1 #6 hero
CTA seed deeplinks; P1 #7 outstanding stray divider; P1 #8 contracts
zero-state copy; P1 #9 payments hero left padding.

---

## Per-scenario walkthrough (S01 → S80)

Each entry: scenario id, what I did, what I saw, verdict, screenshot ref.
"OK" = matches the scenario's expectations. "ISSUE" = something off (also
filed as F-numbered finding below). "BLOCKED" = couldn't run because
current account state, mock-only feature, or test infra not available.

### S38 customer-late-payment-reminder — BLOCKED
Reminder dispatch isn't visible from a single browser session and no
overdue invoices exist for Diego. Defer.

### S37 customer-pays-final-invoice — BLOCKED (Stripe not wired)
Same as S36 — page shows "Online payment is coming soon."

### S80 quotes-csv-export — MISSING (FEATURE NOT IMPLEMENTED)
DOM scan: no Export / CSV button on /quotes. Header has "+ New quote"
only. Export feature not implemented. F24.

### S79 mobile-public-quote-pinch-zoom — PARTIAL
Public-quote `/q/<id>` doesn't lock viewport (no `user-scalable=no`
in head — verified via meta scan), so pinch-zoom is allowed by
default. Mobile layout reflows correctly at 390px (single-column).

### S78 assistant-offline-message-queue — BLOCKED
Cannot reliably simulate `navigator.onLine = false` in this
Playwright session without service worker. Defer to manual.

### S77 assistant-tablet-portrait-layout — PARTIAL
At 1024×1366: three-column shell still renders (sidebar / threads /
chat). Sidebar takes ~150px; threads list ~280px; chat area ~590px.
Functional but no drawer-collapse for threads. Chat composer extends
fine. Acceptable for now; the 390px (S19) breakpoint is the urgent
one. Screenshot: `round2/s77-tablet-portrait.png`.

### S76 customer-sms-only-payment — BLOCKED
SMS dispatch + Stripe pay flow not wired. Defer.

### S75 quote-revision-after-rejection — BLOCKED
Need a previously-declined quote thread to test the revision path.
Diego's threads have only un-decided quotes. Defer.

### S74 assistant-record-payment-manual — MISSING (intent not handled)
"I just got $500 cash from Patel for invoice #29b73eda." → assistant
replied with the generic "Hey! Tell me about the job — paint, tile,
plumbing, anything. I draft quotes in seconds." No record_payment
action card. The LLM doesn't have a payment-record tool; cents-CTA on
/payments seeds the same kind of message but the LLM just defaults to
the quote-drafting prompt. F19 extension. F23.
Screenshot: `round2/s74-record-payment.png`.

### S73 public-invoice-apple-pay-ios — BLOCKED (Stripe not wired)
Public invoice page reads "Online payment is coming soon. Reply to
the email…" — no PaymentRequest API integration. Apple Pay flow
not implemented. F22.

### S72 public-quote-print-to-pdf — ISSUE (no @media print)
Style probe of /q/<id>: 0 `@media print` rules. The accept/decline
action bar is NOT hidden in print. Customer printing the page would
get the full interactive UI baked in. F21.

### S71 settings-phone-update-propagates — BLOCKED
Settings cards are read-only views with "Edits live in the assistant"
hint. Cannot edit in /settings UI directly.

### S70 dashboard-activity-realtime-on-send — PARTIAL
Verified at sidebar-badge level (S50): Quotes count went 16 → 17 after
sending O'Brien quote. Activity feed body wasn't deeply inspected for
new entry (would require time tracking).

### S69 quotes-track-expand-state-after-rerender — OK
Clicked Drafting header → toggled state. localStorage now has
`quotes:track:01="1"`, `quotes:track:02="0"`. Reloaded /quotes →
Track 01 still expanded with O'Brien card; Track 02 still collapsed.
Track state IS persisted across reload (better than the scenario
described — "in-memory only" in the spec was wrong).
Screenshot: `round2/s69-after-reload.png`.

### S68 cents-migration-restores-public-quote — OK (round-1 fix verified)
/q/03a22a99-… → "$3,700.00" (S31). /i/29b73eda-… → "$1,200.00" (S36).
/c/36e2877d-… → "$3,000.00" (S35). All cents-correct post-migration.
Plus dashboard side panel + AsstChat in-thread total now also correct
after F1 + F2 fixes.

### S67 sidebar-identity-contrast — OK (round-1 fix verified)
DOM check: `.sb__footer` is `<a href="/settings">` with title
"Diego · Riley Roofing Co." Initials "DR" rendered on green disc.
Inline-styled name + biz spans use `#fff` / `rgba(255,255,255,0.6)`
(verified via DashSidebar source). Round-1 P1 #4 + #5 fixes
confirmed live across every authed page walked in this audit.

### S66 dashboard-outstanding-no-stray-divider — OK (round-1 fix verified)
DOM probe: `.money` panel exists; `div[style*="dashed"]` inside it
does NOT exist (items.length === 0 → conditional render skips the
dashed divider). Round-1 P1 #7 fix confirmed live.

### S65 contracts-zero-state-copy — OK (round-1 fix verified)
Hero subtitle reads "Nothing in flight yet — when contracts get
signed they'll show up here, with the next milestone watched." (NOT
the data-bearing variant). Round-1 P1 #8 fix confirmed live.
"Schedule a job" CTA renders as anchor. Schedule strip shows the
"TODAY" pill week-2 lane with empty body and friendly nudge below.
Screenshot: `round2/s65-contracts.png`.

### S64 invoices-empty-state-fresh-account — OK
Hero "No invoices yet — let's start the river." (no awkward title-tail
break), KPIs all $0/0 with friendly sub-labels, 4 tracks (overdue
expanded with "No overdue invoices. Nice work.", out for payment
expanded with "Nothing waiting. Send a quote to get paid.", drafting
+ paid collapsed). New invoice CTA renders as anchor (verified F seed
mechanism). F9 noted (default-open asymmetry).
Screenshot: `round2/s64-invoices.png`.

### S63 payments-record-cta-deeplink — OK (round-1 fix verified)
"Record a payment" CTA is `<a href="/assistant?seed=Record%20a%20payment%20I%20just%20received.">`.
Deeplink + seed param verified earlier (07b screenshot). Round-1 P1 #6
fix confirmed live.

### S62 payments-sparkline-empty-state — OK (round-1 fix verified)
PSideFlow card title "Cash-flow shape · Last 12 weeks · nothing yet"
+ body "Nothing's landed yet — once payments roll in, the shape lights
up." NO svg curve drawn (the empty-state branch in PSideFlow is hit).
Round-1 P1 #3 fix confirmed live.
Screenshot: `round2/s61-payments.png`.

### S61 payments-hero-with-history — BLOCKED
Diego has 0 payments. Cannot exercise the populated hero/sparkline/
top-payors path until payment data lands.

### S60 onboarding-then-first-quote-capstone — BLOCKED (auth state)
Onboarding flow only fires for new users; Diego is already onboarded.
First-quote portion verified separately in S06.

### S59 public-quote-shows-declined-pill-after-revisit — BLOCKED
Need a previously-declined quote URL. Have a sent (un-decided) quote.
Decline submission would mutate test data. Defer.

### S58 logout-clears-session-from-any-page — BLOCKED (auth state)
Logging out would block the rest of the audit; deferred. Logout
button is visible at the bottom of the sidebar across pages.

### S57 messages-redirect-toast-from-old-link — OK
Visiting /messages redirected to /assistant; toast "We've consolidated
messaging into the assistant." rendered top-center over content.
Screenshot: `round2/s57-messages-redirect.png`.

### S56 thread-resume-after-overnight-gap — PARTIAL
Thread switching verified S18; thread-resume after a long gap requires
elapsed time + cache eviction. Cannot exercise in-session.

### S55 composer-draft-persists-after-reload — MISSING (FEATURE NOT IMPLEMENTED)
Typed text into composer; localStorage keys after typing: no
`pm:composer:*` key. Reloaded /assistant; textarea is empty. Draft
persistence to localStorage is NOT implemented. F20.

### S54 assistant-second-quote-same-thread — OK
In an existing thread that already had a SENT O'Brien quote, sent
"Add a quote for the same client — gutter cleanout, $145." → new
DRAFT card "Gutter cleanout — O'Brien" with $145.00 line item.
Client name inherited from thread context. Earlier card kept its
SENT/Re-open state. Screenshot: `round2/s54-second-quote.png`.

### S53 public-quote-brand-falls-back — PARTIAL
Diego has businessName set, so /q/<id> renders "RILEY ROOFING CO."
correctly. Cannot test fallback to "Paperwork Monsters" without a
contractor that has no businessName.

### S52 settings-page-reflects-onboarded-name — OK
Hero "Riley Roofing Co." (business name). Account card: Name=Diego,
Phone=(512) 555-0100 (formatted), Language=English. Business identity:
Riley Roofing Co. Empty cards: Mailing address / Insurance / Contract
defaults / Tax W-9. Sidebar identity readable on this page too.
Screenshot: `round2/s52-settings.png`.

### S51 dashboard-skeleton-on-cold-load — PARTIAL
Loaded /dashboard with warm cache; no skeletons visible. Skeleton
component imports exist (`SkelBlock`, `ShimmerStyle` in
DashboardPage.tsx) but they were not surfaced in this load. Cold-load
verification would need cache clearing.

### S50 sidebar-count-badge-on-quote-send — OK (live verified)
After sending the O'Brien quote in S08+S10, the sidebar Quotes badge
incremented from 16 → 17. Dashboard KPI "Quotes pending 17 ($43.6k
in flight)". Badge stays in sync with /quotes count.
Screenshot: `round2/s39-home.png` (post-send dashboard).

### S49 contractor-bell-shows-customer-inquiry — MISSING
No bell / notification icon on /dashboard (same root as F12).
Contractor-side notification of inbound questions not surfaced.

### S48 customer-asks-question-roundtrip — PARTIAL
Customer-side question form verified in S34. Contractor-side inbox
or notification of inbound question not testable without an actual
submission (would mutate quote state).

### S47 customer-declines-quote-price-reason — OK
Click Decline → reason chips visible → click "Price" → chip toggled
selected (green outline). Notes textarea + name field present. Did
not submit. Screenshot: `round2/s47-price-reason.png`.

### S46 voice-permission-denied-fallback — BLOCKED (env)
Voice flow not exercisable in Playwright headless (S07 covered).

### S45 voice-cancel-mid-recording — BLOCKED (env)
Same as S07.

### S44 voice-realtime-streaming-transcript — BLOCKED (env)
Same as S07.

### S43 name-onboarding-volunteered-with-quote — BLOCKED (auth state)
Diego is already onboarded with name "Diego" and biz "Riley Roofing
Co.". Cannot exercise volunteered-name path without a fresh user.

### S42 assistant-name-onboarding-skipped — BLOCKED (auth state)
Same — onboarding flow only fires for new users.

### S41 assistant-name-onboarding-new-user — BLOCKED (auth state)
Same.

### S40 cross-page-quote-to-cash — PARTIAL
End-to-end funnel exercised in pieces across S06 (draft) → S08+S10
(lock+phase-transition) → public quote (cents) → public contract /
invoice (cents). Stripe-pay step blocked. Activity propagation live
(S50 / S70 verify).

### S39 otp-login-returning-user — BLOCKED (auth state)
Already authenticated; logging out to test OTP would block subsequent
scenarios. Visiting `/` while logged in redirects to /dashboard
(verified). Defer the full OTP flow to manual.

### S36 customer-pays-deposit-invoice — BLOCKED (Stripe not wired)
Public invoice page reads "Online payment is coming soon. Reply to
the email to confirm payment details." No Stripe / Apple Pay button.
Pay-deposit flow not exercisable. Cents render correctly ($1,200.00).
F5 + F7 (PAPERWORK MONSTERS eyebrow, no contractor identity) persist.
Screenshot: `round2/s36-deposit-invoice.png`.

### S35 customer-signs-contract — OK (cents) / F5 / F6
Public contract /c/36e2877d-… renders with CONTRACT VALUE $3,000.00,
status Sent, name field, "Sign this contract →" button. Cents
verified. F5 (PAPERWORK MONSTERS eyebrow not RILEY ROOFING CO.) and
F6 (empty PROJECT label, no scope) persist.
Screenshot: `round2/s35-contract.png`.

### S34 customer-asks-question-on-quote — OK
"Ask a question" → inline panel with question textarea, phone/email,
name fields, "Send question" button (teal). Did not submit.
Screenshot: `round2/s34-ask2.png`.

### S33 customer-rejects-quote-with-feedback — OK
Click "Decline" on the public quote → inline panel opens with:
- Title "Decline this quote" + close (×)
- Reason chips: Price / Timing / Going elsewhere / Other
- "Anything to share? (optional)" textarea with example placeholder
- "Your name (optional)" with placeholder "Jane Doe"
- "Send decline" button (rust red)
Did not actually submit (would mutate). UI affordances correct.
Screenshot: `round2/s33-decline.png`.

### S32 customer-accepts-quote — OK (UI mechanics)
Typed "Asha Patel" into the name field. Accept button transitioned
from disabled (olive) to active (bright green); helper text "Type your
name above" disappeared. Did not actually click Accept (would mutate
test data). Screenshot: `round2/s32-typed-name.png`.

### S31 customer-receives-quote-email — OK (public page render)
/q/03a22a99-… renders cleanly: "RILEY ROOFING CO." eyebrow, title +
short id, scope blurb, line-items table ($2,200.00 + $1,500.00),
ESTIMATED TOTAL $3,700.00, name field + Accept this quote /
Ask a question / Decline buttons, contact "(512) 555-0100", "powered
by Paperwork Monsters" footer. Cents migration verified.
Screenshot: `round2/s31-receives-email.png`.

### S30 quotes-empty-state-new-user — BLOCKED
Diego has 113 drafts + 1 sent + 2 decided. Cannot exercise true empty
state. Empty-state copy was previously verified in round-1 audit.

### S29 quotes-win-rate-side — OK
Right-rail "Win rate · last 90 days · 1 won · 1 lost · need 3 more
to call it" — small dial chart visible. Empty-but-aware copy correct
when sample size is below confidence threshold. Screenshot:
`round2/s26-quotes-pipeline.png`.

### S28 quotes-opens-spike — BLOCKED
Diego has only 1 sent quote (no opens recorded). Opens spike heuristic
not exercisable.

### S27 quotes-stale-nudge — BLOCKED
Diego has only 1 sent quote (just minutes old). Stale-nudge heuristic
not exercisable without aged-out sent quotes.

### S26 quotes-pipeline-overview — OK
Hero: "$641,693 of work sitting with clients — all of it warm. 114
open quotes across 1 client." (F3 — should not be 1 client). KPIs:
Out for response $5,200 / 1 quote, Drafting 113, Decided 2 (1 won
+ 1 lost), Win Rate (90D). Track 01 expanded by default with the
O'Brien card showing JUST SENT pill, $5,200, "Set a reminder →".
Track 02 also expanded showing a row of Drafting cards. Right rail
populated. Screenshot: `round2/s26-quotes-pipeline.png`.

### S25 clients-mobile-card-view — BLOCKED
F18 (mobile breakpoint not collapsing sidebar) makes mobile clients
view unviewable; deferred.

### S24 clients-add-private-note — BLOCKED
No clients to drill into; private-note flow not exercisable while
F3 keeps the roster empty.

### S23 clients-top-clients-leaderboard — PARTIAL
Right-rail "Top of the leaderboard · last 12 mo · No paid invoices in
the last year yet." renders. Empty-state copy correct. Cannot verify
the populated leaderboard with 0 clients + 0 paid invoices.
Screenshot: `round2/s21-clients-loop.png`.

### S22 clients-segments-filter — OK (mechanism)
Clicked "Owe you" chip → URL gained `?segment=owes`; chip toggled
selected state. Body still reads "No clients yet — add your first
one to start the roster." (Diego has 0 clients per F3.) URL
bookmarking and chip mechanics verified.
Screenshot: `round2/s22-segment-owes.png`.

### S21 clients-loop-followup — PARTIAL
TODAY'S LOOP banner says "No check-ins drafted yet — the assistant
will surface them as work piles up." with "Open the assistant" CTA.
F3: with 0 clients, the loop population path can't be exercised.
Screenshot: `round2/s21-clients-loop.png`.

### S20 assistant-status-question — ISSUE
"What's the status of my last quote for Patel?" → assistant replied
with the generic "Hey! Tell me about the job — paint, tile, plumbing,
anything. I draft quotes in seconds." Status-lookup intent isn't
recognized; the assistant doesn't have a quote-status tool. F19.
Screenshot: `round2/s20-status2.png`.

### S19 assistant-mobile-keyboard — ISSUE
Resized to 390×844 (iPhone 14 portrait). Sidebar stays open at full
width consuming most of the viewport; main chat area squished and
right-clipped; topbar text wraps awkwardly. Mobile breakpoint is
not collapsing the sidebar. F18.
Screenshot: `round2/s19-mobile-assistant.png`.

### S18 assistant-thread-switching — OK
Clicked the "I need a quote" item in the threads rail; URL switched to
/assistant/01a4430f-…; chat re-rendered with the prior conversation
history; composer remained empty (no draft bleed across threads).
Screenshot: `round2/s18-thread-switch.png`.

### S17 assistant-cancel-mid-quote — ISSUE
"Actually cancel that — never mind." → assistant replied "Got it! If
you need anything else, just let me know." But the DRAFT action card
stayed in the thread fully lockable; header chip still reads "Quote
drafted · review". Cancel verb didn't void/transition the draft. F17.
Screenshot: `round2/s17-cancel.png`.

### S16 assistant-typos-shorthand — OK
"qoute fnce repare 350 + matrials 80 for OBrien" → action card "Fence
repair — O'Brien", $350 labor + $80 materials = $430. LLM normalized
typos correctly and correctly apostrophe'd O'Brien. Cents-correct.
Screenshot: `round2/s16-typos.png`.

### S15 assistant-large-commercial — ISSUE (LLM math)
"…12000 sqft TPO, $4.50/sqft materials, $2.20/sqft labor…" →
materials line $84,000.00 (expected 12000×$4.50 = $54,000), labor
$26,400.00 (correct). Total $110,400.00 (expected $80,400). Materials
appears to use $7/sqft (which is $4.50+$2.20). LLM math bug — F16
extension. Screenshot: `round2/s15-commercial.png`.

### S14 assistant-recurring-monthly — ISSUE (LLM math 10×)
"Quote monthly lawn maintenance for Whitfield HOA — 6 visits, $180
each." → action card "Monthly lawn maintenance — Whitfield HOA",
single line "6 visits" at $10,800.00, Total $10,800.00. Correct math
is 6 × $180 = $1,080. LLM extracted amountCents as 180000 (i.e., $1,800)
per visit, then × 6, producing 10× the right answer. F16 — LLM
amountCents mis-conversion on dollar inputs >= $100.
Screenshot: `round2/s14-recurring.png`.

### S13 assistant-emergency-rush — OK / minor
"Emergency burst pipe at the Lopez place — $475 labor, $65 parts,
weekend rush surcharge $150." → action card "Emergency burst pipe
repair — Lopez" with three line items, total $690.00. All amounts
cents-correct. Minor: thread title in sidebar reads "New conversation"
rather than auto-titling from the message; other recent threads do show
descriptive titles, so this is inconsistent. F15.
Screenshot: `round2/s13-emergency.png`.

### S12 assistant-discount-applied — OK
"Quote a deck cleaning for Bryant — $300 total, give them a 10%
loyalty discount" → action card with two line items: Deck cleaning
$300.00, "10% off $300" -$30.00, Total $270.00. Discount renders as
a negative line; signs render with -$ prefix per fmtMoney.
Screenshot: `round2/s12-discount2.png`.

### S11 assistant-add-line-mid-draft — PARTIAL / ISSUE
After "Quote a fence repair for Patel — $400 labor" emitted DRAFT card,
sent "Add a line for materials, $80." Result: a NEW DRAFT card appeared
("Fence repair — Patel" with $400 labor + $80 materials = $480) but the
PRIOR draft card was NOT marked SUPERSEDED — it still reads DRAFT with
its own Lock-it-in / Edit. Two simultaneously editable drafts in the
same thread is confusing. F14. Screenshot: `round2/s11-after.png`.

### S10 assistant-lock-and-terms — PARTIAL
Lock-it-in click on the S08 thread → action card flipped DRAFT → SENT
with Re-open button + new "UP NEXT · PHASE 2 — CONTRACT TERMS" panel
emitted ("Continue to terms · Payment, warranty, dispute, governing
state — 10 quick steps"). Header chip switched to "Quote sent".
Continue click navigated to a related thread but didn't open a 10-step
wizard inline; wizard step UI not exercised in this run. F13.
Screenshots: `round2/s10-locked.png`, `round2/s10-continue.png`,
`round2/s10-wizard.png`.

### S09 assistant-vague-then-clarified — OK
Sent "I need a quote." Assistant replied "Hey! Tell me about the job —
paint, tile, plumbing, anything. I draft quotes in seconds." No action
card emitted (correct — input was vague). Header chip stayed at
"Tell Bossie about a job — voice or text". Screenshot: `round2/s09-vague.png`.

### S08 assistant-existing-customer-link — PARTIAL
"Quote for O'Brien — Deck installation upgrade, $5,200." → action card
"Deck installation upgrade — O'Brien" with $5,200.00 single line item.
LLM honored the amount (no F10 split here). However, the UI gives no
visible signal that O'Brien was matched to an existing Customer record
(no chip, no avatar reuse). F3 likely root cause — Customer rows
aren't being created/linked. Screenshot: `round2/s08-existing-customer.png`.

### S07 assistant-voice-spanish-mix — BLOCKED (env)
Voice mic button is present (`button.composer__mic[aria-label="Voice memo"]`).
Web Speech API + audio recording require a real mic + permission grant,
which Playwright headless cannot provide. Voice flow not testable here;
defer to manual QA. UI affordance verified.

### S06 assistant-first-quote-text — OK (UI) / F10 (LLM)
Typed "Quote a fence patch for the Garcia place — 6 ft of replacement
panel, $250 labor." Pressed Enter. URL flipped to /assistant/<id>;
action card "Fence patch — Garcia" drafted with line items + $2,750.00
total + Lock it in / Edit. Header chip "Quote drafted · review" updated.
Threads list reflected new conversation. F10 LLM mis-split persists.
Screenshot: `round2/s06-first-quote.png`.

### S05 dashboard-notifications-drawer — MISSING (FEATURE NOT IMPLEMENTED)
DOM scan for `[aria-label*="otification"]`, `.bell`, `.notif*`: nothing.
No bell icon or notifications drawer is rendered on /dashboard. F12.

### S04 dashboard-cmdk-search — MISSING (FEATURE NOT IMPLEMENTED)
Pressed Cmd+K on /dashboard. No palette opened; no visible affordance.
The cmdk search feature does not appear to be wired into the app. F11.
Screenshot: `round2/s04-cmdk.png`.

### S03 dashboard-live-activity — PARTIAL
"What we handled today" panel renders with header + "The monsters have
been busy" subtitle + "Full log →" link. Cannot exercise live append
(no in-flight quote send during this walk). Defer to S70.
Screenshot: `round2/s03-activity-full.png`.

### S02 dashboard-kpi-overview — OK
4-cell KPI strip renders: ACTIVE JOBS 0 (on the books), OUTSTANDING $0
(0 invoices), QUOTES PENDING 16 ($38.5k in flight), AVG. PAID JOB —
(no paid jobs yet). Hero shows pipeline-prompt copy. Sidebar Quotes
badge reads 16, matching the KPI. Console clean.
Screenshot: `round2/s02-dashboard-kpis.png`.

### S01 dashboard-first-login-empty — PARTIAL
Logged-in user (Diego) is not a fresh account; has 16 quotes. Cannot
fully exercise the empty-dashboard precondition. What I CAN verify:
KPI strip (Active jobs 0, Outstanding $0, Quotes pending 16, Avg paid
job —) renders without `NaN`/`$0.00`-as-error styling; the Active jobs
panel renders the friendly empty-state "No jobs in flight yet…" with
a "See pipeline →" link. Hero h1 is single, weekday/date present
("Thursday · April 30 · Hey, Diego 👋"). Console clean.
Screenshot: `round2/s01-dashboard.png`.

---

## Findings (consolidated, F-numbered)

| # | Severity | Surface | Summary |
|---|----------|---------|---------|
| F1 | P0 (fixed) | /dashboard | Quote side-panel rendered cents-as-dollars (×100 over). Fixed via fmtMoney. |
| F2 | P0 (fixed) | /assistant | In-thread review card double-multiplied cents. Fixed inline. |
| F3 | P1 | /clients vs /quotes | Quote count says "1 client", clients page says 0. Customer rows not being created/linked. |
| F4 | P1 | /contracts | 35 contracts in KV, 0 visible to Diego — likely seeded under different userId. |
| F5 | P1 | /i, /c | Public invoice + contract eyebrow says "PAPERWORK MONSTERS" not businessName. |
| F6 | P1 | /c | Public contract has empty PROJECT label, no scope shown to signer. |
| F7 | P2 | /i | Public invoice has no contractor identity card. |
| F8 | P2 | /dashboard | First quote in side panel renders client as "—" (LLM-summary-derived). |
| F9 | P3 | /invoices | Track 01/02 default-open vs 03/04 default-collapsed asymmetry. |
| F10 | LLM | /assistant | LLM mis-attributes "$250 labor" as $250 materials + $2,500 labor (S06). |
| F11 | P2 | /dashboard | Cmd+K palette not implemented (S04). |
| F12 | P2 | /dashboard | Notifications drawer / bell not implemented (S05). |
| F13 | P1 | /assistant | Continue-to-terms button doesn't surface a 10-step inline wizard. |
| F14 | P1 | /assistant | Add-line keeps prior DRAFT card un-superseded; two simultaneous drafts. |
| F15 | P3 | /assistant | New thread sidebar title shows "New conversation" not auto-titled. |
| F16 | LLM | /assistant | Repeated LLM math errors on dollar-input parsing (S14, S15). |
| F17 | P1 | /assistant | "Cancel" verb doesn't void the draft; chip stays "Quote drafted · review". |
| F18 | P1 | every authed page | 390px viewport: sidebar doesn't collapse; main area is unusable. |
| F19 | P1 | /assistant | Status-question intent not recognized; falls back to generic prompt. |
| F20 | P2 | /assistant | Composer draft NOT persisted to localStorage; reload loses unsent text. |
| F21 | P2 | /q | No `@media print` rules; print captures full UI including action bar. |
| F22 | P2 | /i | No PaymentRequest API / Apple Pay; "Online payment is coming soon." |
| F23 | P1 | /assistant | record_payment intent not implemented; LLM defaults to quote prompt. |
| F24 | P2 | /quotes | No CSV / export action in the page header. |

---

## Findings (in order encountered)

### F1 — Dashboard "Quotes awaiting signature" rendered cents as dollars (100×)
**Severity: P0. Caused by the cents migration.** Each quote in the right-rail
panel showed e.g. `$370,000` for what is actually a $3,700 quote.
`quoteToRow` in `front-end/islands/DashboardPage.tsx:127` was building the
displayed amount with `\`$\${Math.round(q.estimatedTotal ?? 0).toLocaleString()}\``
— treating cents-shape values as dollars. Same bug in `invoiceToRow`
(line 175) for the Outstanding panel rows.

**Fix applied.** Imported `fmtMoney` (which divides by 100) and replaced
both call sites. After fix: first four quotes read $3,700 / $4,800 / $220 /
$4,800 — matches the KPI strip's "$38.5k in flight" total.

Screenshots: `round2/01-dashboard.png` (broken) → `round2/01b-dashboard-after-fix.png` (fixed).

### F2 — AsstChat contract review card double-multiplied cents → dollars
**Severity: P0.** `AsstChat.tsx:1216-1220` had:

```ts
const totalAmount = typeof contract?.totalAmount === "number"
  ? contract.totalAmount   // post-migration: cents
  : lineTotalCents / 100;   // dollars
const totalCentsForBreakdown = Math.round(totalAmount * 100); // cents → "deca-cents"
const totalStr = totalAmount.toLocaleString("en-US", { ... });    // cents printed as dollars
```

Pre-migration this was correct (totalAmount was always dollars). Post-migration,
`contract.totalAmount` is cents, so `× 100` yielded 10000× and the displayed
total showed cents formatted as dollars (100× off). The "Total due" line on
the in-thread quote-review card and the deposit/balance milestone breakdown
both went haywire.

**Fix applied.** Refactored to keep `totalCentsForBreakdown` in cents
throughout; display via `(totalCentsForBreakdown / 100).toLocaleString(...)`.

### F3 — `/clients` shows 0 clients while `/quotes` says "105 open quotes across 1 client"
**Severity: P1.** Diego is logged in. `/quotes` reports the pipeline is "across 1 client";
`/clients` reports "0 ON THE BOOKS" with empty roster. Same user, conflicting truth.

Likely cause: `quote.customerId` references that never made it into the
clients/customers store (or the customer rows are owned by a different
userId than the quote rows). Either the assistant create-quote path is
not also upserting a Customer for Diego, or there's a userId scoping
mismatch in the backend listByUser query for customers.

Repro: open `/quotes` (note the "across N clients" sentence), then
`/clients` (note the "0 ON THE BOOKS" eyebrow). Ratios always disagree.

Screenshots: `round2/02-clients.png`, `round2/03-quotes.png`.

### F4 — `/contracts` shows 0 contracts while KV holds 35
**Severity: P1 (data scope)** — but only an issue if the 35 contracts
should belong to Diego. From the KV peek the 35 contracts are owned by
two userIds (`f1ed52cc…` and `3bee82cf…`) and Diego may be neither. If
that is the case, the page is correctly empty — but the empty-state
hero copy from my round-1 P1 #8 fix renders correctly here:
"Nothing in flight yet — when contracts get signed they'll show up
here, with the next milestone watched." (Confirmed on screenshot.)

Note for reviewer: confirm Diego's userId vs the contract owners. If a
mismatch is unintended (eg seed user changed mid-build), reseeding
under Diego is the operator-side fix.

Screenshot: `round2/04-contracts.png`.

### F5 — Public invoice + contract header eyebrow says "PAPERWORK MONSTERS" not the contractor's business
**Severity: P1.** `/q/<id>` correctly renders the contractor's
businessName at the top ("RILEY ROOFING CO."). `/i/<id>` and `/c/<id>`
render the platform brand "PAPERWORK MONSTERS" instead. From the
customer's side this looks like a different document came from a
different sender, even though it's the same job's invoice/contract.

Fix: surface the same contractor identity (businessName, fall back to
display name, fall back to "Paperwork Monsters") that the public quote
already does. The contractor lookup likely already exists; just thread
it into the invoice/contract route renderers.

Screenshots: `round2/10-public-invoice.png`, `round2/11-public-contract.png`.

### F6 — Public contract page has an empty "PROJECT" label and no scope detail
**Severity: P1.** `/c/<id>` shows the contract id, status, value, and a
sign field — but the "PROJECT" eyebrow has no body content, and the
scope of work / quote summary the customer is agreeing to is not
shown anywhere on the page they're being asked to sign.

Either pull `quote.summary` + line items into the contract page (since
the contract has `quoteId`), or remove the empty "PROJECT" label. From
a legal-signing UX standpoint, showing the scope is the right call.

Screenshot: `round2/11-public-contract.png`.

### F7 — Public invoice page has no contractor identity / contact card
**Severity: P2.** `/i/<id>` shows the amount due and a hint "Online
payment is coming soon. Reply to the email…" but doesn't tell the
customer who sent the invoice or how to reach them on the page itself.
The public quote has a contact card (phone + email); the invoice
should mirror it.

Screenshot: `round2/10-public-invoice.png`.

### F8 — Dashboard side-panel quote with no client renders as a bare em-dash
**Severity: P2 (data quality).** First quote in "Quotes awaiting
signature" reads:
- Client: "—"
- Description: "Quote: Paver Patio Installation"
- Amount: $3,700

This is `clientFromSummary("Quote: Paver Patio Installation")` returning
"—" because the LLM-emitted summary lacks the `— ClientName` suffix the
parser depends on. The parser does the right thing falling back to a
dash, but the visual reads as broken. Two paths to fix:
1. Backend: enforce a customerId on every quote (the quote-creation
   coordinator should resolve / create a Customer before persisting).
2. Frontend: when client is unresolved, hide the client row entirely
   and let the description carry the row alone.

Screenshot: `round2/01b-dashboard-after-fix.png` (top of side panel).

### F9 — `/invoices` track default-open state is inconsistent
**Severity: P3 (cosmetic).** Tracks 01 "Overdue · needs a poke" and 02
"Out for payment" are open by default; tracks 03 "Drafting" and 04
"Paid this month" are collapsed. On a fresh account where every track
is empty, this asymmetric default reads as deliberate (the user is
nudged to focus on receivables) but isn't aligned with the
canonical-reference "all tracks collapsed by default" pattern that
`/quotes` follows.

If intentional, document the rationale in the canonical reference.
Otherwise switch all four to collapsed-by-default for consistency.

Screenshot: `round2/05-invoices.png`.

### F10 — Assistant LLM mis-attributes "$250 labor" → split into $250 materials + $2,500 labor
**Severity: outside this audit's scope, but worth flagging.** Asked
"Quote a small fence patch for the Garcia place — 6 ft of replacement
panel, $250 labor" and the assistant created:
- Replacement panel installation (6 ft) — $250.00
- Labor for fence patch — $2,500.00
- Total $2,750.00

The user explicitly said the labor was $250; the LLM kept "$250" but
re-attributed it to materials and invented a $2,500 labor line. This is
LLM-prompt territory (the system prompt is treating "$250 labor" as a
hint rather than a constraint) and not a UI/UX bug, but the action card
total renders cents-correct ($2,750.00) — confirming F2's fix is live.

Screenshot: `round2/13-assistant-thread.png`.

---

## Round-1 audit fixes — re-verified live (1728×1080)

Each round-1 fix from `audit.md` was re-checked in the running app:

| Round-1 ID | Fix | Live state |
| --- | --- | --- |
| P0 #1 | cents migration | ✅ public quote `/q/03a22a99…` shows $3,700.00 (was $37); public invoice `$1,200.00`; public contract `$3,000.00`. |
| P0 #2 | empty-state title-tail break on `/payments` | ✅ "Nothing's landed yet — let's change that." breaks naturally at the em-dash. |
| P1 #3 | PSideFlow empty state | ✅ Card shows "Last 12 weeks · nothing yet" + body copy; no SVG drawn. |
| P1 #4 | sidebar identity contrast | ✅ "Diego" + "Riley Roofing Co." readable on every authed page. |
| P1 #5 | stray white square on `/assistant` | ✅ chevron toggle styled inline; no orphan square. |
| P1 #6 | hero CTA deeplinks | ✅ `?seed=` pre-fills composer, focuses, strips param. Verified `/assistant?seed=Record%20a%20payment…`. |
| P1 #7 | dashboard outstanding stray divider | ✅ in empty-state, the dashed-border `<div>` is conditional on `items.length > 0`. |
| P1 #8 | `/contracts` zero-state copy | ✅ subtitle reads "Nothing in flight yet — when contracts get signed they'll show up here, with the next milestone watched." |
| P1 #9 | `/payments` hero left padding | ✅ "PAYMENTS · APRIL" eyebrow no longer hugs the sidebar. |

---

## Coverage summary

| Surface | Walked | Notes |
| --- | --- | --- |
| `/dashboard` | yes | F1 found + fixed; sidebar identity OK; activity below the fold not deeply inspected. |
| `/clients` | yes | empty for Diego; F3 disagreement with `/quotes` count. |
| `/quotes` | yes | hero, KPIs, expand "Drafting" track verified; cards show correct cents. |
| `/contracts` | yes | zero state copy from round-1 fix verified; F4 scope question. |
| `/invoices` | yes | empty state OK; F9 default-open inconsistency. |
| `/payments` | yes | all round-1 fixes confirmed (#3, #6, #9). |
| `/assistant` | yes | empty state, threads list, send-and-draft, seed deeplink. |
| `/settings` | yes | clean; account + business cards render. |
| `/q/<id>` public quote | yes | cents migration verified; contractor identity present. |
| `/i/<id>` public invoice | yes | cents migration verified; F5 + F7 contractor identity gaps. |
| `/c/<id>` public contract | yes | cents migration verified; F5 + F6 contractor identity + scope gaps. |

**Not walked deeply** (lower-confidence coverage given context budget): mobile/tablet
viewports, voice flow, OTP login (already authenticated), thread switching,
notifications drawer, /payments with real history (Diego has none).

---

## Suggested order of follow-ups

1. **F3** (clients/quotes count disagreement) — likely a single missing
   upsert in the assistant create-quote coordinator, or a userId scoping
   mismatch in the customers list endpoint. Investigate the path that
   creates Customer rows and confirm `customerId` is round-tripping
   through `Quote.customerId`.
2. **F5 + F6 + F7** (public invoice/contract contractor identity + scope)
   — share the contractor-identity component already used by the public
   quote across all three customer-facing routes. Pull quote scope onto
   the contract page.
3. **F4** — confirm with reviewer whether the seed contracts under
   `f1ed52cc…` and `3bee82cf…` should be re-attributed to Diego's
   userId for dev parity.
4. **F8** — backend: require `customerId` on quote creation; or
   frontend: hide unresolved-client rows.
5. **F9** — pick a default-open behavior for `/invoices` tracks and
   apply consistently.

LLM-prompt issue (F10) is out of scope for a UI/UX audit — file it
under `backend/src/agents` for a separate pass.
