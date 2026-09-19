/**
 * HTTP client for the /payments page.
 *
 * Backend reference: paperwork/entrypoints/payment-controller/mod.ts
 *   GET /payments                      → Payment[]
 *   GET /payments?method=ach           → Payment[]
 *   GET /payments?invoiceId=<id>       → Payment[]
 *   GET /payments/:id                  → Payment
 *   POST /payments                     → Payment (REQ-018 contractor receipt)
 */
import { api, type ApiOptions } from "../lib/api.ts";

export type PaymentMethod =
  | "cash"
  | "check"
  | "ach"
  | "card"
  | "venmo"
  | "zelle"
  | "cashapp"
  | "paypal"
  | "other";

export interface Payment {
  id: string;
  userId: string;
  invoiceId: string;
  amount: number;
  method: PaymentMethod;
  receivedAt: string;
  reference?: string;
  createdAt: string;
  updatedAt: string;
}

export const paymentsClient = {
  list: (opts: ApiOptions = {}) => api.get<Payment[]>("/payments", opts),
  /** REQ-018 (NW-27): the contractor records a payment they received. The
   *  backend re-runs the balance and flips the invoice to paid at zero. */
  create: (
    body: {
      invoiceId: string;
      amount: number;
      method: PaymentMethod;
      receivedAt: string;
      reference?: string;
    },
    opts: ApiOptions = {},
  ) => api.post<Payment>("/payments", body, opts),
  byMethod: (method: PaymentMethod, opts: ApiOptions = {}) =>
    api.get<Payment[]>("/payments", { ...opts, query: { method } }),
  byInvoice: (invoiceId: string, opts: ApiOptions = {}) =>
    api.get<Payment[]>("/payments", { ...opts, query: { invoiceId } }),
};
