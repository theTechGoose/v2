# Job card row (`.job__*`)

## What
A single horizontal row representing an active in-flight job inside a panel (`.panel`). Used in the dashboard "Active jobs" panel and in similar panels on other dashboard pages.

## Layout
A 3-column grid: `44px` icon · `1fr` content · `auto` amount.

- **Icon** (`.job__icon`) — colored 44×44 tile holding an inline icon. Background passed inline (e.g. green/pink/coffee).
- **Content** — title row with optional status chip (`.job__chip` + `.chip--*`), meta line ("Re-roof — building C · Due Today" with a dot separator), and a thin progress bar (`.job__progress` / `.job__progress-bar`, 5px tall, mint track + colored fill).
- **Amount** (`.job__amount`) — Nunito 800 16px teal, right-aligned. `.job__amount-sub` shows paid/quoted state in 10px muted.

## Status chip palette (`.chip--*`)
- `green` — On track / paid
- `pink` — Hot / overdue
- `coffee` — Pending
- `teal` — Scheduled
- `warn` — Awaiting permit (peach background)

## Row separators
Dashed coffee 10% border at the bottom of every `.job`, removed on `:last-child`.

## Source
`pages/dashboard/raw.html` lines 1221–1318 (CSS), 2476–2497 (markup).

## Animations
None on the row itself. Icon, progress fill width, and amount are all set via inline `style` from data.
