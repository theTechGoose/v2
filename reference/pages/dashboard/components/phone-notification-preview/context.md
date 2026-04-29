# Phone notification preview (dashboard)

## What
The dashboard's specific instance of `shared/phone-preview`. The hero card inside the phone (`.phero`) shows a celebratory "2 quotes just got accepted" message instead of any notification chrome — so the dashboard variant is really a "win-state hero" rendered on a sticky phone.

## What's inside the phone
1. Status bar (9:41 + signal/wifi/battery).
2. `.phone__top` — DR avatar, "Tuesday / Hey, Diego 👋", bell with pink dot.
3. `.phero` win card:
   - `.phero__win-chip` — green pill "2 wins today" (with a star SVG).
   - `.phero__title` — `2 quotes just got accepted.` (last two words pink em).
   - `.phero__sub` — "Send a fresh one — text us the details and we'll handle it."
   - `.phero__cta` — green pill "My assistant" linking to `Paperwork Monsters Assistant.html`.
4. `.pkpis` 2×2 grid: Active jobs (7), Money owed ($6,420), Quotes out (4), This month ($18.4k).
5. Two `.pcard` sections: "Money owed to you" (3 pjob rows) + "Quotes waiting" (first 2 rows of QUOTES).
6. `.ptabs` bottom tab bar: Home (active), pink "Just text us" FAB, Invoices.

## Shared
See `shared/phone-preview/` for the full styling and structure of the phone shell, scroll, win card, KPI grid, section rows, and tab bar.

## Source
`pages/dashboard/raw.html` lines 2619–2750.
