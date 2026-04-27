/**
 * HTTP client for the /dashboard page.
 *
 * Backend references:
 *  - profile-composite-controller/mod.ts            (GET /profile)
 *  - core/analytics/.../dashboard-controller/mod.ts (GET /analytics/dashboard)
 *  - notification-controller/mod.ts                 (GET /notifications, /notifications/unread-count)
 *  - paperwork/.../quote-controller/mod.ts          (GET /quotes)
 *  - paperwork/.../invoice-controller/mod.ts        (GET /invoices)
 *
 * Shapes are intentionally permissive (Record<string, unknown>) where the
 * frontend only needs to read fields by name — it's the backend's job to
 * own the canonical schema. This keeps the frontend a dumb consumer.
 */
import { api, type ApiOptions } from "../lib/api.ts";

export interface Profile {
  user: { id: string; name?: string; phoneNumber: string; email?: string; language?: "en" | "es" };
  businessIdentity?: { displayName?: string; logoUrl?: string } & Record<string, unknown>;
  [k: string]: unknown;
}

export interface DashboardStats {
  thisMonthBilled?: number;
  counts?: { quotes?: number; invoices?: number; conversations?: number };
  sparkline12mo?: number[];
  [k: string]: unknown;
}

export interface Notification {
  id: string;
  userId: string;
  type: string;
  title: string;
  message?: string;
  unread: boolean;
  createdAt: number;
}

export interface Quote {
  id: string;
  userId: string;
  customerId?: string;
  summary?: string;
  estimatedTotal?: number;
  status?: "draft" | "sent" | "accepted";
  createdAt: number;
  updatedAt: number;
  [k: string]: unknown;
}

export interface Invoice {
  id: string;
  userId: string;
  contractId?: string;
  customerId?: string;
  amount?: number;
  dueDate?: number;
  status?: "draft" | "pending" | "paid";
  createdAt: number;
  updatedAt: number;
  [k: string]: unknown;
}

export const dashboardClient = {
  profile:        (opts: ApiOptions = {})                     => api.get<Profile>("/profile", opts),
  stats:          (opts: ApiOptions = {})                     => api.get<DashboardStats>("/analytics/dashboard", opts),
  notifications:  (limit = 10, opts: ApiOptions = {})         => api.get<Notification[]>("/notifications", { ...opts, query: { limit } }),
  unreadCount:    (opts: ApiOptions = {})                     => api.get<{ count: number }>("/notifications/unread-count", opts),
  markRead:       (id: string, opts: ApiOptions = {})         => api.post<void>(`/notifications/${id}/read`, undefined, opts),
  markAllRead:    (opts: ApiOptions = {})                     => api.post<void>("/notifications/read-all", undefined, opts),
  quotes:         (status?: string, opts: ApiOptions = {})    => api.get<Quote[]>("/quotes", { ...opts, query: { status } }),
  invoices:       (status?: string, opts: ApiOptions = {})    => api.get<Invoice[]>("/invoices", { ...opts, query: { status } }),
};
