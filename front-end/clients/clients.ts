/**
 * HTTP client for the /clients page.
 *
 * Backend references:
 *  - analytics/.../clients-controller/mod.ts
 *      GET /clients                     → CustomerCard[]
 *      GET /analytics/clients/top       → TopClientsResponse
 *      GET /analytics/clients/segments  → ClientSegmentsResponse
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

export interface ClientSegmentRow {
  key: ClientSegmentKey;
  label: string;
  count: number;
  pct: number;
}

export interface ClientSegmentsResponse {
  segments: ClientSegmentRow[];
}

export const clientsClient = {
  list:     (opts: ApiOptions = {})              => api.get<CustomerCard[]>("/clients", opts),
  top:      (limit = 5, opts: ApiOptions = {})   => api.get<TopClientsResponse>("/analytics/clients/top", { ...opts, query: { limit } }),
  segments: (opts: ApiOptions = {})              => api.get<ClientSegmentsResponse>("/analytics/clients/segments", opts),
  update:   (id: string, patch: Record<string, unknown>, opts: ApiOptions = {}) =>
    api.put<CustomerCard>(`/customers/${id}`, patch, opts),
};
