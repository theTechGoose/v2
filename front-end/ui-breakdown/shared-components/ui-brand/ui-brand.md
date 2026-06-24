# ui/Brand

Wordmark: a pink rounded "P" mark + the text "Paperwork Monster", linking to
`/dashboard`.

## 1. Classification & behavior
- **Bucket:** `static` (`components/ui/Brand.tsx` — pure presentational link).
- **Interaction tier:** `static`. It's an `<a href="/dashboard">` — navigation
  only, no state/events/fetch.
- **Data source / liveness / mutations:** none. **Anti-patterns:** none.
- **Data-shape hazards:**
  - The wordmark text "Paperwork Monster" is a **hard-coded literal** in the
    component — NOT i18n'd (unlike `DashSidebar`, which uses `brand.name`). If
    the rebuild wants localization, swap to `tFor(lang,"brand.name")`.
  - Styling depends on the page having loaded **verify.css** (only that file
    defines `.brand__mark`). On a landing.css-only surface the mark won't style
    (landing's `.brand` expects an `<img>`). See css/ hazard.

## 2. Anatomy
```
<a class="brand" href="/dashboard" [style="color:#fff" when inverse]>
  <span class="brand__mark">P</span>                       ← pink 32x32 rounded tile, white "P"
  <span [style="font-size:16px" when size==="sm"]>Paperwork Monster</span>
</a>
```
- **Slots/children:** none.

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `size` | `"sm"\|"md"` | `"md"` | select | no |
| `inverse` | boolean | `false` | boolean | no |

- `size="sm"` shrinks only the wordmark text to 16px (mark stays 32×32).
- `inverse=true` sets the link color to `#fff` (for dark backgrounds).

## 4. States → cases
| state | meaning | case |
|---|---|---|
| md | default size, normal color | `cases/md/md.json` |
| sm | small wordmark | `cases/sm/sm.json` |
| inverse | white text (dark bg) | `cases/inverse/inverse.json` |

## 5. Events
- None emitted. `ev` — navigation only on click (it's a link to `/dashboard`).

## 6. Motion
- None. (The wrapping surface may add hover styles, but the component declares no
  transitions/animation.) No reduced-motion concern.

## 7. Responsive
- No `@media`. Fixed sizes; `size="sm"` is the only size lever.

## 8. A11y
- Real `<a>` — focusable, keyboard-activatable. The "P" mark span has no
  `aria-hidden`; SR reads "P Paperwork Monster". Minor: add `aria-hidden="true"`
  to `.brand__mark` so the mark isn't announced as a stray letter. No explicit
  `aria-label` (link text suffices).

## 9. Used on
- **Only consumer:** `components/AppNav.tsx`. But **AppNav has zero imports**
  anywhere (orphaned). So `ui/Brand` is **transitively dead code** — present in
  the design system, reachable only through an unused component. Evidence: grep
  of `ui/Brand` (1 hit: AppNav) + grep of `AppNav` (0 hits). Flag for adoption or
  removal. (Authenticated pages render their brand via `DashSidebar`'s
  `.sb__brand`, not this primitive.)
