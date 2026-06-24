# ui/Icon

Minimal stroke-only SVG icon set. Each icon is a 24×24 `viewBox`, rendered as a
`currentColor` stroke (`fill:none`, `stroke-width:1.7`, round caps/joins).

## 1. Classification & behavior
- **Bucket:** `static` (`components/ui/Icon.tsx` — pure presentational).
- **Interaction tier:** `static`. No state, no events, no fetch.
- **How it renders:** looks up `PATHS[name]` (a `Record<Name, JSX.Element>`) and
  wraps it in an `<svg>` with the fixed attributes documented in css/. `size`
  sets both width & height; `color` is inherited via `stroke="currentColor"`.
- **Data source / liveness / mutations:** none. **Anti-patterns:** none.
- **Data-shape hazards:**
  - `name` is a closed union of **16** values — passing anything else is a type
    error and `PATHS[name]` would be `undefined` (renders an empty svg).
  - This is a SEPARATE icon system from `lib/dash-icons.tsx` (`I`/`ICN`, ~50
    glyphs, `stroke-width:2`). Do not conflate; names don't all overlap.

## 2. Anatomy
```
<svg width={size} height={size} viewBox="0 0 24 24" fill="none"
     stroke="currentColor" stroke-width={1.7} stroke-linecap="round"
     stroke-linejoin="round" class={cls} {...rest}>
  {PATHS[name]}   ← one or more <path>/<circle>/<rect> per icon
</svg>
```
- **Slots/children:** none (glyph is selected by `name`).

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `name` | union (see options) | — (required) | select | no |
| `size` | number (px) | `18` | number | no |
| `class` | string | `""` | text | no |
| `...rest` | SVG attrs (`aria-hidden`, `style`, …) | — | passthrough | no |

**`name` select options (the full union, 16):**
`home`, `doc`, `file-text`, `receipt`, `chat`, `users`, `settings`, `bell`,
`search`, `send`, `mic`, `image`, `check`, `chevron-right`, `menu`, `logo`.

## 4. States → cases
No behavioral states — just glyph/size variants.
| state | meaning | case |
|---|---|---|
| default | `name="home"`, size 18 | `cases/default/default.json` |
| sized | larger `size` | `cases/sized/sized.json` |
| colored | inherits parent `color` | `cases/colored/colored.json` |
| all-glyphs | render the full set as a sheet | `cases/all-glyphs/all-glyphs.json` |

## 5. Events
- None emitted. (Consumers wrap it in a button and own the click.)

## 6. Motion
- None. Static SVG. No transitions/animation/reduced-motion concern (any motion
  is from a parent, e.g. a hover color transition on the wrapping button).

## 7. Responsive
- No `@media`. Scales only via the `size` prop; remains crisp at any size (vector).

## 8. A11y
- Decorative by default — no `role`/`aria-label`. Consumers should pass
  `aria-hidden="true"` (icon-only buttons) via `...rest` and label the parent
  control, OR add `role="img"` + `aria-label` when the icon conveys meaning
  standalone. `currentColor` keeps contrast tied to the surrounding text color.

## 9. Used on
- **Live consumer:** `islands/Composer.tsx` (the Assistant chat composer) — uses
  `name="image"`, `name="mic"`, `name="send"`.
- **Dead consumer:** `components/AppNav.tsx` (uses `home/doc/file-text/receipt/
  chat/users/settings`) — but **AppNav itself has zero imports** (orphaned), so
  those names are only referenced by dead code.
- Evidence: grep of `ui/Icon` import. Shared primitive; effectively used live
  only by Composer today.
