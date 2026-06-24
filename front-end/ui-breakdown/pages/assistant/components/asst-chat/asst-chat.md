# AsstChat

The assistant chat surface — message list with typed bubbles, an inline
text+voice composer, two conversation phases (`quote` → `terms`), the
job-options picker, the embedded `MoneyInput` price screen, and the in-chat
Quote+Agreement (`action-card`) card. This is the app's largest island.

> **This spec is a FAITHFUL PARTIAL (macro) decomposition.** `islands/AsstChat.tsx`
> is **8450 LOC** with ~40 `useState`/`useRef` cells, 7 local sub-components,
> a voice/STT websocket path, and a branching render tree. It is **not**
> mechanically reproducible from this doc. What this captures: the message
> **bubble TYPES**, the inline composer, the two phases, the job-option cards,
> the embedded MoneyInput + Quote card, the props, the ~18 most important
> states/cases, the real keyframes, and the data/liveness model. Micro-states
> (every wizard sub-picker, recovery branches, dev-only buttons, the per-term
> editing flows) are noted but not exhaustively enumerated. The source IS the
> source of truth — see `js/AsstChat.tsx`.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/AsstChat.tsx`). **Assistant-local** (no shared use).
- **Interaction tier:** `island` (client-only state) **with a voice websocket**.
  Message send/receive is request-response; voice transcription is **pushed**.
- **Server action + flash:** none. AsstChat does NOT submit a `<form>` and has
  **no Fresh server action / flash**. Every mutation goes through the typed
  `clients/assistant.ts` (`assistantClient.chat`, `.conversation`,
  `.lockQuote`, `.transitionToTerms`, `.acceptContract`, `.sendContract`,
  `.bindCustomer`) or `lib/api.ts` (`/quotes`, `/invoices/:id/email|text`,
  `/agents/job-details/*`). Optimistic-append + re-fetch the conversation
  detail; no full-page reload.
- **Client state owned (the load-bearing subset):**
  - `convoId`, `messages: Message[]` — seeded from `conversationId` /
    `initialMessages` (SSR), then appended optimistically and reconciled by
    `assistantClient.conversation(convoId)` after each turn.
  - `customer`, `contract`, `quote`, `quoteId` — bound entities; `quote` is
    lazily fetched when the conversation has a `quoteId`.
  - `draft: string` — composer text. `sending`, `error` — turn lifecycle.
  - Phase/flow flags: `priceCaptureOpen`, `priceCents`, `suggestPricing`,
    `priceSuggestions`, `awaitingJobDetails`, `submittedJobDetails`,
    `jobOptionsOpen`, `jobOptions`, `selectedOptionId`, `pickerMode`
    (`"polish"|"confirm"`), `previewCtaId`, `previewLang`, `channelMenuOpen`,
    `invoiceFlow`, `invoiceCustomerOpen`, `invoiceResult`, `customerPickerOpen`.
  - Voice/STT: `recording`, `recElapsed`, `audioLevel`, `liveInterim`,
    `liveFinal` + refs `recorderRef` (MediaRecorder), `audioCtxRef`,
    `sttSocketRef` (WebSocket), `recStreamRef`, `finalSoFarRef`.
  - **View-history stack** (`historyStackRef: ViewSnapshot[]`): a UI-only
    undo stack of `{priceCaptureOpen, awaitingJobDetails, submittedJobDetails,
    pendingJobDetailsRaw, pendingPriceCents, priceCents, jobOptionsOpen}`.
    `pushHistory()` before a view change; `popHistory()` on the
    `pm:asst-back` event from ChatHeaderLive. Depth is broadcast via
    `pm:asst-history`.
  - `lang` = `langSignal.value` (the `lang` prop is an ignored SSR seed).
- **Cross-island PUSH (it's the publisher):** dispatches `pm:asst-header`
  (`{client, status}`) → **ChatHeaderLive** updates the header title/status in
  place; dispatches `pm:asst-history` (`{depth}`) → the header's back button
  appears; listens `pm:asst-back` to pop its stack. Also reads the dash cache
  (`readCached`/`subscribeDash`/`refreshDash` from `lib/dash-cache.ts`) for the
  overdue-invoice gate.
- **Data source:** `clients/assistant.ts` (+ `quotesClient`, `clientsClient`,
  `contractsClient`, `filesClient`, `api`). See `data-model.md` §1.9
  (`Conversation`/`Message`/`JobOption`/`ConversationDetail`).
- **Liveness — voice is PUSHED via websocket `/api/voice/stream`:**
  `openSttSocket(sampleRate)` opens `ws(s)://{host}/api/voice/stream?sample_rate=…`
  — a Fresh SSR proxy bridging to **AssemblyAI v3 streaming** (key kept
  server-side). It resolves on the `Begin` frame; `Turn` frames stream
  `transcript` (interim → `liveInterim`; `end_of_turn` → appended to `liveFinal`);
  `Termination`/`error` close it. A parallel `MediaRecorder` captures the
  authoritative blob (uploaded as the fallback / image-of-record). If the ws
  never comes up it resolves `null` and the path falls back to backend-only
  transcription. **Message chat itself is NOT live** — it's request-response.
- **Honest-empty:** `empty = messages.length === 0` → `.chat__empty` with the
  monster logo, a title, and four start prompts (known-price / help-me-price /
  quick-quote / invoice). No blank-screen on an empty thread.
- **Anti-patterns:** **no `location.reload()`** (verified — grep clean). The
  cross-island state lives in `globalThis` CustomEvents rather than a shared
  store (acceptable, but couples AsstChat ↔ ChatHeaderLive by event-name
  contract). The history undo stack is a ref of UI flags (snapshot drift risk
  if new flow flags are added but not added to `ViewSnapshot`).
- **Data-shape hazards:**
  - `Message.createdAt` is **epoch-ms number** (not ISO) — `fmtTime` handles
    both but cases must use numbers (e.g. `1750247400000`).
  - Money everywhere is **integer cents** (`totalCents`, `priceCents`,
    `estimatedTotal`, line-item `amountCents`). `fmtUSD(cents)` divides by 100.
    The embedded MoneyInput emits cents.
  - `action_card`/`continue_cta`/`phase_divider`/`wizard` carry an untyped
    `m.payload` object the render narrows per-kind (`ActionCardPayload`,
    `{toPhase,summary,contractId}`, divider `{label,channel,emailedTo,
    emailFailureReason,…}`, `{stepId,options,hint}`). Older threads can miss
    fields (e.g. divider `channel`) — the render infers them defensively.
  - A DRAFT `action_card` is marked **superseded** (dimmed, buttons removed)
    when a later card for the same `quoteId` has advanced — earlier cards stay
    in history but can't re-fire.

## 2. Anatomy
```
<>
  <div class="chat__scroll" ref=scrollRef>
    (empty || jobOptionsOpen)
      ? <div class="chat__empty">
          [first-screen logo + title]                         ← when no sub-flow open
          jobOptionsOpen   → .chat__jobopts (job-option cards, back, edit titles/bullets)
          : awaitingJobDetails → details entry (textarea routes to /job-details)
          : invoiceResult  → invoice-sent result card
          : priceCaptureOpen → .chat__price-capture { back, title, [price tiers], <MoneyInput/>, Continue }
          : <div class="chat__empty-prompts"> 4× .chat__empty-prompt
          [localhost+?dev → .chat__empty-debug "Seed phase 2"]
        </div>
      : visible.map(m =>                                       ← the message list, by m.kind
          m.role==="user" && payload.wizardStepId → .wiz-log (compact pick line)
          m.kind==="phase_divider" → .phase-divider [+ .recovery-card if send failed]
          m.kind==="continue_cta"  → .msg > .continue-cta [--done] (terms/send/invoice CTA)
          m.kind==="wizard"        → .msg > .wiz (question + <CustomerStepPanel>/option buttons)
          m.kind==="action_card"   → .msg > .action-card (Quote+Agreement: head/chip, details,
                                       line items, total, Lock-in/Edit or Re-open)
          m.kind==="text" && content==="PM_ONBOARDING_DEMO_CTA" → sample-quote link chip
          else → .msg[.msg--user] { .msg__avatar, [.msg__image], .msg__bubble (pre-wrap), .msg__time })
    [sending && last msg is user] → .msg__bubble--typing (3 typing-dots, aria-live)
  </div>

  {composerHidden ? null :                                    ← hidden on tap-only screens (see §4)
    <div class="composer [composer--flash]">
      [error → .composer__err]
      recording
        ? <RecordingPanel elapsed level finalText interimText onStop onCancel/>
        : <>
            <div class="composer__inner">
              <textarea class="composer__input" ref=taRef placeholder=composerPlaceholder(...)/>
              <div class="composer__tools">
                <button class="composer__mic" onClick=toggleRecord/>     ← brand-pink, PRIMARY
                <button class="composer__send" onClick=onSendClick disabled=!draft.trim/>
              </div>
            </div>
            <div class="composer__hint">{tap-to-talk / ⌘↵ hint}</div>   ← composerHintPulse
          </>
    </div>}
</>
```
- **Sub-components (local, same file):** `RecordingPanel` (voice orb +
  transcript), `CustomerStepPanel` (business/person customer picker),
  `WizardFollowUpForm`, `CustomDatePickerForm`, `CustomDurationPickerForm`,
  `CustomWarrantyPickerForm`, `CustomPaymentPickerForm`.
- **Embedded islands/components:** `<MoneyInput/>` (price screen), and the
  in-chat `action-card` reproduces the Quote card shape (canonical `QuoteCard`
  lives in `pages/quotes/components/`).
- **Helpers:** `deriveUserInitials` (exported; mirrors backend initials),
  `fmtUSD`, `fmtTime`, `composerPlaceholder` (echoes the onboarding question),
  `statusChipLabel`, `buildPaymentMilestones` (via `lib/payment-split.ts`).
- **Icon dependency:** `I` + `ICN.*` from `lib/dash-icons.tsx` (+ inline `<path>`
  back chevrons).

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `conversationId` | string | `undefined` | text | no — seeds `convoId` |
| `initialMessages` | `Message[]` (required) | — | (json) | no — seeds `messages` |
| `initialCustomer` | `CustomerLite` | `undefined` | (json) | no |
| `initialContract` | `ContractLite` | `undefined` | (json) | no |
| `userInitials` | string | `"?"` | text | no — user-avatar disc |
| `from` | `{business?,name?,phone?,email?}` | `undefined` | (json) | no — contractor "FROM" for preview |
| `sendLanguages` | `string[]` | `["en"]` | (json) | no — drives the preview-lang toggle |
| `lang` | `Lang` | (ignored) | select | **ignored SSR seed** — reads `langSignal.value` |

> Callbacks aren't props — AsstChat owns its flow; the only cross-component
> wiring is the `pm:asst-header` / `pm:asst-history` / `pm:asst-back`
> CustomEvent contract with ChatHeaderLive.

## 4. States → cases
The ~18 load-bearing states. Heavy children (MoneyInput, RecordingPanel,
CustomerStepPanel) are stubbed via `_mocks` in cases so the still renders.

| state | meaning | case |
|---|---|---|
| empty | `initialMessages=[]` → first-screen logo + 4 prompts | `cases/empty/empty.json` |
| conversation | a real back-and-forth (user + assistant text bubbles) | `cases/conversation/conversation.json` |
| typing | last msg is user + `sending` → typing-dots | `cases/typing/typing.json` |
| job-options | `jobOptionsOpen` → three scope-of-work cards (one selected) | `cases/job-options/job-options.json` |
| price-capture | `priceCaptureOpen` → MoneyInput screen (mocked) | `cases/price-capture/price-capture.json` |
| price-suggest | help-me-price → three price tiers + custom MoneyInput | `cases/price-suggest/price-suggest.json` |
| action-card-draft | in-chat Quote card, status=draft → Lock-in/Edit | `cases/action-card-draft/action-card-draft.json` |
| action-card-sent | Quote card, status=sent → Re-open | `cases/action-card-sent/action-card-sent.json` |
| continue-terms | `continue_cta` toPhase=terms → Business/Person buttons | `cases/continue-terms/continue-terms.json` |
| continue-send | `continue_cta` toPhase=send → Review button | `cases/continue-send/continue-send.json` |
| wizard-step | a `wizard` bubble (config step, option buttons) | `cases/wizard-step/wizard-step.json` |
| phase-divider | a `phase_divider` separator ("Contract terms") | `cases/phase-divider/phase-divider.json` |
| recovery | failed-send divider → contact-recovery card | `cases/recovery/recovery.json` |
| recording | mic hot → RecordingPanel takes over composer (mocked) | `cases/recording/recording.json` |
| composer-flash | `awaitingJobDetails` + empty draft → bounce cue | `cases/composer-flash/composer-flash.json` |
| image-bubble | a `kind:"image"` message bubble | `cases/image-bubble/image-bubble.json` |
| es | Spanish chrome (langSignal flipped) | `cases/es/es.json` |

> **Isolate note.** AsstChat fires no-backend network calls (`assistantClient`,
> `api`, the voice ws, `refreshDash`) on mount; in isolate these 404/throw and
> are swallowed, so the island stays on its seeded props. The composer is
> **hidden** whenever `priceCaptureOpen || jobOptionsOpen || invoiceCustomerOpen
> || invoiceResult || hasUnansweredWizard || previewCtaId` — so the
> price/jobopts/wizard cases will NOT show a composer (expected). Cases use REAL
> seed values from `lib/asst-seed.ts` (t1–t7: "Tom & Linda K.", "Marcus Lin",
> "Hilltop Diner", "Sarah Chen", "Greenleaf HOA", "Cobblestone Cafe", "Bayside
> Properties") mapped onto `Message`/`Conversation`. `_mocks` stubs `MoneyInput`,
> `RecordingPanel`, `CustomerStepPanel`. `createdAt` is epoch-ms.

## 5. Events
- `ev.expect(e => e.source === "button.composer__send" && e.type === "click")`
  → `onSendClick` (optimistic append + `assistantClient.chat`).
- `ev.expect(e => e.source === "textarea.composer__input" && e.type === "keydown" && e.key === "Enter" && !e.shiftKey)`
  → send (Shift+Enter = newline).
- `ev.expect(e => e.source === "button.composer__mic" && e.type === "click")`
  → `toggleRecord` → opens the voice ws + MediaRecorder (mic permission).
- `ev.expect(e => e.source === "button.chat__empty-prompt")` → opens a flow
  (`startKnownPriceFlow` / `startHelpMePriceFlow` / `startInvoiceFlow`).
- `ev.expect(e => e.source === "button.chat__price-continue")` → `onPriceContinue`.
- `ev.expect(e => e.source === "div.chat__jobopt")` → `setSelectedOptionId`.
- `ev.expect(e => e.source === "button.action-card__btn--primary")` →
  `lockActionCard` (locks the quote, then transitions).
- `ev.expect(e => e.source === "button.continue-cta__btn")` → `submitContinueCta`.
- Incoming (not user events): `pm:asst-back` from ChatHeaderLive → `popHistory`.
- Outgoing dispatches: `pm:asst-header`, `pm:asst-history`.

## 6. Motion (extracted — see css/asst-chat.css)
- **Message in:** `@keyframes msg-in` (`opacity 0→1`, `translateY 8px→0`,
  `scale .98→1`) `220ms cubic-bezier(.22,1,.36,1) both` — guarded
  component-locally (`.msg { animation: none }` under reduced-motion).
- **Typing dots:** `@keyframes typing-bounce` (`translateY 0→-4px`, staggered
  150/300ms) `1.2s infinite`.
- **Composer flash:** `@keyframes composer-bounce` — a real bouncy-ball jump
  (apex −200px) + damped jell-o rotation wobble, `1.6s 250ms 1 both`,
  `transform-origin: 50% 100%`, `will-change: transform`. **Jank finding:** the
  −200px translate + `will-change` is GPU-promoted and smooth; the multi-stop
  rotation is the single most expensive animation in the surface — acceptable as
  a one-shot, would be janky if looped. Relies on the global reduced-motion clamp.
- **Composer hint:** `@keyframes composerHintPulse` (`opacity 1→.45`) `1.8s
  infinite` — guarded component-locally.
- **Voice panel:** `rec-panel-enter` (240ms), `rec-panel-bg-drift` (14s drift),
  `rec-ring` (audio-threshold ripples), `rec-live-pulse` (1.05s), `rec-final-fade`
  (per finalized chunk), `rec-caret-blink` (1s steps) — all rely on the global clamp.
- **Flows:** `chat-price-in` / `chat-details-in` (entry), `chat-details-pulse`
  (writing dots), `spin` (button spinner), `quote-menu-in` / `custDdReveal`
  (channel/customer dropdowns).
- **Reduced motion:** ONLY `.msg` + `.composer__hint` are guarded
  component-locally; **everything else relies on the GLOBAL tokens clamp**
  (`animation-duration: 0.01ms !important`). The rebuild must keep both. Verify
  the composer bounce and the voice orb still under reduced-motion.

## 7. Responsive
- **No own `@media`.** AsstChat is laid out by the page's `.asst` grid (the
  chat column is `minmax(0, 1fr)`):
  - `≥1100px`: `280px | 1fr | 360px` (threads | chat | docpane, when a docpane
    exists; `.asst:not(:has(.docpane))` drops the third track).
  - `≤1099px`: `260px | 1fr` (docpane hidden).
  - `≤880px`: single `1fr` column — threads collapse to a drawer (page CSS).
  - `≤480px`: the `RecordingPanel` tightens (orb 44px, 12px padding) — the only
    AsstChat-relevant `@media` and it lives in the page sheet, not this island.
- The composer's `padding-bottom: calc(16px + env(safe-area-inset-bottom))` +
  `--app-vh` (from the `MobileViewport` island) keep the input above the iOS
  keyboard / home indicator. `.composer__input` is `font-size:16px` to defeat
  iOS Safari focus-zoom.

## 8. A11y
- Composer: `<textarea>` + real `<button>`s with `aria-label`/`title`
  (mic = voiceMemo, send = send). The typing indicator has `aria-live="polite"`
  + an `aria-label`. Good.
- **Gaps:** job-option cards are `<div role="button" tabIndex=0>` (acceptable
  but a real `<button>` is cleaner); the voice transcript has no `aria-live`
  region (silent to AT during dictation); the MoneyInput screen hides the
  composer entirely (tap-only) which is fine but means no text alternative; the
  `kind:"image"` bubble uses `filename` as `alt` (falls back to a generic
  string). Phase dividers are decorative `<div>`s, not landmarks.

## 9. Used on
Both assistant route variants: `routes/assistant/index.tsx`
(`initialMessages=[]`, `userInitials`, `sendLanguages`) and
`routes/assistant/[threadId].tsx` (full set incl. `conversationId`,
`initialMessages` from detail, `initialCustomer`, `initialContract`, `from`).
Embeds `MoneyInput`. CSS lives in `static/assistant-page.css` (the `.chat__*`,
`.msg*`, `.composer*`, `.action-card*`, `.continue-cta*`, `.phase-divider*`,
`.wiz*`, `.rec-panel*`, `.chat__price*`, `.chat__jobopts*` families) — this
folder's `css/asst-chat.css` is a representative extract of that subset.
