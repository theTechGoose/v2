# Skeletons

Shared loading-skeleton primitives. Static module exporting several shimmer
shapes used as the SSR'd first render by the per-page top-level islands (which
fetch on mount, so initial paint = loading).

## 1. Classification & behavior
- **Bucket:** `static` (`components/Skeletons.tsx` — pure presentational, no
  island, no state, no fetch).
- **Interaction tier:** `static` (renders identically on server and client; no
  events, no PRG, no signals).
- **Exports (5):**
  - `ShimmerStyle()` — renders a `<style>` injecting the `@keyframes pmShimmer`.
    Must be rendered once on any page that uses skeletons (the keyframe is not in
    a stylesheet).
  - `SkelBlock({ h, w?, r?, mt? })` — the atomic shimmer rectangle.
  - `PageHeaderSkeleton()` — title bar + subtitle (two stacked blocks).
  - `CardGridSkeleton({ rows? })` — two `.panel`s in a `.grid`, each a header
    block + `rows` row-blocks.
  - `ListSkeleton({ rows? })` — single `.panel`, header block + `rows` rows.
- **Data source:** none — purely shape-based. **Honest-empty:** N/A (it *is* the
  pre-data state; replaces the old literal "Loading X…" text to avoid the empty
  blink the audit flagged on cold-route navigations).
- **Liveness:** none. **Anti-patterns:** none.
- **Data-shape hazards:** the composite skeletons depend on the host page's
  `.grid`/`.panel` CSS existing (they reuse the real layout classes so the
  skeleton matches loaded content and avoids layout shift). The shimmer
  keyframe must be present (`<ShimmerStyle/>`), or blocks render as flat grey.

## 2. Anatomy
- `SkelBlock` → a single `<div>` with inline `height/width/border-radius/
  margin-top` + the shimmer gradient/animation.
- `PageHeaderSkeleton` → `<section>` with `SkelBlock h=32 w=60%` then
  `SkelBlock h=14 w=40% mt=12`.
- `CardGridSkeleton` → `<div class="grid">` containing two `<div class="panel">`,
  each with `SkelBlock h=20 w=40%` then `rows`×`SkelBlock h=56` (first `mt=18`,
  rest `mt=12`).
- `ListSkeleton` → `<div class="panel">` with `SkelBlock h=20 w=30%` then
  `rows`×`SkelBlock h=64` (first `mt=18`, rest `mt=12`).
- **Slots/children:** none.

## 3. Props
`SkelBlock`:
| name | type | default | control | signal? |
|---|---|---|---|---|
| `h` | number (px, required) | — | number | no |
| `w` | string (CSS width) | `"100%"` | text | no |
| `r` | number (px radius) | `8` | number | no |
| `mt` | number (px margin-top) | `0` | number | no |

`CardGridSkeleton` / `ListSkeleton`:
| name | type | default | control | signal? |
|---|---|---|---|---|
| `rows` | number | `4` (grid) / `5` (list) | number | no |

`PageHeaderSkeleton` / `ShimmerStyle`: no props.

## 4. States → cases
Each export is documented as its own variant/case (no behavioral states — these
are single-render shapes).
| variant | meaning | case |
|---|---|---|
| skel-block | the atomic block (`h=56`) | `cases/skel-block/skel-block.json` |
| page-header | title + subtitle header | `cases/page-header/page-header.json` |
| card-grid | two-column panel grid (used by Dashboard/Quotes/Clients/Contracts/Settings) | `cases/card-grid/card-grid.json` |
| list | single-column list (used by Payments/Invoices) | `cases/list/list.json` |

## 5. Events
- None. Static, non-interactive (`ev` — no emitted events).

## 6. Motion (extracted)
- **`pmShimmer`** keyframes: `background-position 200% 0 → -200% 0`, applied as
  `animation: pmShimmer 1.4s ease-in-out infinite` over a 3-stop horizontal
  linear-gradient (`#eef2ed → #f6f7f3 → #eef2ed`, `background-size:200% 100%`).
  Produces a left-to-right sheen.
  - **Jank finding:** animating `background-position` is cheap (compositor-ish,
    no layout) — fine. Many blocks animate in sync (shared keyframe) which reads
    as one coherent sweep.
- **Reduced motion:** NO component-local guard. Relies on the global tokens
  `@media (prefers-reduced-motion: reduce)` clamp. Fix candidate: add a local
  `prefers-reduced-motion` rule that sets `animation:none` and a static grey, so
  the skeleton doesn't depend on the global being loaded.

## 7. Responsive
- No own `@media`. Responsiveness comes from the borrowed `.grid` (collapses to
  one column at `<=640px` per dashboard.css) and `.panel` shells. `SkelBlock`
  widths are %-based so they fluidly scale.

## 8. A11y
- No `role="status"`/`aria-busy` or `aria-hidden` is set — the shimmer blocks are
  bare `<div>`s announced as nothing. Acceptable (decorative), but a rebuild
  could add `aria-hidden="true"` on the blocks and `aria-busy="true"` /
  `role="status"` on the container for SR users. No focusable elements.

## 9. Used on
Used by **7 page islands** as their loading state:
`islands/DashboardPage.tsx`, `QuotesPage.tsx`, `InvoicesPage.tsx`,
`PaymentsPage.tsx`, `ContractsPage.tsx`, `ClientsPage.tsx`, `SettingsPage.tsx`.
Evidence: grep of `Skeletons` import. Shared primitive (CardGridSkeleton on the
grid pages, ListSkeleton on Payments/Invoices).
