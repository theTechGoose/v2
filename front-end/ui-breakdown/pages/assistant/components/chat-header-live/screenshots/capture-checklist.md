# Capture checklist — ChatHeaderLive

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/assistant` — header seeded "New conversation" / help line.
- `http://localhost:5280/assistant/<threadId>` — header resolves to the bound
  customer name + phase-prefixed status; on a thread with view-history (after
  opening the quote review then any sub-screen) the **back** button appears.

## Viewports
- **1280px** (full 3-col shell) and **720px** (mobile cutover, header still
  full-width above the chat).

## Element(s) to crop
- The single `.chat__head` strip (title + pulsing dot + sub-status + the
  share/more tool buttons). Capture once without and once with the back button.

## Transient states to drive
1. **new** — land on `/assistant`; title "New conversation".
2. **named** — open a thread / start a conversation that binds a customer; watch
   the title swap in place (driven by `pm:asst-header`, no reload).
3. **with-back** — inside a thread, drill into the quote review or a wizard
   sub-screen so AsstChat pushes history → the back chevron fades in.

## Motion to film
- The `.chat__head-dot` `tickerPulse` ring (1.6s) — film one cycle.
- Re-shoot with `prefers-reduced-motion: reduce` (global clamp — verify it
  stills).
- The title/status live-swap is a state replace (no transition of its own).
