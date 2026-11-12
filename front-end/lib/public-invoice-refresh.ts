/**
 * REQ-321 (demo-loop cycle 1, issue M14) — the public invoice page (/i/:id)
 * re-reads its invoice while it is open.
 *
 * The page is SSR'd once; the claim island used to patch the badge in place
 * and never ask the server again, so the owner's later confirm-payment
 * (another session) never reached the customer's open tab — it stayed
 * "awaiting confirmation · paid $0.00" until a manual reload. Now the page
 * polls `GET /api/invoices/:id/public` through REQ-221's scheduler and, the
 * moment the server's state differs from what the page shows, reloads: the
 * SSR route already renders every state (paid / claimed / due), so a reload
 * is the one correct re-render.
 */
import { type PollEnv, startPoll } from "./poll.ts";

/** the invoice state a page can show — the badge's three states */
export type ShownState = "paid" | "claimed" | "open";

export interface ShownInvoice {
  status?: string;
  version?: number;
}

/** the public projection's fields this decision reads */
export interface PublicInvoiceLike {
  status?: string;
  paidAt?: string;
  version?: number;
  paymentIntent?: unknown;
}

function shownState(i: { status?: string; paidAt?: string }): ShownState {
  if (i.status === "paid" || i.paidAt) return "paid";
  if (i.status === "claimed") return "claimed";
  return "open";
}

/** true when the server's invoice is no longer in the state the page shows
 *  (badge state moved, or the document was republished as a new version) */
export function invoiceMoved(
  shown: ShownInvoice,
  fresh: PublicInvoiceLike,
): boolean {
  if (shownState(shown) !== shownState(fresh)) return true;
  if (
    typeof shown.version === "number" && typeof fresh.version === "number" &&
    shown.version !== fresh.version
  ) return true;
  return false;
}

export const INVOICE_REFRESH_MS = 10_000;

export interface InvoiceRefreshOptions {
  invoiceId: string;
  /** read at every tick — the island's own claim moves this baseline */
  shown: () => ShownInvoice;
  /** test seams; default to the browser's fetch + location.reload */
  fetchJson?: (url: string) => Promise<unknown>;
  reload?: () => void;
  ms?: number;
  env?: Partial<PollEnv>;
}

async function browserFetchJson(url: string): Promise<unknown> {
  const r = await fetch(url, {
    credentials: "include",
    headers: { accept: "application/json" },
  });
  if (!r.ok) throw new Error(String(r.status));
  return await r.json();
}

function browserReload() {
  try {
    globalThis.location.reload();
  } catch { /* SSR-safe */ }
}

/** start re-reading the invoice; returns the stop function */
export function startInvoiceRefresh(opts: InvoiceRefreshOptions): () => void {
  const fetchJson = opts.fetchJson ?? browserFetchJson;
  const reload = opts.reload ?? browserReload;
  const url = `/api/invoices/${opts.invoiceId}/public`;
  let stopped = false;
  const stop = startPoll(
    async () => {
      if (stopped) return;
      const fresh = await fetchJson(url);
      if (stopped || !fresh || typeof fresh !== "object") return;
      if (invoiceMoved(opts.shown(), fresh as PublicInvoiceLike)) {
        // one reload: stop first so a slow navigation never asks twice
        stopped = true;
        stop();
        reload();
      }
    },
    opts.ms ?? INVOICE_REFRESH_MS,
    { env: opts.env },
  );
  return () => {
    stopped = true;
    stop();
  };
}
