/**
 * REQ-462 (demo-loop cycle 3, M26) — the quote panel's change-order actions,
 * on the endpoints the invoices page's "Adjust" already uses:
 *
 *  - POST   /invoices/:id/change-orders         → a pending order (the
 *    customer approves it at /co/:id, which applies the delta)
 *  - PUT    /invoices/:id/change-orders/:coId   → its next version, back to
 *    pending, the alert sent again (an approved order 409s)
 *  - DELETE /invoices/:id/change-orders/:coId   → withdrawn (an approved one 409s)
 */
import { api, type ApiOptions } from "../lib/api.ts";

export interface ChangeOrderBody {
  description: string;
  /** Signed INTEGER CENTS: + adds to the job, − is a credit. */
  deltaAmountCents: number;
}

export interface ChangeOrderRecord extends ChangeOrderBody {
  id: string;
  invoiceId: string;
  number?: string;
  version?: number;
  status: "pending" | "approved" | "declined";
}

export const changeOrdersClient = {
  create: (invoiceId: string, body: ChangeOrderBody, opts: ApiOptions = {}) =>
    api.post<ChangeOrderRecord>(
      `/invoices/${invoiceId}/change-orders`,
      body,
      opts,
    ),
  update: (
    invoiceId: string,
    changeOrderId: string,
    body: ChangeOrderBody,
    opts: ApiOptions = {},
  ) =>
    api.put<ChangeOrderRecord>(
      `/invoices/${invoiceId}/change-orders/${changeOrderId}`,
      body,
      opts,
    ),
  withdraw: (invoiceId: string, changeOrderId: string, opts: ApiOptions = {}) =>
    api.delete<{ ok: true }>(
      `/invoices/${invoiceId}/change-orders/${changeOrderId}`,
      opts,
    ),
};
