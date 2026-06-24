# Capture checklist — Public Quote page (`/q/:id`)

**Theme:** light only (no dark variant on the public surface).
**Auth:** NONE. These are auth-free customer links — the `<id>` in the URL is the
only credential. You CANNOT fabricate screenshots: a real (or seeded) quote +
valid public id is required from the running backend.
**Palette:** public surface (warm paper `#f7f6f1`, NOT Sabor).

## Route / URL
- `http://localhost:5280/q/<quoteId>` — a real quote id whose backend
  `/quotes/:id/public` returns 200.
- To exercise expired-link: any id the backend 404s/410s on → `ErrorCard`.

## Viewports
- **~390px** (mobile-first — primary; this is how customers open SMS links).
- **640px** (the `max-width:640px` column cap — verify the card stops growing).

## Crops to capture
1. **Full document** — brand header → QuoteCard → estimated-total band →
   actions island → contact footer → powered-by.
2. **QuoteCard header** — eyebrow + hero title + `#id8` + (when settled) the
   status pill.
3. **Line-item table** — only present when the quote has **>1** line item; if the
   seed quote is single-line, the table is intentionally absent (capture that
   too, as the "single-line, no table" variant).
4. **Estimated-total band** — green gradient pill with big numeral.

## States to drive (need distinct backend records or status overrides)
1. **valid-pending** — `status` not accepted/lost → actions island visible.
2. **accepted** — `status==="accepted"` → green "Accepted" pill, NO actions.
3. **declined** — `status==="lost"` → `#a83b3b` "Declined" pill, NO actions.
4. **expired-link** — bad/expired id → `ErrorCard` ("This quote link expired or
   was revoked.").
5. **es** — a quote whose `contractor.commsLanguage==="es"` → entire page in
   Spanish (eyebrow "Cotización", "Total estimado", greeting "Hola …").
6. **with-logo** — `contractor.hasLogo` true → logo `<img>` above the eyebrow.
7. **multi-line + qty column** — quote with a line whose `quantity>1` → the `Qty`
   column appears.

## Transient (island) states — see component checklists
Accept confirm, decline form + declined card, ask form + sent card, and their
error states are captured in:
- `components/public-quote-actions/screenshots/capture-checklist.md`
- `components/public-accept-quote/screenshots/capture-checklist.md`

## Motion
No page-level CSS animation (inline styles, no keyframes). The only motion is the
islands' button hover/disabled state changes (instant) — nothing to film here.
