# ui/SectionHead

Centered marketing section header: optional eyebrow pill + `<h2>` + optional lede
paragraph.

## 1. Classification & behavior
- **Bucket:** `static` (`components/ui/SectionHead.tsx` — pure presentational).
- **Interaction tier:** `static`. No state, events, fetch, or motion.
- **Data source / liveness / mutations:** none. **Anti-patterns:** none.
- **Conditional rendering:** `eyebrow` and `lede` are optional — each is rendered
  only when truthy (`eyebrow ? <span> : null`, `lede ? <p> : null`). `title` is
  required and always renders.
- **Data-shape hazards:**
  - `lede` is `ComponentChildren` (not just string) — it can carry inline markup
    (e.g. `<em>`, links). `title` is a plain `string`.
  - Styling depends on which surface CSS is loaded (verify.css vs landing.css —
    two visibly different looks; see css/). landing.css additionally renders a
    leading dot via `.eyebrow-pill::before` and supports an accent `<h2><em>`.

## 2. Anatomy
```
<div class="section-head">
  {eyebrow && <span class="eyebrow-pill">{eyebrow}</span>}   ← uppercase green pill
  <h2>{title}</h2>
  {lede && <p class="lede">{lede}</p>}                       ← muted 18px paragraph
</div>
```
- **Slots/children:** `lede` acts as a slot (ComponentChildren). No `children` prop.

## 3. Props
| name | type | default | control | signal? |
|---|---|---|---|---|
| `eyebrow` | string | `undefined` | text | no |
| `title` | string (required) | — | text | no |
| `lede` | ComponentChildren | `undefined` | text | no |

## 4. States → cases
| state | meaning | case |
|---|---|---|
| full | eyebrow + title + lede | `cases/full/full.json` |
| no-eyebrow | title + lede only | `cases/no-eyebrow/no-eyebrow.json` |
| title-only | just the h2 | `cases/title-only/title-only.json` |

## 5. Events
- None emitted (static, non-interactive).

## 6. Motion
- None in the component. (landing.css adds no animation either; the eyebrow dot
  is static.) No reduced-motion concern.

## 7. Responsive
- `.section-head` is `max-width:720px; margin:auto; text-align:center` — fluidly
  centered. On the landing.css variant the `<h2>` uses `clamp(32px,4.4vw,52px)`,
  so the heading scales with viewport width. No explicit `@media`.

## 8. A11y
- Emits a proper `<h2>` (consumers must ensure heading-level order on the page —
  it's hard-coded to h2, so it should sit under an h1). Eyebrow + lede are
  decorative/supporting. No interactive elements. No issues beyond heading-order
  discipline.

## 9. Used on
- **CONFIRMED UNUSED.** Grep for `ui/SectionHead` across the repo returns **zero
  imports**. A built-but-unwired marketing primitive (the landing page composes
  its section heads inline rather than via this component). Spec'd as shared per
  intent; flag as dead code pending adoption or removal.
