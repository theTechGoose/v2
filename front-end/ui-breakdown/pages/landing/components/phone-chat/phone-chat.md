# PhoneChat

The demo SMS-mockup phone that animates a contractor → assistant conversation,
ending in a quote card. Page-local to `/` (landing) — mounted in the `.demo`
section. Also drives a `/stories/demo-phone-chat` playground (story mode).

## 1. Classification & behavior
- **Bucket:** `island` (`islands/PhoneChat.tsx`).
- **Interaction tier:** `island` (client-only state + IntersectionObserver +
  timer-driven reveal). No server calls, no mutations, no network of any kind.
- **Client state owned (all `useState`):**
  - `lang: "en"|"es"` — seeded from `langSignal.value` **only when** `scriptEs`
    is supplied (`usesLangSignal`); otherwise from the `lang` prop. Subscribes
    to `langSignal` so the landing language toggle re-renders + replays it.
  - `shown: number` — how many script steps are rendered (slice end). Defaults
    to `activeScript.length` (final state) so static review lands on the end.
  - `hidden: Set<number>` — indices whose step is `display:none` (used to hide a
    `typing` step once the real reply after it appears).
  - refs: `cancelRef` (timer canceller), `chatBodyRef` (auto-scroll target),
    `phoneRef` (IO target), `playedRef` (one-shot guard).
- **Data source per region:** 100% from props. The conversation is the `script`
  / `scriptEs` `Bubble[]` arrays; the quote card from `quote` / `quoteEs`
  `QuoteCopy`; the input-bar placeholder from `messageCopy` / `messageCopyEs`.
  The quote-card line **amounts** are NOT from props — `QuoteCard` pulls them
  from i18n (`tFor(lang,"phoneChat.quote.amount1..3/Total")`) while the line
  **labels** come from the `QuoteCopy` prop. Status-bar time, "online", PDF
  badge, and brand name also come from `tFor(lang, …)`.
- **Honest-empty:** N/A — content is always provided by the route's hardcoded
  demo scripts; there is no fetch and no empty state in production. (`reset()`
  produces an intentionally empty chat body for story mode only.)
- **Liveness:** none — purely local timers. No request/response, no polling, no
  websocket. The "Online • SMS" header is decorative.
- **Reveal timing (mirrors legacy `LandingScripts.startReveal`):** each step's
  delay accrues `+350ms` if it's a `typing` step, else `+200ms` for the first
  step or `+700ms` for the rest; a `typing` step then adds a further `+1100ms`
  linger before the next step. On reaching a non-typing step preceded by a
  typing step, that prior typing index is added to `hidden`.
- **Anti-pattern check:** NONE of the page-island/`location.reload()` family —
  PhoneChat takes serializable props, owns only ephemeral animation state, never
  reloads or refetches. Clean island. (The one smell is dual-source quote data:
  labels from props, amounts from i18n — easy to desync; see hazards.)
- **Cross-file note (DEAD on this page):** `static/landing-scripts.js` still
  contains a `renderChat()/startReveal()/resetReveal()/chatIo()` port that
  targets `#chat-body`, `.chat-step`, `#chat-fill`. The landing route renders
  **no** `#chat-body` (PhoneChat uses `class="chat-body"`, no id), so those JS
  functions early-return — the island fully owns the demo. `chatIo()` does find
  the island's `.phone` and calls `startReveal()`, which then no-ops on the
  missing `#chat-body`. Treat that JS block as dead relative to this page.
- **Data-shape hazards:**
  - `usesLangSignal = !!scriptEs`. If `scriptEs` is omitted, the `langSignal`
    subscription is skipped and the phone is frozen in `langProp`.
  - `QuoteCard` amounts come from i18n, not the `QuoteCopy` prop — changing the
    prop labels without updating the i18n amounts silently desyncs the card.
  - `shown` defaults to `activeScript.length`; if a case wants the animation
    visible it must drive `autoPlayOnView` or story controls, not just mount.

## 2. Anatomy
```
<>
  {controls && <div [inline-styled toolbar]>            ← story mode only
     <button ▶ play> <button ⟲ reset> <button ⏭ end></div>}
  <div class="phone-wrap">
    <div class="phone-bg" />                             ← radial glow
    <div class="phone" ref=phoneRef>                     ← IO target (threshold .4)
      <div class="phone-screen">
        <div class="phone-status"><span>{time}</span><div class="icons">×4</div></div>
        <div class="chat-header">
          <div class="av-pm"><img /logo-monster.png></div>
          <div class="meta"><strong>{brand}</strong><span>{online}</span></div>
        </div>
        <div class="chat-body" ref=chatBodyRef>          ← auto-scroll to bottom
          activeScript.slice(0,shown).map → <div class="chat-step {left|right} in"
              style="animation:bubble-in 360ms …; [display:none if hidden]">
            typing → <div class="typing"><span>×3</div>
            bubble → <div class="bubble {me|them}" style={m.style}>{m.text}</div>
            meta   → <div class="bubble-meta">{m.text}</div>
            quote  → <QuoteCard q=activeQuote lang>
        </div>
        <div class="chat-input"><div class="field">{inputCopy}</div>
             <div class="send"><svg send-arrow/></div></div>
      </div>
    </div>
  </div>
</>
```
- **QuoteCard sub-component:** `.quote-card > .qc-head(span + .pdf) + .row×3 +
  .total`. Labels from `q`, amounts + PDF badge from `tFor(lang,…)`.
- **Slots/children:** none.

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `script` | `Bubble[]` | — (required) | (json) | no |
| `scriptEs` | `Bubble[]` | `undefined` | (json) | enables langSignal sub |
| `quote` | `QuoteCopy` | — (required) | (json) | no |
| `quoteEs` | `QuoteCopy` | `undefined` | (json) | no |
| `messageCopy` | string | `tFor("en","phoneChat.input.message")` | text | no |
| `messageCopyEs` | string | `tFor("es","phoneChat.input.message")` | text | no |
| `lang` | `"en"\|"es"` | `"en"` | select | (used only when no scriptEs) |
| `controls` | boolean | `false` | boolean | no |
| `autoPlayOnView` | boolean | `false` | boolean | no |

`Bubble = { side:"left"|"right"; kind:"bubble"|"meta"|"quote"|"typing";
cls?:"me"|"them"; text?:string; style?:string }`.
`QuoteCopy = { hd; l1; l2; l3; total }` (all string).

## 4. States → cases
| state | meaning | case |
|---|---|---|
| end-state | default mount: all steps shown, no controls (landing's static end frame before IO) | `cases/end-state/end-state.json` |
| playing | mid-animation, a `typing` step visible (`_signals.shown` partway) | `cases/playing/playing.json` |
| reset-empty | story `reset()` — empty chat body (`shown:0`) | `cases/reset-empty/reset-empty.json` |
| es | Spanish script + quote active (`langSignal="es"`) | `cases/es/es.json` |
| story-controls | `controls=true` → Play/Reset/End toolbar above phone | `cases/story-controls/story-controls.json` |

Animation state (`shown`/`hidden`/`lang`) is internal `useState`; cases express
it via `_signals` for the harness to seed, plus real prop arrays from the route.

## 5. Events
- `ev.expect(e => e.source==="button" && e.text.includes("play") && e.type==="click")`
  → `play()` (story toolbar). Resets to 0 then schedules the reveal timers.
- `ev.expect(e => e.source==="button" && e.text.includes("reset") && e.type==="click")`
  → `reset()` → `shown=0`, `hidden={}`.
- `ev.expect(e => e.source==="button" && e.text.includes("endState") && e.type==="click")`
  → `showAll()` → `shown=activeScript.length`.
- External (received): `langSignal.subscribe` → `setLang(next)`; if
  `autoPlayOnView && played`, replays in the new language one frame later.
- External (received): `IntersectionObserver` on `.phone` (threshold 0.4) →
  first intersection with `autoPlayOnView` calls `play()` once (`playedRef`).
- No DOM click handlers on the phone itself; the send button + input are inert
  decoration (no onClick).

## 6. Motion (extracted)
- **Bubble entrance — `bubble-in`** (`from{opacity:0;translateY(14px) scale(.96)}
  to{opacity:1;translateY(0) scale(1)}`): applied INLINE per step as
  `animation: bubble-in 360ms cubic-bezier(0.34,1.4,0.64,1) both`. Runs on mount
  because each step is fresh-rendered with `.in` already set — so the `.chat-step`
  CSS transition (320ms opacity / 360ms bounce transform) never fires for the
  island. **Jank finding:** animating `transform`+`opacity` is compositor-friendly
  (fine); but the auto-scroll `el.scrollTo({behavior:"smooth"})` on every
  `shown`/`hidden` change can fight the entrance tween on slow devices. Fix:
  gate the smooth-scroll to the last step or use `scrollTop = scrollHeight`
  (instant) during rapid reveals.
- **Typing dots — `typingBounce`** 1.2s ease-in-out infinite, three spans with
  0/0.2/0.4s `animation-delay`: `30%{translateY(-4px);opacity:1}` else
  `translateY(0);opacity:.5`.
- **Reveal cadence:** JS timers (350ms typing / 200ms first / 700ms others /
  +1100ms typing linger). Trigger: IO entry (landing) or Play button (story).
- **Reduced motion:** landing.css global clamp (`*{animation/transition-duration:
  0.01ms!important}`) flattens bubble-in + typingBounce. The JS reveal timers
  still run (content appears, just without tweens).

## 7. Responsive (this component's own widths)
- The component has **no `@media` of its own** — the `.phone` is a fixed
  `320px × 580px` mockup. The PAGE drops the whole hero/demo visual differently:
  the landing `.demo-grid` (see landing.css `@media (max-width:980px)`) stacks
  the copy above the phone on tablet/mobile. Capture at desktop + ≤980px to see
  the stack, but the phone itself never reflows.

## 8. A11y
- `.phone-wrap` carries no role; on the landing route the parent demo visual is
  decorative narrative. The status-bar dots, send button, and "Online" are not
  labeled (acceptable — decorative). 
- **Gaps:** the auto-playing animation has no pause control on the landing
  surface (only story mode gets buttons); the conversation text is real DOM so
  SR users can read it, but there's no `aria-live` announcing each new bubble —
  for a demo this is acceptable. The send `<svg>` has no title (decorative, ok).
- Reduced motion respected via the global clamp (content still revealed).

## 9. Used on
- **Landing `/`** (`routes/index.tsx` line 751) — the `.demo` section, with
  `script/scriptEs/quote/quoteEs`, `messageCopy="Message"`, `autoPlayOnView`.
- **`/stories/demo-phone-chat`** design playground — `controls` toolbar mode
  (per the file's own docblock; the stories route is outside this spec's scope).
- Page-local to landing (NOT a shared component). The dead islands
  `DemoPhoneChat.tsx` + `HeroRotor.tsx` reference the same look but are unmounted.
