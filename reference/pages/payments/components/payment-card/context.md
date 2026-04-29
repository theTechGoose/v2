# Payment card

## What
A flip card for a single payment. Same DOM structure as `pages/quotes/components/quote-item-card/` (selector `qcard__*`), but driven by payment-specific data:

- `moodForPayment(p)` produces gradient stops by status × method:
  - `landed` + `ach` → green
  - `landed` + `card` → teal
  - `landed` + `check` → coffee
  - `landed` + `cash` → pink
  - `transit` → muted teal/coffee
  - `attention` (declined or returned) → red/pink (urgency)

- Stage-specific CTA text:
  - `attention` (`declined`) → "Text Sara →" (or appropriate name)
  - `attention` (`returned`) → "Try again →"
  - `transit` → "View timeline"
  - `landed` → "View receipt"
  - else → "Open"

- Timeline rows on the back vary by method:
  - `ach` (landed): submitted → in transit → cleared
  - `card` (landed): authorized → captured
  - `check` (landed): mailed → received → deposited
  - `cash` (landed): received → logged
  - `transit` adds an "expected" terminal row
  - `attention` shows the failure step (declined/returned)

- One-line "reading" copy underneath the timeline summarizes the situation.

## Source
`pages/payments/raw.html` lines 5746+ (logic), reuses `pages/quotes/components/quote-item-card/styles.css` for visual style.

## Animations
Same as `quote-item-card/animations.md` — `pulse-dot` on the status dot, no card mount keyframe.
