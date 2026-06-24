# Capture checklist — PublicQuoteActions

**Theme:** light only. **Palette:** public surface (inline hex, NOT Sabor).
**Auth:** NONE — driven on a real `/q/:id` page; no fabricated screenshots.

## Route / URL
- `http://localhost:5280/q/<quoteId>` for a quote whose `status` is NOT
  accepted/lost (otherwise the island isn't mounted). Crop the panel below the
  estimated-total band.
- For Spanish, use a quote whose `contractor.commsLanguage==="es"`.

## Viewports
- **~390px** (primary — secondary buttons must wrap correctly).
- **640px** (column cap).

## States to drive
1. **actions** — accept name field + the centered "Ask a question" / "Decline"
   button row.
2. **decline-form** — click Decline → reason chips (Price/Timing/Going
   elsewhere/Other), pick one (active chip = green border + tint + weight 800),
   note textarea, name input, red `#a83b3b` "Send decline" button.
3. **declined-card** — submit decline (real backend) → pink `#fdf2f2` card
   "Got it — thanks for letting them know"; confirm BOTH secondary buttons are
   gone and the accept form is replaced.
4. **ask-form** — click Ask a question → question textarea (required), contact
   input, name input, teal `#144852` "Send question" button (disabled until the
   question is non-empty — capture the disabled state).
5. **ask-sent** — submit a question → teal-tinted ✓ "Question sent" card.
6. **error** — drive an already-settled quote (or mock a 200 `{ok:false,
   reason:"already_accepted"}`) → inline red "Couldn't send — This quote has
   already been accepted." Confirm NO raw JSON leaks.
7. **es** — Spanish: "Rechazar esta cotización", chips "Precio/Tiempos/Elegí otra
   opción/Otro", "Enviar rechazo".

## Transient states
- Submit "Sending…" (`status==="submitting"`) — button label swap, opacity .7,
  cursor not-allowed.

## Motion
None. No CSS transitions/keyframes — state swaps are instant. Nothing to film.
