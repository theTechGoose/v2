# Capture checklist — PublicInvoiceClaim

- **Route:** `/i/<invoiceId>` (PUBLIC, auth-free, needs a real **unpaid,
  unclaimed** invoice — paid/claimed invoices render ReceivedNote/ClaimedNote
  instead and the island doesn't mount).
- **Surface:** inline-styled **public palette**.
- **Viewports:** 390 (mobile-first — primary), 640. Single column.
- **Crop targets:** the payment-method chip row (`acceptedMethods`), the
  reference/handle field, the claim button, the post-claim "thanks" swap.
- **States to drive:**
  - `methods` — chips for the contractor's enabled manual methods (Zelle /
    CashApp / check / cash / venmo / paypal / ach / other).
  - `selected` — a method chosen + optional reference entered.
  - `claiming` — submitting (`POST /api/invoices/:id/claim-payment`).
  - `claimed` — in-memory thanks state (no reload — good pattern).
  - `es` — Spanish.
- **MANUAL-ONLY** — no card processing; this records a claim against
  `Invoice.paymentIntent` for the contractor to confirm.
- **Theme:** light only. **No fabricated screenshots** — needs a live backend + valid token.
