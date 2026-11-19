/**
 * REQ-729 / REQ-966 — the /i pill now lives in shared/documents/invoice-status.ts
 * so the invoice PDF (backend) draws the same stamp; this path stays for its
 * existing importers.
 */
export * from "../../shared/documents/invoice-status.ts";
