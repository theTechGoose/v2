/* SOURCE POINTER — the full verbatim source for NewInvoiceModal lives in:
 *
 *   ../../invoices-page/js/InvoicesPage.tsx
 *     · const NEW_SENTINEL          line 1413
 *     · function NewInvoiceModal()  lines 1418–1632
 *
 * A fully inline-styled modal (no class hooks beyond the form layout). On
 * submit it optionally creates a Customer (clientsClient.create) then a draft
 * Invoice (dashboardClient.createInvoice) and `globalThis.location.reload()`s
 * to surface the new draft in the Drafting track — see new-invoice-modal.md
 * §1 for the PRG/island-refresh flag + fix. Read the canonical file above for
 * the exact JSX/validation; do not re-author from memory. */
export {};
