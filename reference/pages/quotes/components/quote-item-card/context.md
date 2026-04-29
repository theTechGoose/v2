# Quote item card (`.qcard__*`)

## What
The flip card representing a quote in the pipeline. Front = mood band + avatar + body + footer with stage-specific CTA. Back = open-timeline + AI-derived reading + action buttons. Same structural pattern as `pages/contracts/components/contract-card/` (`.kcard__*`) but tuned for quotes (engagement dots, "opens" counter, stage-specific CTA copy).

## Theming via CSS variables
From `moodForQuote(q)`:

| Stage | from → to | Status fg |
|---|---|---|
| `opened` (≥3 opens) | green-300 → green-600 | green-700 |
| `opened` (1–2) | teal-300 → teal-600 | teal-700 |
| `sent` | coffee-300 → coffee-600 | coffee-700 |
| `cooling` | pink-300 → pink-600 | pink-700 |
| `stale` | pink-500 → red-700 | red-800 |
| `won` | green-500 → green-700 | green-800 |
| `lost` | gray-300 → gray-500 | gray-700 |
| `draft` | mint-300 → coffee-300 | coffee-700 |

(Exact stops in `extracted/Paperwork Monsters Quotes.html` `moodForQuote` function.)

## Stage-specific CTAs
- `draft` → "Finish + send"
- `opened` (≥3) → "Send the offer"
- `opened` (<3) → "Friendly nudge"
- `cooling` → "Trim & re-send"
- `stale` → "Win it back"
- `sent` → "Set a reminder"
- `won`/`lost` → "Open quote"

## Anatomy

| Element | Role |
|---|---|
| `.qcard__mood` | Mood gradient band. |
| `.qcard__numeral` | Big offset sequence number. |
| `.qcard__status` + `.qcard__status-dot` | Glassy status pill (top-left); dot pulses (`pulse-dot`). |
| `.qcard__opens` | Engagement read-out: open dots + total count, top-right. |
| `.qcard__av` | Avatar straddling mood/body. |
| `.qcard__body` | client+id, title, story. |
| `.qcard__foot` | Stage-specific CTA + right-aligned amount. |
| `.qcard__back` | Slide-in detail with timeline + reading + actions. |
| `.qcard__topen` / `.qcard__topen-dot` / `.qcard__topen-when` / `.qcard__topen-dev` | One row per recorded open. |
| `.qcard__read` | Sentence-long reading derived from `readingFor(q, opens)`. |

## States & flow
- Click outer card → `setFlipped(true)`.
- Inside the back panel, every button calls `e.stopPropagation()` so they don't re-trigger the flip.
- The `qcard__back-close` button toggles back.

## Animations
- `pulse-dot` on `.qcard__status-dot`.
- `ccard-in` / `ccard2-editorial-in` keyframes are not directly wired to `.qcard` (those belong to client cards) — `.qcard` mounts statically.
- Hover lifts via box-shadow tinted by `--mood-shadow`.

## Source
`pages/quotes/raw.html` lines 1888–2235 (CSS), 5109–5210 (markup).
