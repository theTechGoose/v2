/**
 * HTTP client for the /clients page.
 *
 * Backend references:
 *  - analytics/.../clients-controller/mod.ts
 *      GET /clients?page&pageSize&q&status → ClientsPageResponse (REQ-135 — one page)
 *      GET /analytics/clients/top       → TopClientsResponse
 */
import { api, type ApiOptions } from "../lib/api.ts";

export type ClientStatus = "active" | "lead" | "owes" | "regular" | "cold";
export type ClientLastTone = "hot" | "warm" | "cold";
export type ClientSegmentKey =
  | "property_mgmt"
  | "homeowner"
  | "small_biz"
  | "hoa"
  | "unsorted";

export interface CustomerCard {
  id: string;
  userId: string;
  name: string;
  email?: string;
  phoneNumber?: string;
  address?: string;
  notes?: string;
  businessName?: string;
  segment?: Exclude<ClientSegmentKey, "unsorted">;
  vip?: boolean;
  createdAt: string;
  updatedAt: string;

  lastWhen: string | null;
  lastWhenRel: string;
  lastTone: ClientLastTone;
  balanceCents: number;
  balanceSub: string;
  activeJobs: number;
  jobsSub: string;
  status: ClientStatus;
  temp: number;
  daysSinceContact: number;
  revenue12moCents: number;
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
