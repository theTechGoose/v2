/**
 * HTTP client for the /quotes page.
 *
 * Backend references:
 *  - analytics/.../quotes-controller/mod.ts
 *      GET /quotes                       → QuoteCard[] (enriched w/ stage, opens, daysIn)
 *      GET /analytics/quotes/win-rate    → { windowDays, decided, won, lost, winRate }
 *      GET /analytics/quotes/insight     → { text, kind }
 */
import { api, type ApiOptions } from "../lib/api.ts";
import type { QuoteLedger } from "../../shared/documents/ledger.ts";
import type { DocVersionRecord } from "../../shared/documents/versions.ts";

export type { QuoteLedger };

/** REQ-201: one filed version of the quote; the last one is `current`. */
export type QuoteVersion = DocVersionRecord & { current?: boolean };

export type QuoteStage =
  | "draft"
  | "sent"
  | "opened"
  | "cooling"
  | "stale"
  | "won"
  | "lost";

export interface QuoteCard {
  id: string;
  userId: string;
  customerId?: string;
  customerName: string | null;
  summary?: string;
  /** ≤3-word job title — the platform-wide identifier (roadmap p.10). */
  jobName?: string;
  description?: string;
  /** Per-language cache of the description (keyed by lang code), populated
   *  lazily when the quote is previewed/sent in a language. */
  descriptionByLang?: Record<string, string>;
  /** Per-language job title + summary, populated from the picked job option. */
  jobNameByLang?: Record<string, string>;
  summaryByLang?: Record<string, string>;
  /** REQ-263: where the job is (the "412 Oak St Austin" the contractor typed). */
  serviceAddress?: string;
  lineItems?: {
    description: string;
    quantity?: number;
    unit?: string;
    price?: number;
  }[];
  estimatedTotal?: number;
  status?: string;
  /** REQ-198/201: the document's number ("Q-001") and version (1..n). */
  number?: string;
  version?: number;
  publishedAt?: string;
  /** REQ-201: content edited after the quote was issued, not yet published. */
  pendingRevision?: Record<string, unknown>;
  /** Onboarding sample quote (P-15): rendered as a badged card, excluded
   *  from every pipeline/money aggregate. */
  isSample?: boolean;
  sentAt?: string;
  acceptedAt?: string;
  lostAt?: string;
  createdAt: string;
  updatedAt: string;
  // Derived
  stage: QuoteStage;
  daysIn: number;
  opens: number;
  lastOpenAt: string | null;
  sentDays: number | null;
  decidedDays: number | null;
  [k: string]: unknown;
}

export interface WinRate {
  windowDays: number;
  decided: number;
  won: number;
  lost: number;
  winRate: number | null;
}

export interface Insight {
  text: string;
  kind:
    | "open_count"
    | "median_days_to_decide"
    | "best_day_of_week"
    | "static_fallback";
}

export const quotesClient = {
  list: (status?: string, opts: ApiOptions = {}) =>
    api.get<QuoteCard[]>("/quotes", { ...opts, query: { status } }),
  get: (id: string, opts: ApiOptions = {}) =>
    api.get<QuoteCard>(`/quotes/${id}`, opts),
  update: (id: string, patch: Record<string, unknown>, opts: ApiOptions = {}) =>
    api.put<QuoteCard>(`/quotes/${id}`, patch, opts),
  winRate: (days = 90, opts: ApiOptions = {}) =>
    api.get<WinRate>("/analytics/quotes/win-rate", {
      ...opts,
      query: { days },
    }),
  insight: (opts: ApiOptions = {}) =>
    api.get<Insight>("/analytics/quotes/insight", opts),
  delete: (id: string, opts: ApiOptions = {}) =>
    api.delete<{ ok: true }>(`/quotes/${id}`, opts),
  /** REQ-205: what was agreed, invoiced, paid, owed and still to invoice. */
  ledger: (id: string, opts: ApiOptions = {}) =>
    api.get<QuoteLedger>(`/quotes/${id}/ledger`, opts),
  /** REQ-201: every filed version plus the current one. */
  versions: (id: string, opts: ApiOptions = {}) =>
    api.get<QuoteVersion[]>(`/quotes/${id}/versions`, opts),
  /** REQ-201: publish the pending revision (version+1); `notify` re-sends the same link. */
  publish: (
    id: string,
    body: { notify?: boolean; language?: "en" | "es" } = {},
    opts: ApiOptions = {},
  ) =>
    api.post<QuoteCard & { notified?: Record<string, unknown> }>(
      `/quotes/${id}/publish`,
      body,
      opts,
    ),
};
