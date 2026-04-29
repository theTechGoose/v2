# Payment track (`.qtrack__*` reused)

## What
The same `.qtrack__*` collapsible section as on Quotes / Invoices / Contracts. Used 3× on Payments to group payments by status:

1. **Needs attention** — only renders if there is at least one `attention` payment.
2. **Just landed** — recent (≤1d) `<PaymentCard>` flip cards followed by a `.qdone` of `<LandedRow>` chips for older landed payments (>1d).
3. **In transit** — `defaultOpen={false}`.

## Differences from other pages
The "Just landed" track holds two child types side by side: rich flip cards for fresh wins and compact `.qdone__row` chips for the older runway. This is unique to Payments.

## Source
`pages/payments/raw.html` lines 6038–6060 (composition); CSS is shared with `pages/quotes/`.

## Animations
Same as `pages/quotes/components/quote-item-card/animations.md`.
