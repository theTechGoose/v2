# Capture checklist — PhoneChat

**Theme:** light only.
**Route/URL:** `http://localhost:5280/` — scroll to the `.demo` section ("See it
in action"). Auth-free (landing) → **capture-ready** (no login needed).
Story mode also at `/stories/demo-phone-chat` if that route is running.

## Auth
None. Landing is public.

## Viewports (this component never reflows internally; phone is fixed 320×580)
- **Desktop ≥980px** — phone sits right of the demo copy (two-col `.demo-grid`).
- **≤980px** — `.demo-grid` stacks (copy above phone); shoot to confirm the
  stack (landing.css `@media (max-width:980px)`).
- **≤560px** — page width check (hero visual drops, but the demo phone stays).

## Element(s) to crop
- The whole `.phone` mockup (tight crop incl. status bar + chat-input bar).
- The `.quote-card` step alone (the payoff frame).
- The `.typing` three-dot indicator (mid-conversation).

## Transient states to drive
1. **end-state** — let it finish; capture the final frame (quote + "Sent to client").
2. **playing** — refresh and catch a `typing` step + a half-filled body
   (re-trigger by scrolling the phone out of and back into view, or reload).
3. **es** — flip the nav language toggle to "Yo hablo Español"; the phone
   replays in Spanish (scriptEs/quoteEs). Capture the Spanish quote card.
4. **story-controls** (story route only) — Play, Reset (empty), End-state frames.

## Motion to film
- `bubble-in` step entrance (360ms bounce) — film the reveal sequence end-to-end.
- `typingBounce` dots (1.2s loop) — short loop.
- Reduced motion: re-run with `prefers-reduced-motion: reduce`; bubbles should
  appear instantly (global clamp) while the JS reveal cadence still steps.
