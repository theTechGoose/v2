# Capture checklist — NewInvoiceModal

**Theme:** light only.
**Auth:** dev master OTP `000000`.

## Route / URL
- `http://localhost:5280/invoices` → click the hero **New invoice** CTA
  (`button[data-cy=invoice-new]`) to open the overlay. The modal is
  `[data-cy=new-invoice-modal]` (the `<form>`), centered on a fixed scrim.

## Viewports (inline-styled — no `@media`)
- **1280px** — modal card `max-width:460px` centered; scrim covers the whole
  viewport with a 20px padding gutter.
- **375px** (mobile) — card is `width:100%` minus the 20px scrim gutter; verify
  it never overflows. (No breakpoint exists; it's fluid by construction.)

## Element(s) to crop
- The full overlay: scrim (`rgba(20,40,45,.45)`) + centered white card
  (radius 16, shadow `0 24px 64px rgba(20,72,82,.22)`).
- The card alone: h2 "New invoice" + intro + Client select + Amount + Due date +
  the right-aligned Cancel (ghost) / Create invoice (solid green) action row.

## Transient states to drive
1. **default** — open over the page; Client select shows real customers +
   "No client (add later)" + "+ New client"; Due date pre-filled to today+30d;
   Amount empty (placeholder "0.00").
2. **new-client** — pick "+ New client" → the sunken `rgba(0,0,0,.03)` panel
   reveals Name (autoFocus) / Phone / Email inputs.
3. **error** — submit with amount 0 (or empty due / new-client missing name) →
   the `role="alert"` line in `#a83b3b` ("Enter an amount greater than zero.").
4. **busy** — submit a valid form → all fields disabled, submit button reads
   "Creating…"; capture the frame before the success `location.reload()` (FLAG:
   success full-reloads the page, no toast/close).
5. **es** — set UI language to Spanish → localized title/intro/labels/buttons.

## Motion to film
- **None.** The modal pops in instantly on mount (no enter/exit transition in
  source) and vanishes on close/reload. Nothing to film; note the abrupt pop-in
  as a polish gap, not jank. Reduced-motion is moot.

## Notes
- Closing: click the scrim or Cancel (both blocked while `busy`). Escape does
  NOT close (a11y gap to flag). The card click is `stopPropagation`'d so inner
  clicks don't close it.
- 100% inline-styled (only `data-cy` hooks) — see css/new-invoice-modal.css for
  the extracted rule set. NO fabricated screenshots.
