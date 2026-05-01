/**
 * HTTP client for the /dashboard page.
 *
 * Backend references:
 *  - users/.../profile-composite-controller/mod.ts        (GET /profile)
 *  - analytics/.../dashboard-controller/mod.ts            (GET /analytics/dashboard)
 *  - analytics/.../jobs-controller/mod.ts                 (GET /jobs)
 *  - communication/.../notification-controller/mod.ts     (GET /notifications, /notifications/unread-count)
 *  - paperwork/.../invoice-controller/mod.ts              (GET /invoices)
 *  - crm/.../customer-controller/mod.ts                   (GET /customers)
 *
 * Shapes mirror the backend DTOs. Money fields from the dashboard payload
 * are CENTS — see analytics/dto/dashboard-stats.ts.
 */
import { api, type ApiOptions } from "../lib/api.ts";
import type { QuoteCard } from "./quotes.ts";

export interface Profile {
  user: { id: string; name?: string; phoneNumber: string; email?: string; language?: "en" | "es" };
  businessIdentity?: { displayName?: string; logoUrl?: string } & Record<string, unknown>;
  [k: string]: unknown;
}

export interface AgingBuckets {
  current: number;
  aging1_14d: number;
  overdue15_30d: number;
  overdue30plus: number;
}

export interface InvoiceCounts {
  total: number;
  pending: number;
  paid: number;
  overdue: number;
  agingBuckets: AgingBuckets;
}

export interface QuoteCounts { total: number; draft: number; sent: number; accepted: number }
export interface ContractCounts { total: number; draft: number; signed: number }

export interface RevenueStats {
  ytdCents: number;
  lastMonthCents: number;
  monthOverMonthPct: number;
  /** Length-12 array, oldest → newest, monthly paid-invoice totals (cents). */
  sparkline12mo: number[];
}

export interface PaymentStats {
  receivedYtdCents: number;
  methodMixCents: Record<string, number>;
  topPayors: Array<{ customerId: string; totalCents: number }>;
}

export interface DashboardStats {
  customers: number;
  quotes: QuoteCounts;
  contracts: ContractCounts;
  invoices: InvoiceCounts;
  /** Sum of estimatedTotal across quotes whose status === 'sent'. CENTS. */
  quotedValueCents: number;
  awaitingResponse: number;
  revenue: RevenueStats;
  payments: PaymentStats;
}

export interface Notification {
  id: string;
  userId: string;
  type:
    | "quote_sent"
    | "quote_accepted"
    | "contract_signed"
    | "invoice_paid"
    | "invoice_overdue"
    | "customer_replied"
    | "generic";
  title: string;
  body?: string;
  entityType?: "quote" | "contract" | "invoice" | "customer" | "conversation";
  entityId?: string;
  read: boolean;
  readAt?: string;
  createdAt: string;
}

export interface Invoice {
  id: string;
  userId: string;
  contractId: string;
  customerId?: string;
  amount?: number;
  issuedDate?: string;
  dueDate: string;
  status?: "draft" | "pending" | "paid";
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
  urgency?: { label: string; tone: "ok" | "warn" | "danger"; daysOverdue?: number };
  [k: string]: unknown;
}

export interface Customer {
  id: string;
  userId: string;
  name: string;
  email?: string;
  phoneNumber?: string;
  [k: string]: unknown;
}

export type JobStatusKind = "awaiting" | "on_track" | "awaiting_permit" | "overdue" | "complete";

export interface Job {
  id: string;
  customer: { id: string; name: string };
  quote: { id: string; summary: string; estimatedTotalCents: number };
  contract: { id: string; status?: string } | null;
  totalCents: number;
  paidCents: number;
  pctPaid: number;
  nextDueDate: string | null;
  status: JobStatusKind;
  statusLabel: string;
}

export const dashboardClient = {
  profile:        (opts: ApiOptions = {})                     => api.get<Profile>("/profile", opts),
  stats:          (opts: ApiOptions = {})                     => api.get<DashboardStats>("/analytics/dashboard", opts),
  jobs:           (opts: ApiOptions = {})                     => api.get<Job[]>("/jobs", opts),
  notifications:  (limit = 10, opts: ApiOptions = {})         => api.get<Notification[]>("/notifications", { ...opts, query: { limit } }),
  unreadCount:    (opts: ApiOptions = {})                     => api.get<{ count: number }>("/notifications/unread-count", opts),
  markRead:       (id: string, opts: ApiOptions = {})         => api.post<void>(`/notifications/${id}/read`, undefined, opts),
  markAllRead:    (opts: ApiOptions = {})                     => api.post<void>("/notifications/read-all", undefined, opts),
  quotes:         (status?: string, opts: ApiOptions = {})    => api.get<QuoteCard[]>("/quotes", { ...opts, query: { status } }),
  invoices:       (status?: string, opts: ApiOptions = {})    => api.get<Invoice[]>("/invoices", { ...opts, query: { status } }),
  customers:      (opts: ApiOptions = {})                     => api.get<Customer[]>("/customers", opts),
};
