# ui/Button (Button + AnchorButton)

Design-system button primitive. Exports a `<button>` (`Button`) and an
`<a>` (`AnchorButton`) sharing the same variant/size class composition.

## 1. Classification & behavior
- **Bucket:** `static` (`components/ui/Button.tsx` — stateless presentational).
- **Interaction tier:** `static` (renders a plain element; behavior comes from
  the consumer's `onClick`/`href` spread via `...rest`). No island, no state.
- **Class composition:** `classes(variant, size, extra)` →
  `["btn", "btn-{variant}", size==="lg" ? "btn-lg" : "", extra].filter(Boolean).join(" ")`.
  So `<Button variant="outline" size="lg" class="w-full">` →
  `class="btn btn-outline btn-lg w-full"`.
- **Data source / liveness / mutations:** none. Pure prop → markup.
- **Anti-patterns:** none in the component. **But:** the styling is
  surface-dependent — `.btn-*` is defined differently on the auth/app surface
  (`verify.css`, canonical, all 3 variants) vs the marketing surface
  (`landing.css`, pink restyle, NO ghost). The component does not import its own
  CSS; it inherits whatever `.btn-*` the page loaded. See css/ for the hazard.
- **Data-shape hazards:** `Omit<…, "size" | "class">` — native `size`/`class` are
  overridden by the typed props; everything else (`onClick`, `disabled`,
  `type`, `href`, `target`, `aria-*`) passes through `...rest`. `disabled`
  styling only exists in the verify.css set (`.btn[disabled]`).

## 2. Anatomy
```
Button:       <button class="btn btn-{variant} [btn-lg] [extra]" {...rest}>{children}</button>
AnchorButton: <a      class="btn btn-{variant} [btn-lg] [extra]" {...rest}>{children}</a>
```
- **Slots/children:** `children` is the label (text + optional leading icon — the
  `.btn` rule sets `gap:8px` for an inline icon).

## 3. Props (both Button & AnchorButton)
| name | type | default | control | signal? |
|---|---|---|---|---|
| `variant` | `"primary"\|"outline"\|"ghost"` | `"primary"` | select | no |
| `size` | `"md"\|"lg"` | `"md"` | select | no |
| `class` | string | `undefined` | text | no |
| `children` | ComponentChildren | — | (slot) | no |
| `...rest` | button/anchor attrs (`onClick`, `href`, `disabled`, `type`, …) | — | (passthrough) | no |

## 4. States → cases
| state | meaning | case |
|---|---|---|
| primary | default solid (pink) | `cases/primary/primary.json` |
| outline | white + border | `cases/outline/outline.json` |
| ghost | transparent (verify.css only) | `cases/ghost/ghost.json` |
| lg | large size | `cases/lg/lg.json` |
| disabled | `disabled` attr (Button only) | `cases/disabled/disabled.json` |
| anchor | AnchorButton with href | `cases/anchor/anchor.json` |

## 5. Events
- Emits nothing itself. The consumer wires events:
  `ev.expect(e => e.source === "button.btn" && e.type === "click")` — only when
  the consumer passes `onClick`. `disabled` Button suppresses click.

## 6. Motion (extracted, canonical verify.css)
- `.btn` transitions `transform 120ms ease, background 200ms ease, color 200ms`.
- `.btn:active { transform: translateY(1px) }` — press nudge.
- Marketing (landing.css) variant differs: `transition: all 200ms
  var(--ease-bounce)`, hover `translateY(-1px)` + shadow growth, active
  `scale(.97)`.
- **Reduced motion:** none local; global tokens clamp covers it.

## 7. Responsive
- No `@media`. Size is fixed by `md`/`lg`; width follows content unless the
  consumer adds a width class via `class`.

## 8. A11y
- Renders a real `<button>` / `<a>` — native semantics, focusable, keyboard
  operable. `disabled` sets the native attribute (+ `.btn[disabled]` dims it).
- AnchorButton has no `role="button"` (it's a true link — correct when it
  navigates). Ensure consumers don't use AnchorButton for non-navigation
  actions. Focus ring inherited from global `--shadow-focus` token usage.

## 9. Used on
**CONFIRMED UNUSED.** Grep for `ui/Button` across `routes/`, `islands/`,
`components/` returns **zero imports**. This is a built-but-unwired design-system
primitive. (The app currently hand-writes `<button class="btn …">` / `<a>` and
uses the legacy `components/Button.tsx` only inside the Counter denostories
demo.) Spec'd as shared per the design-system intent; flag as dead code pending
adoption or removal.
