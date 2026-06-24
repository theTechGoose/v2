# Ticker

An **animated number** — eases a value from `0` to its target with
`requestAnimationFrame` and renders the running figure as a bare text fragment.
A direct port of the prototype's `useTicker` + `<Ticker/>`. It is the money/KPI
count-up, embedded inside other components — it has no box, no class, no chrome
of its own.

> **Naming collision (read this first).** This `islands/Ticker.tsx` is the rAF
> number count-up. It is NOT the rotating headline marquee in the topbar — that
> is `DashTopbar`'s `.topbar__ticker` (a `setInterval`-driven rotating line with
> `tickerSlideIn`/`tickerPulse` keyframes, spec'd under
> `shared-components/dash-topbar/`). The scope line "rotating ticker line" maps
> to the topbar; the actual source file `Ticker.tsx` is this count-up. This spec
> covers the real source file. Do not conflate the two `tickerPulse` /
> `tickerSlideIn` keyframes (topbar) with this component — this component has NO
> CSS keyframes at all.

## 1. Classification & behavior
- **Bucket:** `island` (file lives in `islands/Ticker.tsx`). 30 lines.
- **Interaction tier:** `island` — **client-only animation state**, no
  interactivity, no server contact, no events.
- **Client state owned (`useState`):** `v: number` — the current eased value,
  starts at `0`, climbs to `value`.
- **Lifecycle:** a single `useEffect([value, duration])`. On mount (and whenever
  `value`/`duration` change) it captures `performance.now()`, then schedules a
  `requestAnimationFrame` loop. Each frame: `t = min((now-start)/duration, 1)`,
  eased by `1 - (1-t)^3` (ease-out-cubic), `setV(round(value*eased))`; loops
  until `t >= 1`. Cleanup `cancelAnimationFrame(raf)`.
- **Data source:** none — the target is the `value` prop, passed by the host
  (`Outstanding`'s `owed`, the dead `Hero`'s `thisMonthBilled`). It does not read
  `clients/*` or any cache.
- **Honest-empty:** `value={0}` renders `"0"` immediately (the loop sets
  `round(0*eased)=0` every frame). No special empty branch.
- **Server mutations / `location.reload()`:** N/A — none.
- **Liveness:** the **only timed animation on the dashboard body**. rAF, runs
  once per `value` change. Not polling (it's a finite ease, not a repeating
  interval).
- **Reactivity:** if the host re-renders with a new `value` (e.g. live data
  arrives after a refresh), the effect re-fires and the number **re-animates
  from 0** to the new target — a full count-up on every value change, not a
  delta-tween. FLAG: a data refresh that nudges `owed` by a dollar restarts the
  whole 0→N spin (visually loud). Fix: tween from the previous `v`, not from 0.
- **Data-shape hazards:** `value` must be a finite number; `NaN`/`Infinity` would
  propagate through `round(value*eased)` and render `"NaN"`. Hosts pass already
  cents→dollars-divided numbers (`pickKpis`), so this is not currently hit, but
  there is no guard.

## 2. Anatomy
```
<>{prefix}{v.toLocaleString("en-US")}</>
```
- A **Preact fragment** with two text nodes: the optional `prefix` and the
  comma-grouped current value. **No wrapper element, no class, no DOM box.**
- All visual styling is inherited from the host text container:
  - inside `Outstanding` → `.money__amt` (32px Nunito 800, `--brand-teal`); the
    host renders `$<Ticker value={owed}/>` so the `$` is the host's, not the
    ticker's `prefix`.
  - inside the dead `Hero` → `.hero__title em` (pink, non-italic), as
    `$<Ticker value={thisMonthBilled}/>`.
- **No icon / asset / child dependencies.**

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `value` | number (target) | — (required) | number | no |
| `prefix` | string | `""` | text | no |
| `duration` | number (ms) | `1400` | number | no |

(Note: at the live call sites the `$` is supplied by the *host* markup, not via
`prefix`. `prefix` is the generic API surface — exercise it in isolate.)

## 4. States → cases
Animation is internal; isolate models it by setting `value`/`prefix`/`duration`
as props and capturing the settled (end-of-ease) frame, plus a mid-flight frame.

| state | meaning | case |
|---|---|---|
| money | typical Outstanding owed (settled at `6420` → "6,420") | `cases/money/money.json` |
| zero | `value={0}` → renders "0" immediately | `cases/zero/zero.json` |
| prefixed | `prefix="$"` + large value (count-up filmstrip) | `cases/prefixed/prefixed.json` |

(For a filmstrip of the in-flight ease, drive the screenshots, not a case — the
intermediate `v` isn't a settable prop.)

## 5. Events
- **None.** No clicks, no inputs, no emitted custom events, no listeners. The
  component is non-interactive output.
- `ev.expect(...)` predicates: N/A — nothing for `capture(page)` to assert beyond
  the rendered text settling at `value.toLocaleString()`.

## 6. Motion (extracted)
- **JS rAF count-up**, NOT CSS. 0 → `value` over `duration` (default **1400ms**),
  eased `1 - (1-t)^3` (ease-out-cubic — fast start, gentle settle). One frame per
  rAF tick (~60fps); `setV` per frame.
- **No `@keyframes`, no CSS transition** of its own (see css/ticker.css — it is a
  documentation-only stub).
- **Jank finding:** `setV` on every animation frame triggers a Preact re-render
  per frame for ~1.4s. For a single small text node this is cheap, but if many
  Tickers mount at once (or the host subtree is heavy) the per-frame re-render
  cost adds up. Fix: write the value into a ref + `textContent` (or a signal)
  instead of `setState` to bypass the VDOM diff each frame.
- **Reduced-motion: NOT honored — a11y gap.** The rAF loop runs regardless of
  `prefers-reduced-motion: reduce`; there is no guard in the component and no CSS
  to clamp (the global tokens `@media` only clamps CSS animation/transition
  durations, which this has none of). A motion-sensitive user still sees the
  number spin. **Fix:** read `matchMedia("(prefers-reduced-motion: reduce)")` and
  set `v = value` instantly (skip the loop) when reduced motion is requested.

## 7. Responsive (own @media)
- **None.** The component has no layout and no media queries — it inherits size
  and wrapping from its host text container (`.money__amt` / `.hero__title em`).
  Responsive behavior is the host's (Outstanding restacks at 640px via
  dash-sections.css).

## 8. A11y
- Renders plain text — natively readable by screen readers.
- **GAP — no `aria-live`** on the ticker (the host `.money__amt` also has none):
  the number visibly changes for ~1.4s but the change isn't announced; an SR user
  hears whatever is read at focus time, which may be a mid-count value.
- **GAP — no reduced-motion guard** (see Motion): the count-up animation cannot
  be disabled by the OS preference.
- The `$` and `prefix` are decorative text, not labeled.

## 9. Used on
**`/dashboard`** only, embedded by `components/DashSections.tsx`:
- `Outstanding` → `$<Ticker value={owed}/>` inside `.money__amt` (live).
- `Hero` (DEAD export) → `$<Ticker value={thisMonthBilled}/>` inside
  `.hero__title em` (no importer renders Hero).
Imported as `import Ticker from "../islands/Ticker.tsx"`. Not used elsewhere;
the topbar's rotating line is a separate `DashTopbar` mechanism (see the warning
at the top).
