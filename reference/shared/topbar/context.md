# Topbar (`.topbar__*`)

## What
60px sticky header bar across every dashboard page. Frosted-glass background (white 50% + `backdrop-filter: blur(10px)`) with a 1px coffee-tinted bottom border.

## Where
Direct child of `.main` column, sits above `.content`. Always paired with the sidebar.

## Layout (left → right)
1. `.topbar__menu` — hamburger button that toggles the sidebar collapsed state.
2. `.topbar__greet` — two-line label: `Tuesday · April 28` over `Hey, Diego 👋`.
3. `.topbar__search` — flex-1 pill input with leading search icon and trailing `⌘K` chip.
4. `.topbar__btn` — circular bell button with pink notification dot (`.topbar__btn-dot`).

## Optional inserts
- `.topbar__ticker` — live-activity ticker pill, sometimes rendered between menu and greeting. See `shared/ticker/`.
- `.topbar__btn-pill` — wider pill variant that holds an icon + label.

## States
- `.topbar__menu:hover` — white bg + translateY(-1px).
- `.topbar__menu:active` — translateY(0) (resets the lift).
- The bell button has no hover style defined in the source.

## Interactions
- The menu button calls a parent `onToggle()` to flip the `.sb--collapsed` class on the sidebar.
- Search is a plain `<input>` — no autocomplete wired in the static export.
- ⌘K placeholder hints at a command palette but no handler is bound.

## Files
- `snippet.html`, `styles.css`, `animations.md`, `context.md`.

## Source
`pages/dashboard/raw.html` lines 587–602, 697–775 (CSS) and 2373–2392 (markup).
