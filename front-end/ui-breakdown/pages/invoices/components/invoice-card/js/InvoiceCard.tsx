/* SOURCE POINTER — the full verbatim source for InvoiceCard (and its
 * STAGE_MOOD / ChangeOrderRow / CO_CHIP_COLOR helpers) is too large to
 * usefully duplicate here. It lives, copied verbatim, in:
 *
 *   ../../invoices-page/js/InvoicesPage.tsx
 *     · STAGE_MOOD         lines 206–259
 *     · ChangeOrderRow     lines 807–813
 *     · CO_CHIP_COLOR      lines 815–819
 *     · function InvoiceCard(...)  lines 821–1409
 *     · methodLabel / fmtDate / initialsOf / enrich / EnrichedInvoice
 *       (used by the card) lines 63–204
 *
 * This component is a CLIENT-ONLY flip card with a full mutation surface
 * (confirm-received / reject-claim / send / finish-draft / mute / discount /
 * change-order). Every mutation calls a fetch then `globalThis.location
 * .reload()` — see invoice-card.md §1 for the anti-pattern flag + fix. Read
 * the canonical file above for the exact JSX/handlers; do not re-author from
 * memory. */
// (Pointer only — no re-export. `InvoiceCard` is a non-exported local
//  function inside InvoicesPage.tsx; the island's default export is the page.)
export {};
