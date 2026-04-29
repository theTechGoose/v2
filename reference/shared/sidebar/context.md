# Sidebar (`.sb__*`)

## What
Persistent left navigation rendered on every dashboard page. 216px expanded, 84px collapsed. Dark teal background with two layered radial gradients (green bottom-left, pink top-right) and a green-on-rotation logo tile.

## Where
First child of the dashboard layout, rendered before `topbar`. Absent on the landing page.

## Sections (top→bottom)
1. **Brand** — logo tile + product name
2. **My Assistant CTA** (`.sb__textus`) — pink primary action linking to `Paperwork Monsters Assistant.html`. Has hover lift (translateY -2px + brightness).
3. **Divider**
4. **Nav** (`.sb__nav`) — list of `.nav-item` buttons (icon + label + optional count badge). The active item gets a white pill background (`.nav-item--active`).
5. **Account label + Settings nav-item**
6. **Footer** (`.sb__footer`) — pink-gradient avatar, user name, business name, chevron cog button.

## States
- `.sb--collapsed` — width 84px, hides labels, brand-text, count badges, user-text, cog. Centers icons.
- `.nav-item:hover` — white 8% background.
- `.nav-item--active` — white 95% bg, teal text, soft shadow.
- `.sb__textus:hover` — translateY(-2px) + filter brightness.

## Interactions
- Width transition uses `var(--ease-bounce)` over 280ms — gives a slight overshoot on collapse/expand.
- The collapse toggle is driven by parent state (`collapsed` boolean → toggles `sb--collapsed` class).
- All nav-items are buttons (not anchors) in the JSX — wired to a setActive() handler that swaps page route.

## Animations
- Collapse/expand is a width transition (no @keyframes).
- Brand tile is statically rotated -4deg (no animation).

## Files
- `snippet.html` — JSX-derived HTML structure with `className` already converted.
- `styles.css` — full `.sb__*` + `.nav-item*` rule set.
- `context.md` — this file.

## Source
`pages/dashboard/raw.html` lines 347–585 (CSS), 2240–2288 (markup).
