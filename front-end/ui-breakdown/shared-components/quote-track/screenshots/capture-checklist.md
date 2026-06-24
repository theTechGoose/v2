# Capture checklist — QuoteTrack

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/quotes` (default — localized "quote" unit; Track 01
  "Out for response" defaults open, Tracks 02/03 collapsed).
- `http://localhost:5280/invoices` and `/payments` for the `unit` variants.

## Viewports
- **1280px** and **640px** (header + body grid reflow per quotes.css).

## Element(s) to crop
- A single `<section class="qtrack">` (header row + body cards). Capture both an
  expanded and a `qtrack--collapsed` instance.

## Transient states to drive
1. **open** — Track 01 expanded with cards in the body.
2. **collapsed** — click `.qtrack__head` to collapse (chevron rotates to point
   right; body clips to 0). Reload to confirm `localStorage[storageKey]`
   persisted the closed state.
3. **custom-unit** — /invoices or /payments → count reads "1 invoice" / "N
   payments".
4. **zero** — a track with `count=0` → "0 quotes".
5. **es** — Spanish UI language → localized count label.

## Motion to film
- Collapse/expand: chevron rotate (240ms bounce) + body `grid-template-rows
  1fr→0fr` (+ margin) over 320ms ease-out. Film one toggle. Re-shoot with
  `prefers-reduced-motion: reduce` (relies on global clamp — verify it stills).
