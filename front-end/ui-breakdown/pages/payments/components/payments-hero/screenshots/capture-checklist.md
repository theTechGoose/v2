# Capture checklist — PaymentsHero

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/payments` — the `.pph` band is the first element on the
  page (above the KPI strip). It's a child of the PaymentsPage island, so its
  state follows the seeded payment data; you can't address it standalone.

## Viewports (own `@media`)
- **1280px** — two-column hero: copy left, rotated stub stack right.
- **760px** — the `@media (max-width:760px)` cutover: hero → 1 col, the stub
  stack re-fans **vertically** below the copy. Shoot at ~759px to confirm.

## Element(s) to crop
- The whole `<header class="pph">` (copy + stub stack).
- A single `.pph__stub` close-up (avatar gradient + amount + method pill +
  "Landed" tag).

## Transient states to drive
1. **populated** — a seed with landed payments this month: the
   `$X showed up this month.` headline + up to three rotated stubs + the
   "Plus $Y on the way" sub (needs at least one in-transit payment).
2. **fresh** — wiped/empty account (0 payments): the smaller
   "Nothing's landed yet — *let's change that*." variant, freshSub copy, empty
   stack.
3. **no-transit** — landed-only seed (no ACH/check inside its window): sub reads
   just "Every dollar logged." (no "Plus … on the way" clause).
4. **es** — switch UI language to Spanish (Settings) → eyebrow / title-tail /
   sub / CTAs localize; the `$` number stays en-US formatted.

## Motion to film
- **Stub stack hover** — hover `.pph__stack`; the three `.pph__stub--1/2/3`
  lift together (~1–3px each, keeping their rotations) over
  `280ms var(--ease-bounce)`.
- **CTA hover** — `.pph__cta` nudges up 1px (`160ms` bounce); `.pph__ghost`
  background fades.
- Re-shoot the stub-hover with `prefers-reduced-motion: reduce` (relies on the
  global clamp — verify it stills).

## Notes
- `.pph__stack` is decorative (`aria-hidden`) — capture is for visual fidelity
  only.
- Both CTAs navigate to `/assistant?seed=…` (they do NOT record/export here) —
  if filming a click, expect a route change, not an in-place action.
