# Capture checklist — AsstThreads

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/assistant` (no active row) and
  `http://localhost:5280/assistant/<threadId>` (one `.thread--active`).
- The left column is hidden by the page grid below its breakpoint — capture the
  threads column at a width where it's shown (≥980/1201px).

## Viewports
- **1280px** (full 3-col grid, threads = 280px column) and the **collapsed rail**
  (≥1201px after clicking the toggle → 64px column).
- Optionally 1100px to confirm the column drops out (page CSS, not this island).

## Element(s) to crop
- The whole `<aside class="threads">`: head (toggle + title + count), the green
  "New conversation" CTA, and the grouped list (group labels + thread rows).
- A row with `thread--unread` (pulsing dot + bold client) and a row that is
  `thread--active`.

## Transient states to drive
1. **default** — grouped Today / Yesterday rows with status chips.
2. **unread** — needs a thread where the customer signed the contract
   (`hasUnreadEvent`); the green dot pulses and the client name goes bold. With no
   backend, force via the dev sim accept-contract path, or rely on isolate.
3. **collapsed** — click `.threads__toggle`; labels/list hide, the parent `.asst`
   grid narrows the column to 64px. Reload → confirms `localStorage
   ["pm:threads-collapsed"]` persisted.
4. **empty** — a brand-new account with zero conversations → `.threads__empty`.
5. **chip-variants** — threads at draft / quote-sent / contract-sent / signed /
   invoiced / paid stages to capture all four chip colors.

## Motion to film
- The unread `thread-pulse` ring (1.6s ease-out) — film one cycle; re-shoot with
  reduced-motion (global clamp).
- The collapse toggle: column narrow + label fade (no dedicated keyframe; CSS
  display swap + grid template change).

## Liveness note
- The list polls `/agents/conversations` every 8s and on tab focus. To see a live
  update, trigger a customer accept in another context and watch the unread dot
  appear within ≤8s (no reload).
