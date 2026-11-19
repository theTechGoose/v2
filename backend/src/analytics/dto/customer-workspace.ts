/** REQ-924 — GET /customers/:id/workspace: everything the customer page shows, for one customer. */
import type { CustomerCard } from "@crm/dto/customer.ts";
import type { WorkspaceSummary } from "@analytics/domain/business/customer-workspace/mod.ts";

export interface WorkspaceInvoice {
  id: string;
  number: string;
  title: string;
  status: string;
  /** the lifecycle word the card uses (shared/documents/versions.ts invoiceState) */
  state: string;
  issuedDate?: string;
  dueDate: string;
  amountCents: number;
  paidCents: number;
  /** still owed on it — 0 unless it is an open receivable */
  balanceCents: number;
  /** days past due, only while something is owed and the due date is past */
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
  /** ≈ per month at the schedule */
  monthlyCents: number;
  /** REQ-1063 — past its end date: no visits left, counted neither active nor recurring */
  ended?: boolean;
  /** REQ-1063 — with an end date only: per-visit × the visits left until it */
  remainingCents?: number;
  /** the next five visits by the schedule (none when paused) */
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
  /** done and not on a live invoice yet */
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

/**
 * REQ-1140 (AMENDMENT of REQ-924(c)) — one signed job: a won quote of this customer, by the
 * REQ-562 `isSignedJob` / `isJobComplete` rule (the same one behind the card's activeJobs).
 */
export interface WorkspaceJob {
  /** the signed quote's id */
  id: string;
  /** the quote's number (Q-001) */
  number: string;
  /** the job name */
  title: string;
  /** in flight: not every non-void linked invoice is paid */
  active: boolean;
  /** when it was signed */
  signedAt?: string;
  /** what was agreed (the quote total), cents */
  agreedCents: number;
  /** what its invoices have been paid so far, cents */
  paidCents: number;
  /** opens the signed quote */
  url: string;
  /** the work orders linked to this job */
  workOrders: { id: string; number: string; status: string; url: string }[];
}

export interface CustomerWorkspace {
  customer: CustomerCard;
  /** the business day the page was built on */
  today: string;
  summary: WorkspaceSummary;
  invoices: WorkspaceInvoice[];
  quotes: WorkspaceQuote[];
  payments: WorkspacePayment[];
  services: WorkspaceService[];
  visits: WorkspaceVisit[];
  workOrders: WorkspaceWorkOrder[];
  /** REQ-1140: the customer's signed jobs, in flight first */
  jobs: WorkspaceJob[];
}
