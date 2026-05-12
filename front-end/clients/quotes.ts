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

export type QuoteStage = "draft" | "sent" | "opened" | "cooling" | "stale" | "won" | "lost";

export interface QuoteCard {
  id: string;
  userId: string;
  customerId?: string;
  customerName: string | null;
  summary?: string;
  description?: string;
  lineItems?: { description: string; quantity?: number; unit?: string; price?: number }[];
  estimatedTotal?: number;
  status?: string;
  sentAt?: string;
  acceptedAt?: string;
  lostAt?: string;
  createdAt: string;
  updatedAt: string;
  // Derived
  stage:        QuoteStage;
  daysIn:       number;
  opens:        number;
  lastOpenAt:   string | null;
  sentDays:     number | null;
  decidedDays:  number | null;
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
  kind: "open_count" | "median_days_to_decide" | "best_day_of_week" | "static_fallback";
}

export const quotesClient = {
  list:    (status?: string, opts: ApiOptions = {}) => api.get<QuoteCard[]>("/quotes", { ...opts, query: { status } }),
  get:     (id: string, opts: ApiOptions = {})      => api.get<QuoteCard>(`/quotes/${id}`, opts),
  update:  (id: string, patch: Record<string, unknown>, opts: ApiOptions = {}) =>
    api.put<QuoteCard>(`/quotes/${id}`, patch, opts),
  winRate: (days = 90, opts: ApiOptions = {})      => api.get<WinRate>("/analytics/quotes/win-rate", { ...opts, query: { days } }),
  insight: (opts: ApiOptions = {})                  => api.get<Insight>("/analytics/quotes/insight", opts),
  delete:  (id: string, opts: ApiOptions = {})      => api.delete<{ ok: true }>(`/quotes/${id}`, opts),
};
