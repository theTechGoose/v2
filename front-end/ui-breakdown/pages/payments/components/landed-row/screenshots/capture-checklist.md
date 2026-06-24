# Capture checklist — LandedRow

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/payments` — rows sit in the `.qdone` two-up grid BELOW
  the recent PaymentCards, inside the **Just-landed** track. They only appear
  when there are payments older than 1 day that landed this month
  (`olderLanded.length > 0`). Child of the PaymentsPage island.

## Viewports (own `@media`, from quotes.css)
- **1280px** — `.qdone` is a 2-column grid (rows pair up).
- **1100px** — `.qdone` → 1 column (rows go full width). Shoot at ~1099px.
- **560px** — `.qdone__row` padding/gap tighten. Shoot at ~559px.

## Element(s) to crop
- A single `.qdone__row` (won badge + client + `method · when · invoiceRef`
  sub + amount).
- Crop the **sub-line** specifically to evidence it is **UNSTYLED**
  (`.qdone__body`/`.qdone__sub` have no CSS rule → it renders as plain inherited
  body text, not the small muted treatment).

## Transient states to drive
1. **default** — a seed with a check/ACH payment >1d old this month: standard
   row.
2. **long-name** — a customer with a very long name → confirm the `.qdone__title`
   ellipsis truncation.
3. **es** — Spanish UI language: method + relative when label localize.

## Interactions
- None — the row is not interactive. (Only the hover state below.)

## Motion to film
- **Hover** — hover the row: `border-color` → `--mint-300` + `translateX(2px)`
  slide over `--dur-fast var(--ease-out)`. Film one hover.
- Re-shoot the hover with `prefers-reduced-motion: reduce` (global clamp —
  verify the slide goes instant).

## Notes (bugs to evidence)
- The `method·when·invoiceRef` sub-line is **unstyled** — this is the headline
  finding for this row; the crop should show it reading as ordinary body text
  rather than the intended small muted `.qdone__client` line.
- The badge is always the green `--won` variant (a LandedRow is always a settled
  payment) — there is no lost/danger variant in use here.
