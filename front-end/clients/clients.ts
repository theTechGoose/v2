/**
 * HTTP client for the /clients page.
 *
 * Backend references:
 *  - analytics/.../clients-controller/mod.ts
 *      GET /clients?page&pageSize&q&status → ClientsPageResponse (REQ-135 — one page)
 *      GET /analytics/clients/top       → TopClientsResponse
 */
import { api, type ApiOptions } from "../lib/api.ts";
import type { BalanceSubParts } from "../../shared/quote-flow/balance-sub.ts";

export type ClientStatus =
  | "active"
  | "lead"
  | "owes"
  | "regular"
  | "cold"
  | "new";
export type ClientLastTone = "hot" | "warm" | "cold";
/** REQ-367 — the card's jobs line as a kind; clients-display words it in the live language */
export type CustomerJobsSub = "overdue" | "active" | "scheduled" | "none";
export type ClientSegmentKey =
  | "property_mgmt"
  | "homeowner"
  | "small_biz"
  | "hoa"
  | "unsorted";

/** REQ-323 — the states `quoteState` / `invoiceState` name (shared/documents/versions.ts) */
export type CustomerDocState =
  | "draft"
  | "scheduled"
  | "sent"
  | "accepted"
  | "declined"
  | "revised"
  | "claimed"
  | "paid"
  | "void"
  | "approved"
  | "pending";

/** REQ-323 — one of the customer's documents as the card back lists it (mirrors the CRM DTO) */
export interface CustomerDocument {
  kind: "quote" | "invoice";
  id: string;
  number: string;
  state: CustomerDocState;
  amountCents: number;
  /** `/quotes?open=<id>` for a quote, `/i/<id>` for an invoice */
  url: string;
  updatedAt: string;
}

export interface CustomerCard {
  id: string;
  userId: string;
  name: string;
  /** REQ-198/323 — the customer's own number, "C-001" */
  number?: string;
  email?: string;
  phoneNumber?: string;
  address?: string;
  notes?: string;
  businessName?: string;
  segment?: Exclude<ClientSegmentKey, "unsorted">;
  vip?: boolean;
  createdAt: string;
  updatedAt: string;

  /** REQ-367: the timestamp — clients-display words "how long ago" in the live language */
  lastWhen: string | null;
  lastTone: ClientLastTone;
  balanceCents: number;
  /** The balance sub-line in English — the neutral base (REQ-204/350). */
  balanceSub: string;
  /** REQ-350 + REQ-367: the same line as data — clients-display words it in the live language */
  balanceSubParts?: BalanceSubParts;
  activeJobs: number;
  jobsSub: CustomerJobsSub;
  status: ClientStatus;
  temp: number;
  daysSinceContact: number;
  revenue12moCents: number;
  /** REQ-323 — every quote and invoice of the customer, newest first */
  documents: CustomerDocument[];
}

/** REQ-135 — the board's chips: a status, or all of them */
export type ClientsFilter = ClientStatus | "all";

/** REQ-135 — one page of the roster, with the chip counts over the query and the roster's totals */
export interface ClientsPageResponse {
  items: CustomerCard[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  counts: Record<ClientsFilter, number>;
  summary: {
    totalClients: number;
    activeJobs: number;
    owedCents: number;
    quietCount: number;
  };
  /** the three to call next: leads and owes, longest quiet first */
  loop: CustomerCard[];
}

export interface ClientsListParams {
  page?: number;
  pageSize?: number;
  q?: string;
  status?: ClientsFilter;
}

export interface TopClient {
  customerId: string;
  name: string;
  revenue12moCents: number;
  rank: number;
  barPct: number;
}

export interface TopClientsResponse {
  results: TopClient[];
}

export const clientsClient = {
  /** REQ-135 — one page; a blank query or the "all" chip is left off the URL */
  list: (params: ClientsListParams = {}, opts: ApiOptions = {}) =>
    api.get<ClientsPageResponse>("/clients", {
      ...opts,
      query: {
        page: params.page,
        pageSize: params.pageSize,
        q: params.q?.trim() || undefined,
        status: params.status && params.status !== "all"
          ? params.status
          : undefined,
      },
    }),
  top: (limit = 5, opts: ApiOptions = {}) =>
    api.get<TopClientsResponse>("/analytics/clients/top", {
      ...opts,
      query: { limit },
    }),
  /** One customer of the signed-in account (GET /customers/:id). */
  get: (id: string, opts: ApiOptions = {}) =>
    api.get<
      Pick<CustomerCard, "id" | "name" | "email" | "phoneNumber" | "address">
    >(`/customers/${id}`, opts),
  update: (id: string, patch: Record<string, unknown>, opts: ApiOptions = {}) =>
    api.put<CustomerCard>(`/customers/${id}`, patch, opts),
  create: (
    patch: {
      name: string;
      phoneNumber?: string;
      email?: string;
      businessName?: string;
      /** REQ-283 — the one-off task form's typed address */
      address?: string;
    },
    opts: ApiOptions = {},
  ) => api.post<CustomerCard>("/customers", patch, opts),
};
