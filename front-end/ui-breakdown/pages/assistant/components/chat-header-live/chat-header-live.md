# ChatHeaderLive

The live chat header strip (title + live status chip + back/share/more tools)
above the message list. Renders the same `.chat__head` DOM the static SSR
`<ChatHeader/>` would, but subscribes to window events so AsstChat can update the
title and status string **in place** as a conversation forms — no reload.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/ChatHeaderLive.tsx`).
- **Interaction tier:** `island` (client-only state) — event-driven, no fetch.
- **Client state owned:**
  - `client: string` — header title; seeded from `initialClient` (SSR), then
    overwritten by `pm:asst-header` events.
  - `status: string` — sub-status text; seeded from `initialStatus`, then
    overwritten by `pm:asst-header`.
  - `historyDepth: number` — back-stack depth; driven by `pm:asst-history`. The
    back button renders only when `historyDepth > 0`.
  - `lang` — `langSignal.value` (the `lang` prop is an ignored SSR seed).
- **Data source:** none of its own. Title/status are **pushed** from the
  sibling `AsstChat` island via `globalThis` CustomEvents.
- **Liveness — window-event PUSH (not polling, not websocket):**
  - listens `pm:asst-header` → `{ client, status }` → `setClient`/`setStatus`
    (only when the string is non-empty, so it never blanks).
  - listens `pm:asst-history` → `{ depth }` → `setHistoryDepth`.
  - on back-button click it **dispatches** `pm:asst-back` (no detail); AsstChat
    pops its view-snapshot stack.
- **Honest-empty:** always renders title+status (seeds are non-empty t-strings
  like "New conversation" / "Assistant ready to help").
- **Anti-patterns:** none. No `location.reload()`, no polling, no frozen-prop
  hazard (the SSR seeds are intentionally superseded by live events).

## 2. Anatomy
```
<div class="chat__head">
  [historyDepth>0 → <a class="chat__head-btn" onClick=dispatch pm:asst-back><I back/></a>]
  <div class="chat__head-info">
    <div class="chat__head-title">{client}</div>
    <div class="chat__head-sub"><span class="chat__head-dot"/>{status}</div>   ← dot pulses (tickerPulse)
  </div>
  <div class="chat__head-tools">
    <button class="chat__head-btn" title=shareThread><I send/></button>
    <button class="chat__head-btn" title=more><I more/></button>
  </div>
</div>
```
- **Icon dependency:** `I` + `ICN.back`/`ICN.send`/`ICN.more` from
  `lib/dash-icons.tsx` (copied to `js/dash-icons.tsx`).
- Share/more buttons are **inert** (title-only, no onClick) — placeholder tools.

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `initialClient` | string (required) | — | text | no — SSR seed, overwritten by `pm:asst-header` |
| `initialStatus` | string (required) | — | text | no — SSR seed, overwritten by `pm:asst-header` |
| `lang` | `"en"\|"es"` | (ignored) | select | **ignored SSR seed** — reads `langSignal.value` |

## 4. States → cases
| state | meaning | case |
|---|---|---|
| new | empty thread seed ("New conversation" / help line) | `cases/new/new.json` |
| named | a customer-bound thread (title=name, phase status) | `cases/named/named.json` |
| with-back | history depth > 0 → back button visible | `cases/with-back/with-back.json` |

> Isolate note: drive the live updates via `_signals` (`client`, `status`,
> `historyDepth`) since the real values arrive over `pm:asst-header` /
> `pm:asst-history` from AsstChat, which isn't mounted in isolation. Back-button
> click → assert the `pm:asst-back` dispatch in Events.

## 5. Events
- `ev.expect(e => e.source === "a.chat__head-btn" && e.type === "click")` (the
  back anchor, only present when `historyDepth>0`) → `e.preventDefault()` +
  dispatches `pm:asst-back`.
- Incoming (not user events): `pm:asst-header`, `pm:asst-history` from AsstChat.

## 6. Motion (extracted)
- **Live dot:** `.chat__head-dot` runs `@keyframes tickerPulse`
  (`box-shadow 0 0 0 0 → 0 0 0 6px → 0`, green, fading) `1.6s ease-in-out
  infinite`. Shared keyframe (also used by the topbar ticker / chat header).
- **Tool buttons:** `transition: all 160ms` (color + border on hover).
- **Reduced motion:** no component-local guard — relies on the global tokens
  reduced-motion clamp.

## 7. Responsive
- No own `@media`. It's a flex row inside the `.chat` column; `.chat__head-info`
  is `min-width:0` so the title ellipsizes. Verify within the page's
  assistant-page.css `.asst` grid breakpoints.

## 8. A11y
- Back/share/more are real `<button>`/`<a>` with `title` text (no
  `aria-label`); the back anchor is `href="#"` + `preventDefault` (rebuild fix:
  prefer a `<button>`).
- The live status has no `aria-live` — title/status changes are silent to AT.
  Rebuild fix: wrap `.chat__head-sub` in `aria-live="polite"`.

## 9. Used on
Both assistant route variants. On `index.tsx` seeded with
`assistantPage.newConversation` / `assistantPage.assistantHelp`; on
`[threadId].tsx` seeded with the resolved customer/title + phase-prefixed status.
CSS in `static/assistant-page.css` (`.chat__head*`).
