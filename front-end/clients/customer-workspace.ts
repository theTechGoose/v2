/**
 * REQ-924 — HTTP client for the customer page (/customers/<id>).
 *
 * Backend: analytics/entrypoints/clients-controller/mod.ts
 *   GET /customers/:id/workspace → CustomerWorkspace (mirrors analytics/dto/customer-workspace.ts)
 * Bill now: fieldClient.pull(from, to, opts, customerId) then fieldClient.send(batch, [her draft]).
 */
import { api, type ApiOptions } from "../lib/api.ts";
import type { CustomerCard } from "./clients.ts";
import { fieldClient, type SendResult } from "./field.ts";

export interface WorkspaceSummary {
  owedCents: number;
  overdueCents: number;
  billedCents: number;
  /** REQ-1090 — the invoices summed into billedCents (the "Invoices: N" hint) */
  billedCount: number;
  paidCents: number;
  lastPayment?: { amountCents: number; method: string; receivedAt: string };
  openQuotes: number;
  openQuotesCents: number;
  activeServices: number;
  recurringMonthlyCents: number;
  /** REQ-1063 — the earliest end date among the running services */
  recurringEndsOn?: string;
  nextVisit?: string;
  unbilledVisits: number;
  unbilledCents: number;
}

export interface WorkspaceInvoice {
  id: string;
  number: string;
  title: string;
  status: string;
  state: string;
  issuedDate?: string;
  dueDate: string;
  amountCents: number;
  paidCents: number;
  balanceCents: number;
  overdueDays?: number;
  url: string;
  updatedAt: string;
}

export interface WorkspaceQuote {
  id: string;
  number: string;
  title: string;
  state: string;
  amountCents: number;
  url: string;
  updatedAt: string;
}

export interface WorkspacePayment {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  amountCents: number;
  method: string;
  receivedAt: string;
  reference?: string;
}

export interface WorkspaceService {
  id: string;
  address: string;
  active: boolean;
  cadence: string;
  schedule: { en: string; es: string };
  items: { taskTypeId: string; taskTypeName: string; priceCents: number }[];
  netDays?: number;
  quoteNumber?: string;
  startDate?: string;
  endDate?: string;
  perVisitCents: number;
  monthlyCents: number;
  /** REQ-1063 — past its end date: not active, adds nothing per month */
  ended?: boolean;
  /** REQ-1063 — with an end date: per-visit × the visits left until it */
  remainingCents?: number;
  nextVisits: string[];
  unbilledVisits: number;
  unbilledCents: number;
}

export interface WorkspaceVisit {
  id: string;
  subscriptionId: string;
  date: string;
  status: string;
  priceCents: number;
  taskTypeName: string;
  workerName: string;
  invoiceId?: string;
  invoiceNumber?: string;
  unbilled: boolean;
}

export interface WorkspaceWorkOrder {
  id: string;
  number: string;
  description: string;
  status: string;
  /** REQ-1140: the signed job (quote) it belongs to */
  quoteId?: string;
  scheduledFor?: string;
  url: string;
  updatedAt: string;
}

/** REQ-1140 (AMENDMENT of REQ-924(c)) — one signed job (a won quote), by the card's activeJobs rule */
export interface WorkspaceJob {
  id: string;
  number: string;
  title: string;
  active: boolean;
  signedAt?: string;
  agreedCents: number;
  paidCents: number;
  url: string;
  workOrders: { id: string; number: string; status: string; url: string }[];
}

export interface CustomerWorkspace {
  customer: CustomerCard;
  today: string;
  summary: WorkspaceSummary;
  invoices: WorkspaceInvoice[];
  quotes: WorkspaceQuote[];
  payments: WorkspacePayment[];
  services: WorkspaceService[];
  visits: WorkspaceVisit[];
  workOrders: WorkspaceWorkOrder[];
  /** REQ-1140: her signed jobs, in flight first */
  jobs: WorkspaceJob[];
}

export const customerWorkspaceClient = {
  get: (id: string, opts: ApiOptions = {}) =>
    api.get<CustomerWorkspace>(
      `/customers/${encodeURIComponent(id)}/workspace`,
      opts,
    ),

  /** Bill now: draft only this customer's done visits (the last year up to today), then send her draft.
   *  Answers null when there was nothing to bill. */
  async billNow(customerId: string, today: string): Promise<SendResult | null> {
    const from = shiftIso(today, -365);
    const pulled = await fieldClient.pull(from, today, {}, customerId);
    const mine = pulled.invoices.filter((i) => i.customerId === customerId).map(
      (i) => i.id
    );
    if (!mine.length) return null;
    // $0 lines are refused (409) as on the Batches page — the page says so and links there
    return await fieldClient.send(pulled.id, mine, false);
  },
};

function shiftIso(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
