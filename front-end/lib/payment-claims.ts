/**
 * REQ-281 (demo M34): customer payment claims as /payments attention items.
 *
 * A customer's "I paid by Zelle" from the public invoice page is not a
 * Payment row: it lives on the invoice (status "claimed" + paymentIntent)
 * until the contractor confirms it (confirm-payment records the Payment) or
 * rejects it (reject-claim reopens the invoice). /payments derives its
 * "Needs attention" track from these, so a waiting claim is never invisible.
 *
 * Pure — no I/O, no Preact — so jest can exercise it directly.
 */
import { docNumberOf } from "../../shared/documents/numbering.ts";

/** The page's closed method set (mirrors clients/payments.ts PaymentMethod). */
export type ClaimMethod =
  | "cash"
  | "check"
  | "ach"
  | "card"
  | "venmo"
  | "zelle"
  | "cashapp"
  | "paypal"
  | "other";

const METHODS: ReadonlySet<string> = new Set<ClaimMethod>([
  "cash",
  "check",
  "ach",
  "card",
  "venmo",
  "zelle",
  "cashapp",
  "paypal",
  "other",
]);

/** The slice of an Invoice this derivation reads. */
export interface ClaimableInvoice {
  id: string;
  number?: string;
  customerId?: string;
  amount?: number;
  status?: string;
  updatedAt?: string;
  paymentIntent?: {
    method: string;
    amount: number;
    reference?: string;
    claimedAt: string;
    claimedBy?: string;
  } | null;
}

export interface PaymentClaim {
  invoiceId: string;
  /** "INV-007", or "#ABCD1234" when the invoice predates numbering. */
  invoiceRef: string;
  client: string;
  initials: string;
  method: ClaimMethod;
  /** INTEGER CENTS — the amount the customer says they sent. */
  amount: number;
  reference?: string;
  claimedBy?: string;
  claimedAt: string;
  daysAgo: number;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || name.trim() === "—") return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const DAY_MS = 24 * 3600 * 1000;

/** Every invoice awaiting the contractor's confirm/reject, newest first. */
export function pendingClaims(
  invoices: readonly ClaimableInvoice[] | null | undefined,
  customerNames: ReadonlyMap<string, string>,
  now: Date,
): PaymentClaim[] {
  if (!Array.isArray(invoices)) return [];
  return invoices
    .filter((inv) => inv?.status === "claimed")
    .map((inv): PaymentClaim => {
      const intent = inv.paymentIntent ?? undefined;
      const client = (inv.customerId && customerNames.get(inv.customerId)) ||
        "—";
      const claimedAt = intent?.claimedAt ?? inv.updatedAt ?? now.toISOString();
      const t = new Date(claimedAt).getTime();
      const daysAgo = Number.isFinite(t)
        ? Math.max(0, Math.floor((now.getTime() - t) / DAY_MS))
        : 0;
      const method = intent && METHODS.has(intent.method)
        ? intent.method as ClaimMethod
        : "other";
      return {
        invoiceId: inv.id,
        invoiceRef: docNumberOf(inv),
        client,
        initials: initialsOf(client),
        method,
        amount: typeof intent?.amount === "number"
          ? intent.amount
          : (inv.amount ?? 0),
        ...(intent?.reference ? { reference: intent.reference } : {}),
        ...(intent?.claimedBy ? { claimedBy: intent.claimedBy } : {}),
        claimedAt,
        daysAgo,
      };
    })
    .sort((a, b) => b.claimedAt.localeCompare(a.claimedAt));
}
