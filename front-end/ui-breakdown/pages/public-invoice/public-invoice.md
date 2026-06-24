# Page: `/i/:id` — Public invoice

**Route:** `routes/i/[id].tsx` · **Source copied to:** `js/[id].tsx`. Island in
`components/public-invoice-claim/`.

## Purpose
Customer-facing invoice document opened from an SMS/email link. Shows amount
due, milestone context, prior payments, and (when unpaid) lets the customer
**claim a manual payment** (MANUAL-ONLY: Zelle / CashApp / check / cash / etc.
— no card processing). Claim → contractor confirms → paid.

## Classification & data flow
- **Page tier:** **SSR document** (`define.page` async) + one claim island. No
  auth — token-shaped `:id`.
- **Data (server):** `ssrBackendGet<InvoicePublic>('/invoices/:id/public')`. Rich
  composite (see `data-model.md` §1.7): `{ id, contractId?, customerId?, status?,
  amount?, dueDate?, issuedDate?, paidAt?, installmentIndex?, installmentTotal?,
  paymentIntent?{method,amount,reference?,claimedAt,claimedBy?}, contractor?{…,
  acceptedPaymentMethods?}, customer?{…}, jobDetails?{…ByLang}, siblings?[…],
  acceptedMethods?[{method,handle?}] }`. On `!ok` → `ErrorCard` (link expired).
- **Derived state (in `InvoiceDoc`):** `paid` (status==="paid" || paidAt),
  `claimed` (status==="claimed" && paymentIntent), `pastDue` (isPastDue(dueDate)),
  `es` (contractor.commsLanguage), `jobName` (…ByLang fallback chain),
  `milestoneLabel` (installmentIndex/Total → deposit/progress/final),
  `paidSoFar` (siblings that are paid).
- **Language:** `commsLanguage === "es"` → `es`, else `en`; `tFor(lang, …)`.
- **Money:** `fmtMoneyExact(amount)` from `lib/format.ts` (amount in **cents**).
- **Surface:** **public inline-styled palette** (NOT Sabor). Consts:
  `PINK #FF6B6B`, `PINK_DARK #d94e4e`, `TEAL #144852`, `GREEN #519843`,
  `INK #1c2c30`, `MUTED #6b7a7e`, `LINE #e3e8e6`, `BG #f7f6f1`. System font;
  `'Helvetica Neue'` for the hero + amount numerals. Loads `/landing.css` for resets.

## `<Head>`
`<title>{publicInvoice.docTitle}</title>` · `<link href="/landing.css">`.

## Layout / composition order
```
div (BG, min-h 100dvh, kb-inset padding)
  div max-width:680px
    err|!invoice → <ErrorCard message />  (brand eyebrow + white card)
    else → <InvoiceDoc invoice />:
      article (white, radius 24, pink-bordered, shadow)
        8px top bar  → linear-gradient(PINK → PINK_DARK)
        padding 32/36:
          header row (space-between, wrap):
            left: optional logo (/api/public-logo/invoice/:id), businessLabel
                  eyebrow (PINK_DARK), contractor.addressLine (MUTED)
            right: <StatusPill paid|claimed|pastDue|due es />  (Pill: paid=GREEN,
                   claimed=amber "awaiting confirmation", pastDue=red, due=pink)
          h1   jobName  (TEAL, 32px, 900, Helvetica Neue)
          milestoneLabel (when installments)  (MUTED)
          amount card (green gradient #e8f3e2→#dceadb):
            label  status.paid | publicInvoice.amountDue ;  dueOn/paidOn date
            value  fmtMoneyExact(amount)  (TEAL, 38px, tabular-nums)
          paidSoFar strip (when prior installments paid): green pills #idx · $amt
          ── one of:
             paid    → <ReceivedNote paidAt contractorFirst es />     (green)
             claimed → <ClaimedNote intent contractorFirst es />      (amber; method+reference)
             else    → <PublicInvoiceClaim invoiceId acceptedMethods customerName lang /> ← ISLAND
          contact footer (when phone/email): tel:/mailto: links (TEAL)
        powered-by footer: /logo.png + publicInvoice.poweredBy {id: first-8 upper}
```

## Components
| Component | Folder | Tier |
|---|---|---|
| `PublicInvoiceClaim` | `components/public-invoice-claim/` | island — customer picks a method + reference and claims payment → POST claim; transitions the doc to the "claimed/awaiting confirmation" state. MANUAL-ONLY. |

Route-level inline render functions documented as page-composition: `InvoiceDoc`,
`ErrorCard`, `StatusPill`, `Pill`, `ClaimedNote`, `ReceivedNote` (+ helpers
`milestoneTitle`, `methodFriendly`, `isPastDue`).

## Data-shape hazard
`/invoices/:id/public` fans out a deep join: invoice → contract → quote →
customer → contractor profile → accepted methods → **sibling installments**.
Every customer link-load triggers it — flag for denormalization/caching.

## Capture checklist (auth-free, needs valid token id)
- URL: `/i/<invoiceId>`. Viewports: 390 + 640 (single column, max-width 680).
- States: due, past-due, claimed (awaiting confirmation), paid (ReceivedNote),
  with-installments (paidSoFar strip + milestone label), expired/error, `es`.
- Light theme only.

## Build order
public palette primitives → `public-invoice-claim` island → this page.
