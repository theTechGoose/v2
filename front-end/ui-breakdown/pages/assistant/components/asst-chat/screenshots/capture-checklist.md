# Capture checklist — AsstChat

**Theme:** light only. **Auth:** dev master OTP `000000`.
**No fabricated screenshots** — every shot is the live app at a real width/state.

> AsstChat is the chat surface itself (message list + composer + flows). It is
> the second column of the `.asst` grid, below `ChatHeaderLive`. Capture it in
> context on the real routes; crop to the chat column.

## Routes / URLs
- `http://localhost:5280/assistant` — empty chat: monster logo, title, the four
  start prompts, composer with the pink mic.
- `http://localhost:5280/assistant/<threadId>` — a seeded conversation (need a
  thread with messages; seed one or open an existing). Shows text bubbles +
  composer; if the thread has a quote, the in-chat `action-card`.
- `http://localhost:5280/assistant?onboard=1` — onboarding chat (the composer
  placeholder echoes Bossie's question).
- `http://localhost:5280/assistant/<threadId>?dev` (localhost only) — exposes
  the "Seed phase 2 wizard" debug button + the "Simulate customer accepted"
  button on a reviewed send-CTA; use these to drive the wizard/divider states.

## Viewports (real `.asst` grid breakpoints from assistant-page.css)
- **1280px** — three-column shell (threads 280 | chat 1fr | docpane 360, when a
  docpane is present; otherwise two-column).
- **1099px** — docpane hidden (`260 | 1fr`).
- **880px** — single column; threads collapse to a drawer — chat is full-width.
- **480px** — the RecordingPanel tightens (orb 44px). Shoot a recording state here.

## Element(s) to crop
- The chat column: `.chat__scroll` (message list) + the `.composer` below it.
- Individual bubble crops: a `.msg__bubble` pair (user + assistant), the
  `.action-card` (Quote+Agreement), a `.continue-cta`, a `.phase-divider`, a
  `.wiz` step card, the `.chat__jobopts` picker, the `.chat__price-capture`
  screen (with the MoneyInput hero), the `.rec-panel` voice surface.

## Transient states to drive
1. **composer focus** — click into `.composer__input`; capture the
   `:focus-within` border (green) + the `.composer__hint` (`⌘↵` / tap-to-talk).
2. **mic / voice active (ws)** — tap `.composer__mic`; allow the mic; the
   `RecordingPanel` replaces the composer. Speak so `liveInterim`/`liveFinal`
   stream in (interim words italic/muted, final words teal). Film the orb
   pulsing with `audioLevel`. (This is the **pushed** `/api/voice/stream` path.)
3. **job-option cards** — run a quote flow to the job-details step; capture the
   three `.chat__jobopt` cards, one `.is-selected`, plus an inline title/bullet
   edit input.
4. **money prompt** — pick "I already have my price" → the `.chat__price-capture`
   screen with the embedded MoneyInput hero (odometer + chips); and
   "Help me price it" → the three `.chat__price-tiers` above the MoneyInput.
5. **action-card lifecycle** — capture the same Quote card as **draft**
   (Lock-in/Edit) and after locking → **sent** (Sent chip, Re-open); plus a
   **superseded** earlier draft (dimmed) when a later card exists.
6. **continue-cta** — both `toPhase=terms` (Business/Person buttons) and
   `toPhase=send` (Review), then its `--done` state after Review is clicked.
7. **phase divider + recovery** — a clean `Contract terms` divider, and a
   failed-send divider with the inline `.recovery-card` (drive by sending a
   contract to a customer with no email on file).
8. **typing indicator** — send a message; capture the `.msg__bubble--typing`
   three-dot state before the reply lands.
9. **composer flash** — the `awaitingJobDetails` bounce cue (one-shot) on entry
   to the job-details step.
10. **Spanish** — flip Settings → language to Español; re-shoot the empty chat,
    prompts, composer hint, and a CTA. (Free-text message bodies stay verbatim.)

## Motion to film
- `composer-bounce` (the flash, ~1.6s one-shot) — film the full jump+wobble.
- `msg-in` (220ms per bubble) on a new reply; `typing-bounce` (1.2s loop).
- The RecordingPanel orb + `rec-ring`/`rec-live-pulse`/`rec-final-fade`.
- `chat-price-in` on the price screen entry; the MoneyInput odometer roll.
- Re-shoot key states with `prefers-reduced-motion: reduce` — verify `.msg` and
  `.composer__hint` still (component-local guards) AND the global clamp stills
  the bounce/voice/price animations.
