# Capture checklist — ContractCard

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/contracts` — the only host. Cards live inside the
  `ContractTrack` bands. To see every mood you need an account whose contracts
  span the moods (active → Track 01, starting-soon → Track 02, wrapping-up →
  Track 03, draft/stale → Track 04). Track 01 is open by default; expand 02/03/04
  (click `.ktrack__head`) to reveal their cards.

## Viewports
contract-card.css has **no media query** — the card is fixed-internal, reflowing
only via the `.kcards` grid. Shoot at the host-page breakpoints:
- **1280px** (`--container-product`) — cards 3-up.
- **1100px** (contracts-sections KPI reflow point) — grid still auto-fill.
- **700px / ~360px** — single-column; verify the 2-line title clamp + 3-line
  story clamp + the foot grid (CTA / value) stay legible at the narrowest column.

## Element(s) to crop
- A single `<div class="kcard">` front face: gradient `.kcard__mood` (status pill,
  when pill, ghost numeral), `.kcard__av` avatar, body, progress bar, foot.
- The same card **flipped** (`.kcard--flipped`): `.kcard__back` head + milestone
  list + 3-button `.kcard__back-foot`.
- One card per mood (6 palettes) so the deterministic mood colors are documented.

## Transient states to drive
1. **mood faces (×6)** — active / starting-soon / wrapping-up / completed / draft
   / stale. Each has a distinct gradient + status pill + when label + CTA.
   (active picks 1 of 4 accent variants by `hashId(id)` — capture a couple ids.)
2. **hover** — pointer over a card → `translateY(-4px)` lift + deeper mood shadow.
3. **flip** — click the card surface (NOT the CTA, NOT the back) → back face rises
   in (`translateY(8px)→0`, `scale(.98)→1`, fade). Capture the back: milestone
   checklist (done = struck through + filled check; current = pink ring) + the
   3 action buttons.
4. **close** — click `.kcard__back-close` (×) → returns to front.
5. **CTA isolation** — click `.kcard__cta` → should NOT flip (it stops
   propagation and navigates). Verify it doesn't flip the card.

## Crop targets — bug to capture (do NOT fix in the shot, document it)
- **`.kcard__numeral` clip bug:** the 96px ghost numeral is `bottom:-18px` under
  `overflow:hidden` → its descender is clipped at the mood-header bottom edge.
  Crop the mood header bottom-right corner to show the clipped numeral. (Sibling
  `.qcard__numeral` was fixed to `bottom:4px`; this was not ported. Flag in spec.)

## Motion to film
- **Flip:** `transform 380ms var(--ease-bounce)` + `opacity 240ms var(--ease-out)`
  (rise + scale + fade — NOT a 3D rotate). Film one flip + close.
- **Hover lift:** `transform 320ms var(--ease-bounce)`.
- **Progress fill:** `width 480ms var(--ease-out)` (films on mount / pct change).
- **Status-dot pulse:** `q-pulse-dot` 2.4s (cosmetic — note it is NOT live data).
- Re-shoot the flip + hover with `prefers-reduced-motion: reduce` — **no
  component-local guard**, so verify the global tokens clamp makes them instant.

## NO fabricated screenshots
All frames must come from the live `/contracts` route. Isolate cases cover the
six moods + flipped state for state-completeness; the deliverable motion filmstrip
and the numeral-clip crop come from the running app.
