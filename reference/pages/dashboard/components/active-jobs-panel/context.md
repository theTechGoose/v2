# Active jobs panel (dashboard)

## What
The wider panel in the first `.grid` row. Lists 5 in-flight contractor jobs with progress bars.

## Composition
- `shared/panel/` shell with title "Active jobs" + green count pill "7 active" + "See all →" action.
- A pulsing green dot (`.hero__pill-dot`) rendered in the header for emphasis.
- Body: 5 `shared/job-card` (`.job__*`) rows, separated by dashed coffee dividers.

## Data (from JOBS array)
| Client | Task | Amount | Paid | % | Due | Icon | Color | Status |
|---|---|---|---|---|---|---|---|---|
| Maple Grove Apartments | Re-roof — building C | $4,800 | $2,400 paid | 50 | Today | hardhat | green | green: On track |
| Sarah Chen | Bathroom remodel | $8,200 | $3,000 paid | 36 | Wed | wrench | pink | green: Crew onsite |
| Marshall & Sons | Driveway repour | $2,950 | Deposit | 18 | Fri | truck | coffee | warn: Awaiting permit |
| Jana Patel | Interior paint · 2BR | $1,650 | Quoted | 0 | Mon Apr 29 | paint | pink | teal: Scheduled |
| Cobblestone Cafe | Patio re-tile | $3,400 | $1,000 paid | 30 | Apr 30 | ruler | green | green: On track |

`color` is used for both the icon tile background and the progress-bar fill (see `shared/job-card`).

## Source
`pages/dashboard/raw.html` lines 2457–2499.
