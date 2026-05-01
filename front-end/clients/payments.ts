/**
 * HTTP client for the /payments page.
 *
 * Backend reference: paperwork/entrypoints/payment-controller/mod.ts
 *   GET /payments                      → Payment[]
 *   GET /payments?method=ach           → Payment[]
 *   GET /payments?invoiceId=<id>       → Payment[]
 *   GET /payments/:id                  → Payment
 */
import { api, type ApiOptions } from "../lib/api.ts";

export type PaymentMethod = "cash" | "check" | "ach" | "card" | "other";

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
  byMethod: (method: PaymentMethod, opts: ApiOptions = {}) =>
    api.get<Payment[]>("/payments", { ...opts, query: { method } }),
  byInvoice: (invoiceId: string, opts: ApiOptions = {}) =>
    api.get<Payment[]>("/payments", { ...opts, query: { invoiceId } }),
};
