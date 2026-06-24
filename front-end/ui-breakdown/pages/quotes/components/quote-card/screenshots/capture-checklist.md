# Capture checklist — QuoteCard

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/quotes` — cards live inside Track 01 "Out for response"
  (defaults open) and Track 02 "Drafting" (collapsed → expand it to shoot the
  draft card). Decided quotes render as DecidedRows, NOT QuoteCards, so the
  `won` card-as-rendered state is isolate-only (drive via the isolate `won`
  case, not the live page).

## Viewports
- **1280px** (full track grid, ~3 cards/row) and **640px** (single column —
  `.qcards` minmax(320px) drops to 1 col; the page shell also cuts at 640/641px).
- The card has **no own `@media`**; reflow is driven by `.qcards` and the page
  `.qlay` 1200px collapse. Shoot at 1280 + 640 to capture both grid widths.

## Element(s) to crop
- A single `<article class="qcard">` — capture each mood ramp:
  - **opened-hot** (orange, opens badge "3×") — Q-1107.
  - **sent** (pink, no opens badge) — Q-1108.
  - **draft** (coffee, no badge) — Q-1109 (expand Track 02).
  - **stale** (red) — Q-1101.
- Crop tight to the article (it has `overflow:visible` + a drop shadow — include
  ~24px bleed for the shadow).

## Transient states to drive
1. **front** — default; note the `q-pulse-dot` status dot pulsing.
2. **hover** — card lifts `translateY(-4px)` with a deeper mood-tinted shadow.
3. **flipped** — click the card body (not the CTA) → back face scales/fades in
   (380ms bounce). Shoot: the opens **timeline** (Q-1107, 3 opens across
   iPhone/Mac) AND the empty `quoteCard.back.noOpens` line (drive a 0-opens card,
   e.g. a fresh `sent`).
4. **copied** — click "Copy link" in the back foot → label flips to "Copied!"
   for 1500ms (clipboard write). Capture mid-window.
5. **delete-confirm** — click "Delete" in the back foot → native
   `globalThis.confirm("Delete this quote? This cannot be undone.")` dialog.
   Shoot the confirm dialog (then cancel — confirming reloads the page).
6. **back-close** — back-face × button (top-right) returns to front.

## Motion to film
- **Flip:** `.qcard__back` `translateY(8px) scale(.98) → 0/1` over 380ms
  `--ease-bounce` + opacity 240ms `--ease-out`. Film one flip + one close.
- **Hover lift:** 320ms transform (bounce) + shadow (ease-out).
- **Pulse dot:** `q-pulse-dot` 2.4s loop (the only quotes.css keyframe).
- Re-shoot the flip with `prefers-reduced-motion: reduce` — there is NO
  component-local guard, so verify the global tokens clamp makes it instant.
