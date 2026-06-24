# MobileViewport

Behavior-only island. Renders `null`. Mounted **once globally** in
`routes/_app.tsx`. Mirrors the iOS visual viewport into CSS custom properties so
every page can stay clear of the on-screen keyboard.

## 1. Classification & behavior
- **Bucket:** `island` (`islands/MobileViewport.tsx`).
- **Interaction tier:** `client-only` (no DOM, no props, no server I/O). Pure
  side-effect island — a `useEffect` that subscribes to viewport events.
- **What it owns:** no React/Preact state. It writes/clears four `:root` CSS
  custom properties and listens to DOM/viewport events. On unmount it removes
  all four properties and detaches every listener.
- **Outputs (the contract):**
  - `--app-vh` = `visualViewport.height` **only while** the keyboard overlaps
    (`innerHeight - vv.height > 2`); otherwise the property is *removed* so
    consumers fall back to `100dvh` and follow the keyboard animation smoothly.
  - `--kb-inset` = `max(0, innerHeight - vv.height)` — full keyboard overlap;
    added as bottom scroll-room so trailing fields/buttons clear the keyboard.
  - `--vvh` = `vv.height` (always set) — for fixed shells sized to the visible band.
  - `--vvt` = `vv.offsetTop` (always set) — vertical offset of the visible band.
- **Events it binds:** `visualViewport` `resize` + `scroll` → `apply()`;
  `window` `resize` → `apply()` (Android, which resizes the layout viewport but
  may not fire `vv.resize`); `document` `focusin`/`focusout` to lift the focused
  field (and any trailing submit button in the same `form`/`[data-kbd-group]`)
  clear of the keyboard via repeated timed `scrollBy` nudges.
- **Liveness:** event-driven (request-response to viewport changes); no polling,
  no network. Desktop is a no-op (keyboard inset 0; `vv` may be absent → early
  return).
- **No anti-patterns** (no `location.reload`, no SSR-frozen props).
- **Data-shape hazards:** depends on `globalThis.visualViewport` (absent on very
  old engines → it bails). Uses a 2600ms "focus settle" window with staged
  re-corrections (`[60,250,500,800,1200,1800,2400]`ms) because the iOS keyboard
  + predictive-text bar settle in stages.

## 2. Anatomy
- No DOM. `return null`. Its "anatomy" is the CSS-variable contract above plus
  the focus-reveal scroll logic. No slots/children.
- Helper `scrollableAncestor(el)` walks up to the nearest real
  `overflow-y:auto|scroll` container (e.g. the chat thread `.chat__scroll`),
  returning `null` for plain body-scroll pages.

## 3. Props
None. (No props interface.)

| name | type | default | control | signal? |
|---|---|---|---|---|
| — | — | — | — | — |

## 4. States → cases
This island has no visual states; "states" are environment conditions. Cases
document the variable outputs the harness should assert against a mocked
`visualViewport`.
| state | meaning | case |
|---|---|---|
| desktop | no `visualViewport` overlap → `--app-vh` absent, `--kb-inset:0` | `cases/desktop/desktop.json` |
| keyboard-open | iOS keyboard overlaps → `--app-vh` set, `--kb-inset>0` | `cases/keyboard-open/keyboard-open.json` |

## 5. Events
- Not user-facing UI events. Predicate sketches against the side effects:
  - `ev.expect(e => e.source === "visualViewport" && e.type === "resize")` →
    recomputes `--app-vh`/`--kb-inset`/`--vvh`/`--vvt`.
  - `ev.expect(e => e.source === "document" && e.type === "focusin" && e.targetMatches("input,textarea,select,[contenteditable=true]"))`
    → schedules staged scroll corrections to reveal the field + trailing submit.
  - `ev.expect(e => e.source === "document" && e.type === "focusout")` → stops
    re-correcting (`activeCorrect=null`).

## 6. Motion
- No CSS animation of its own. It *enables* smooth shell resize by deferring to
  `100dvh` (removing `--app-vh`) when no keyboard is present, so the shell tracks
  the keyboard animation frame-for-frame instead of snapping at the end. Scroll
  corrections use `behavior:"auto"` (instant) deliberately. No reduced-motion
  handling needed (no animation).

## 7. Responsive
- Active only where `visualViewport` reports overlap — effectively mobile
  (iOS/Android) with a soft keyboard. Desktop = no-op. No breakpoints of its own;
  its consumers (`.app`, public doc pages, chat/login shells) gate on 640px etc.

## 8. A11y
- Improves accessibility indirectly: keeps focused inputs and their submit
  buttons visible above the keyboard (iOS native scroll-into-view is unreliable
  inside nested scroll containers). No roles/labels (no DOM).

## 9. Used on
**Global** — mounted once in `routes/_app.tsx` (`<MobileViewport />`), so it is
in effect on every page (app + auth + public). Evidence: import in
`routes/_app.tsx`. Single global instance; never page-local.
