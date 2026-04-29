# Phone preview (`.phone__*` + `.phero__* / .pkpi__* / .pcard / .pjob__* / .ptab__*`)

## What
A device-shaped 380×760 mockup of the mobile companion app, sticky-positioned on the right side of the dashboard "stage" so contractors can see what the on-the-go view looks like.

The phone is dark (`#1a1a1a` chassis with a soft inner highlight + warm coffee-tinted drop shadow), with a 36px-radius mint screen, status bar, top greeting, scrollable content, and a glass tab bar pinned at the bottom. A home indicator sits below the screen edge.

## Anatomy (top → bottom)

| Block | Purpose |
|---|---|
| `.phone__notch` | iOS-style hardware notch — pure decoration. |
| `.phone__status` | "9:41" + signal/wifi/battery icons. |
| `.phone__top` | Avatar + greeting + bell button (`.phone__bell-dot` for unread badge). |
| `.phone__scroll` | Content stack: hero (`.phero`), KPI grid (`.pkpis`), money-owed and quotes-waiting sections (each is a `.pcard` of `.pjob` rows). |
| `.ptabs` | Pinned tab bar; `.ptab` is a normal tab, `.ptab--text` is the elevated pink "text us" FAB. |
| `.home-indicator` | Bottom horizontal bar matching iOS home indicator. |

## Inner sub-components

- `.phero` / `.phero__title` / `.phero__sub` / `.phero__win-chip` / `.phero__cta` — pink-glow hero card the user sees on launch.
- `.pkpis` / `.pkpi__label` / `.pkpi__val` / `.pkpi__sub` — 2×2 metric grid scaled down for mobile.
- `.psection-head` / `.psection-title` / `.psection-link` — section header inside scroll.
- `.pcard` — light wrapper around grouped `.pjob` rows.
- `.pjob__title` / `.pjob__meta` / `.pjob__amt` — single line item (overdue invoice, quote waiting, etc.).

## Behavior
- The whole phone uses `position: sticky; top: 28px;` so it parks while the parent column scrolls. Below 1280px viewport, it switches to `position: static` and centers in the column.
- `.phone__scroll` is `overflow-y: auto` with `padding-bottom: 110px` to clear the bottom tab bar.

## Animations
None on the phone shell. The `.ptab--text` FAB has a static elevated shadow (no pulse).

## Source
`pages/dashboard/raw.html` lines 1448–1725 (CSS), 2621–2748 (markup).
