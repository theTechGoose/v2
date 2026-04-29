/**
 * HTTP client for the /contracts page.
 *
 * Backend reference: paperwork/entrypoints/contract-controller/mod.ts
 *   GET /contracts            → Contract[] (each projected with `mood`)
 *   GET /contracts/:id        → Contract
 *   PUT /contracts/:id        → Contract
 *   DELETE /contracts/:id     → { ok: true }
 *
 * Each list item is enriched server-side via deriveMood() — the front-end
 * groups by mood (active / starting-soon / wrapping-up) for the three tracks.
 */
import { api, type ApiOptions } from "../lib/api.ts";

export type ContractMood =
  | "draft"
  | "starting-soon"
  | "active"
  | "wrapping-up"
  | "completed"
  | "stale";

export interface Contract {
  id: string;
  userId: string;
  quoteId: string;
  customerId?: string;
  status?: string;
  effectiveDate?: string;
  startDate?: string;
  estimatedCompletionDate?: string;
  totalAmount?: number;
  signedAt?: string;
  createdAt: string;
  updatedAt: string;
  mood?: ContractMood;
  [k: string]: unknown;
}

export const contractsClient = {
  list:   (status?: string, opts: ApiOptions = {}) =>
    api.get<Contract[]>("/contracts", { ...opts, query: { status } }),
  get:    (id: string, opts: ApiOptions = {}) =>
    api.get<Contract>(`/contracts/${id}`, opts),
  delete: (id: string, opts: ApiOptions = {}) =>
    api.delete<{ ok: true }>(`/contracts/${id}`, opts),
};
