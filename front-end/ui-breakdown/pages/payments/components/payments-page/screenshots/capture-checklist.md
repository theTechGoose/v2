# Capture checklist — PaymentsPage

**Theme:** light only (no dark mode exists).
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/payments` — the whole-page island
  (`routes/payments/index.tsx` → `islands/PaymentsPage.tsx`). It self-fetches on
  mount (`/payments`, `/invoices`, `/customers` via the dashboard client), so
  whatever state the seeded backend returns is what you'll see.

## Viewports (own + composed CSS breakpoints)
Drive **all** of these — the page composes quotes.css + payments.css media
queries, which fire at different widths:
- **1280px** — full two-column `.qlay` (main + sticky `.qside` rail), KPI 4-up.
- **1200px** — `.qlay`→1 col, rail goes static (drops below), `.qkpi`→2-up.
- **1100px** — `.qdone` tail grid →1 col (landed-row.css).
- **768px** — `.qcards` + `.qkpi` →1 col.
- **760px** — `.pph` hero →1 col; the stub stack re-fans vertically
  (payments.css `@media (max-width:760px)`).
- **560px** — `.qdone__row` tighter, `.qdone__when` hidden.

## Element(s) to crop
- **Full page** (hero → KPIs → tracks → rail) at 1280px and 760px.
- The **hero band** (`.pph`) alone — both the populated `$X showed up` variant
  and the `fresh` empty variant.
- The **`.qlay`** two-column grid (to show the sticky rail beside the tracks).

## Transient states to drive (one screenshot each)
1. **loading** — throttle the network (or use a seed account whose fetches are
   slow); the Skeletons branch (ShimmerStyle + PageHeaderSkeleton +
   CardGridSkeleton rows=2) shows before the Promise.all resolves.
2. **error** — force a fetch to throw inside the `.then` (devtools request
   block on `/payments`, then reload). Confirm `.qpage-error` renders the
   `paymentsPage.loadError` copy — note it is **UNSTYLED** (plain body text, no
   alert role) — this is a real visible bug to document, not fabricate.
3. **fresh** — a brand-new / wiped account (`GET /me/wipe`) with **0 payments**:
   the hero shows the smaller "Nothing's landed yet — *let's change that*."
   variant, KPIs read `$0` / `—`, only the Just-landed track renders with its
   `landedEmpty` hint, and every side widget shows its own empty copy.
4. **landed-only** — a seed with several settled payments this month: recent
   (≤1d) ones become `.qcard` flip cards + populate the hero stub stack; older
   ones become `.qdone` LandedRow rows. transit/attention tracks absent.
5. **with-transit** — include an ACH received <2d ago and/or a check received
   <5d ago: the **In transit** track appears (collapsed by default — click to
   expand), the pink-accent In-transit KPI cell shows a non-zero total, and the
   hero sub gains the "Plus $X on the way" line.

## Interactions to exercise (for the composed children — not page-level)
- Click a `.qtrack__head` to collapse/expand a track (QuoteTrack — persists via
  localStorage `payments:track:*`).
- Click a `.qcard` body to flip it (PaymentCard back face). Click the back-X to
  flip back. Note the front/back action buttons are **no-ops**
  (`stopPropagation` only).
- Hover `.pph__stack` to see the three stub cards lift in unison.

## Motion to film
- **Hero stub stack hover** — the three `.pph__stub--1/2/3` translate up
  together over `280ms var(--ease-bounce)` (payments-hero).
- **Card flip** — `.qcard__back` slides+scales in over `380ms var(--ease-bounce)`
  (payment-card).
- **Track collapse/expand** — chevron rotate + body grid-rows (QuoteTrack).
- Re-shoot one flip/collapse with `prefers-reduced-motion: reduce` to confirm
  the global tokens clamp stills it (no component-local guard).

## Notes / anti-patterns to capture as evidence
- The page is a **whole-page island with frozen SSR props** (only `lang`) that
  **fetches on mount** — there is a visible empty-then-pop on first paint.
  (Documented fix in payments-page.md §1: SSR a hydration seed.)
- **No `location.reload()`** anywhere on this page (read-only) — confirm by
  watching the network tab while clicking around: no full navigations.
- The **Top-payors** rail widget renders **unstyled** (undefined `.qside__*`
  classes) — crop it to evidence the bug (see payment-side-rail.md).
