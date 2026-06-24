# Capture checklist — ClientsSections

**No backend running → NO fabricated screenshots.** Light theme only.

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/clients` (these four sections render in-page; there is
  no standalone route). Backend :4280 up so counts/leaderboard/segments are real.

## Viewports (own @media in clients.css)
- **1280px** — hero `.ph2` as a row (title left, Add CTA right); loop ribbon as a
  3-column grid; rail sections at 280px wide.
- **1100px** — hero stacks (`column`); `.loopbar` → 1 column; rail un-sticks and
  drops below the cards.
- **768px** — `.ph2__title` 44→28px; `.ph2__cta` full-width.

## Element(s) to crop
- `.ph2` populated hero (crumb + headline + stat sub + Add CTA).
- `.ph2` empty hero ("Let's add your *first client*").
- `.loopbar` with 3 avatars + meta + "Open the loop"; and the empty ribbon.
- `.ctop2` leaderboard (rank 01 gold + bars + amounts); and its empty state.
- `.csegment2` segment bars (4 colored fills + counts); and its empty state.

## Transient states to drive
1. **hero populated vs empty** — populated needs ≥1 client; empty needs a wiped
   account (or mock `/clients` → `[]`).
2. **loop picks vs empty** — picks need ≥1 lead/owes client; empty otherwise.
3. **leaderboard / segments empty** — fresh account with no paid invoices /
   no clients.
4. **es** — Spanish UI language: headline "*doce* personas", section titles,
   loop copy.

## Motion to film (from clients.css)
- `.ph2__crumb-dot` / `.loopbar__lbl-dot` — `ph2-pulse 2.4s` expanding ring.
- `.ph2__cta:hover` — `translateY(-2px)` + shadow (bounce).
- `.cseg2-row__fill` — `width` transition 1s bounce: film the segment bars
  filling on first paint / when `pct` changes (note: `width` animation = layout;
  flag a `scaleX` swap).
- Re-shoot with `prefers-reduced-motion: reduce` (global clamp) — pulse + 1s
  fill should go instant.
