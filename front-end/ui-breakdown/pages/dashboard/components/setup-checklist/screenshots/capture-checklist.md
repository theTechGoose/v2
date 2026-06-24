# Capture checklist — SetupChecklist

**Theme:** light only.
**Auth:** log in with dev master OTP `000000`.
**Route:** `http://localhost:5280/dashboard`. The card renders between the
`.assistant-cta` banner and the KPIs — only when the logged-in profile has at
least one incomplete item and the card hasn't been hidden this session.

> PROJECT FACT: this is the entire profile-collection mechanism — there is NO
> onboarding nav-gate/redirect. Capture it as an opt-in, dismissible card; do not
> expect (or screenshot) any "you must finish your profile" wall.

## Element(s) to crop
- The `<section class="panel" aria-label="Finish setting up">` card: pink-tinted
  gradient, eyebrow + heading, the 4px progress bar, and the auto-fit item grid
  with green "✓" / empty check bubbles.

## Viewports
- The card has no media queries of its own; the item grid auto-fits
  (`minmax(220px, 1fr)`). Shoot at **1280px** (multi-column item grid),
  **720px** (fewer columns), and **390px** (single-column items; header
  "Finish setting up…" + "Hide" wrap).

## Transient / data states to drive
1. **partial** — a profile with several items missing (e.g. no logo/address/
   payment/insurance): the card shows with a partial bar and a mix of green-✓ and
   empty bubbles. Heading reads "Finish setting up — N things left".
2. **almost-done** — a profile with only one item left: heading reads
   "Finish setting up — 1 thing left" (singular), bar near full.
3. **all-done** — a fully-completed profile: the card is GONE (renders null).
   Capture the dashboard WITHOUT the card to evidence the self-hide.
4. **dismissed** — click "Hide"; the card unmounts. Then RELOAD and confirm it
   COMES BACK (dismiss is session-only, not persisted) — capture both to document
   the flagged non-persistence.
5. **progress-bar tween** — if you complete an item in Settings and return so
   `pct` changes between renders, film the 480ms `width` transition on the bar.
   Re-shoot with `prefers-reduced-motion: reduce` (global clamp to 0.01ms — the
   bar should snap).

## Notes
- To force the "partial" state on a seeded account, you may need a profile with
  gaps; otherwise the card may already be hidden (all-done). Set up the account's
  profile fields accordingly before capture.
- NO fabricated screenshots — capture only the live `/dashboard` render.
