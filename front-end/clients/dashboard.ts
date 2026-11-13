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
import type { SearchHit } from "../../shared/documents/search.ts";
import type { AcceptedMethods } from "../../shared/documents/invoice-form.ts";
import {
  invoiceSendPreviewPath,
  type QuoteSendPreview,
  type SendPreviewChannel,
  type SendPreviewDates,
} from "../../shared/quote-flow/send-preview.ts"; // REQ-727

export type { SearchHit };

export interface Profile {
  user: {
    id: string;
    name?: string;
    phoneNumber: string;
    email?: string;
    language?: "en" | "es";
  };
  businessIdentity?:
    & { displayName?: string; logoUrl?: string }
    & Record<string, unknown>;
  /** REQ-483: what GET /profile names the business identity — Settings'
   *  days to pay and the payment methods saved at onboarding. REQ-450: its
   *  name picks the trade examples on the New-invoice form. */
  identity?:
    | (
      & {
        invoiceNetDays?: number;
        acceptedPaymentMethods?: AcceptedMethods;
        businessName?: string;
        displayName?: string;
        /** REQ-623: automatic payment reminders (unset → on, 3/7/14/30) */
        reminders?: { enabled?: boolean; days?: number[] };
      }
      & Record<string, unknown>
    )
    | null;
  /** REQ-206: the payment instructions the invoice form starts from. */
  contractDefaults?:
    | (
      & { paymentInstructions?: string; paymentTermsDays?: number }
      & Record<
        string,
        unknown
      >
    )
    | null;
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

export interface QuoteCounts {
  total: number;
  draft: number;
  sent: number;
  accepted: number;
  /** REQ-566: drafts whose last send reached nobody (part of `draft`). */
  undelivered?: number;
}
export interface RevenueStats {
  ytdCents: number;
  /** REQ-562: distinct jobs paid on this year (the avg-paid-job divisor). */
  paidJobsYtd?: number;
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
    | "invoice_claimed"
    | "invoice_paid"
    | "invoice_overdue"
    | "invoice_nudge_due"
    // REQ-566 (demo-loop cycle 4, m11): owner-side activity
    | "invoice_sent"
    | "task_completed"
    | "customer_replied"
    | "generic";
  title: string;
  /** REQ-496 (P-59): the feed's translation key + params, so the client can
   *  re-render the title in the live language (absent on legacy rows). */
  titleKey?: string;
  titleParams?: Record<string, string | number>;
  body?: string;
  entityType?: "quote" | "invoice" | "customer" | "conversation";
  entityId?: string;
  read: boolean;
  readAt?: string;
  createdAt: string;
}

export interface Invoice {
  id: string;
  userId: string;
  /** Optional — standalone invoices created from the receivables dashboard
   *  have no quote behind them. */
  quoteId?: string;
  customerId?: string;
  /** NW-30 (REQ-011): the job this bill is for — shown on the card so two
   *  invoices for the same customer and amount can be told apart. */
  jobName?: string;
  /** What the bill covers, one line per item. */
  description?: string;
  /** REQ-497: the language the invoice's text was typed in. REQ-586
   *  (cycle 4, M11): "Open" carries it as `?lang=`. */
  lang?: string;
  amount?: number;
  issuedDate?: string;
  dueDate: string;
  status?:
    | "scheduled"
    | "draft"
    | "pending"
    | "sent"
    | "viewed"
    | "claimed"
    | "paid"
    | "void";
  paidAt?: string;
  /** REQ-556: where the paid receipt went — "email" | "text" | "none". */
  receiptSentVia?: string;
  /** REQ-556: how signing's confirmation reached the customer ([] = nobody). */
  deliveredVia?: string[];
  createdAt: string;
  updatedAt: string;
  urgency?: {
    label: string;
    tone: "ok" | "warn" | "danger";
    daysOverdue?: number;
  };
  /** Scheduled-fire date for status=scheduled invoices. */
  scheduledFor?: string;
  installmentIndex?: number;
  installmentTotal?: number;
  remindersMuted?: boolean;
  /** Customer-side claim awaiting contractor confirmation. */
  paymentIntent?: {
    method: string;
    amount: number;
    reference?: string;
    claimedAt: string;
    claimedBy?: string;
  };
  /** REQ-198: the document number ("INV-001"); rows older than numbering have none. */
  number?: string;
  seq?: number;
  /** REQ-201: the published version (1..n). */
  version?: number;
  publishedAt?: string;
  /** REQ-201: content edited after issue, waiting to be published. */
  pendingRevision?: Record<string, unknown>;
  /** REQ-202: what has been received against this bill, INTEGER CENTS. */
  paidCents?: number;
  /** REQ-202: payments above the amount, flagged never hidden (null when 0). */
  overpaidCents?: number | null;
  /** REQ-206: the standalone bill's own content. */
  lineItems?: InvoiceLineItem[];
  subtotalCents?: number;
  discountCents?: number;
  discountReason?: string;
  taxRateBp?: number;
  taxCents?: number;
  netDays?: number;
  serviceAddress?: string;
  serviceDateFrom?: string;
  serviceDateTo?: string;
  paymentInstructions?: string;
  billTo?: InvoiceBillTo;
  [k: string]: unknown;
}

export interface InvoiceLineItem {
  description: string;
  quantity: number;
  unit?: string;
  /** INTEGER CENTS per unit */
  price: number;
  date?: string;
  service?: string;
  address?: string;
}

export interface InvoiceBillTo {
  name?: string;
  businessName?: string;
  email?: string;
  phoneNumber?: string;
  address?: string;
}

/** GET /quotes/:id/ledger (REQ-205) — the part the invoice form reads. */
export interface QuoteLedger {
  quote: {
    id: string;
    number: string;
    version: number;
    status?: string;
    accepted: boolean;
    url: string;
  };
  quoteTotalCents: number;
  approvedChangeOrdersCents: number;
  agreementTotalCents: number;
  invoicedCents: number;
  paidCents: number;
  invoicedUnpaidCents: number;
  remainingToInvoiceCents: number;
  overpaidCents: number;
  invoices: Array<{
    id: string;
    number: string;
    version: number;
    status: string;
    amountCents: number;
    paidCents: number;
    balanceCents: number;
    overpaidCents: number;
    url: string;
  }>;
}

/** POST /invoices/:id/publish — the published invoice plus what went out. */
export type PublishedInvoice = Invoice & {
  notified?: { email?: unknown; sms?: unknown };
};

export interface Customer {
  id: string;
  userId: string;
  name: string;
  email?: string;
  phoneNumber?: string;
  address?: string;
  businessName?: string;
  /** REQ-198: "C-001" */
  number?: string;
  [k: string]: unknown;
}

export type JobStatusKind =
  | "awaiting"
  | "on_track"
  | "awaiting_permit"
  | "overdue"
  | "complete";

export interface Job {
  id: string;
  customer: { id: string; name: string };
  quote: {
    id: string;
    summary: string;
    estimatedTotalCents: number;
    /** REQ-497: the quote's title per language (GET /jobs). */
    jobName?: string;
    jobNameByLang?: Record<string, string>;
    summaryByLang?: Record<string, string>;
  };
  totalCents: number;
  paidCents: number;
  pctPaid: number;
  nextDueDate: string | null;
  /** REQ-473: the quote's agreed payment terms (stored EN wizard value). */
  paymentTerms?: string | null;
  status: JobStatusKind;
  statusLabel: string;
}

export const dashboardClient = {
  profile: (opts: ApiOptions = {}) => api.get<Profile>("/profile", opts),
  stats: (opts: ApiOptions = {}) =>
    api.get<DashboardStats>("/analytics/dashboard", opts),
  jobs: (opts: ApiOptions = {}) => api.get<Job[]>("/jobs", opts),
  notifications: (limit = 10, opts: ApiOptions = {}) =>
    api.get<Notification[]>("/notifications", { ...opts, query: { limit } }),
  unreadCount: (opts: ApiOptions = {}) =>
    api.get<{ count: number }>("/notifications/unread-count", opts),
  markRead: (id: string, opts: ApiOptions = {}) =>
    api.post<void>(`/notifications/${id}/read`, undefined, opts),
  markAllRead: (opts: ApiOptions = {}) =>
    api.post<void>("/notifications/read-all", undefined, opts),
  quotes: (status?: string, opts: ApiOptions = {}) =>
    api.get<QuoteCard[]>("/quotes", { ...opts, query: { status } }),
  invoices: (status?: string, opts: ApiOptions = {}) =>
    api.get<Invoice[]>("/invoices", { ...opts, query: { status } }),
  customers: (opts: ApiOptions = {}) => api.get<Customer[]>("/customers", opts),
  /** REQ-207: the topbar search — GET /search?q= (analytics/.../search-controller). Rows are
   *  ranked (exact number, prefix, substring) and carry the page that opens them (`url`). */
  search: (
    q: string,
    { limit, ...opts }: ApiOptions & { limit?: number } = {},
  ) =>
    api.get<{ results: SearchHit[] }>("/search", {
      ...opts,
      query: { q, limit },
    }),
  /** Create a standalone invoice (no quote). `amount` is INTEGER CENTS.
   *  `jobName`/`description` give the quote-less invoice its own context
   *  (rendered as the hero + note on the public page and email). */
  createInvoice: (
    body: {
      customerId?: string;
      amount?: number;
      dueDate: string;
      issuedDate?: string;
      status?: string;
      jobName?: string;
      description?: string;
      /** REQ-200: one id per form submission — a retry returns the first invoice. */
      requestId?: string;
      [k: string]: unknown;
    },
    opts: ApiOptions = {},
  ) => api.post<Invoice>("/invoices", body, opts),
  /** REQ-201: publish the pending revision (version + 1); notify re-sends the same link. */
  publishInvoice: (id: string, notify: boolean, opts: ApiOptions = {}) =>
    api.post<PublishedInvoice>(`/invoices/${id}/publish`, { notify }, opts),
  /** REQ-727 (demo c4-M16): the email + text the client gets if the invoice
   *  is sent now — in `lang`, else its own language (`lang` in the answer
   *  says which), with the dates the send will stamp. Sends nothing. */
  invoiceSendPreview: (
    id: string,
    channel: SendPreviewChannel,
    lang?: "en" | "es",
    dates: SendPreviewDates = {},
    opts: ApiOptions = {},
  ) =>
    api.get<QuoteSendPreview>(
      invoiceSendPreviewPath(id, channel, lang, dates),
      opts,
    ),
  /** REQ-205: what the quote agreed, invoiced, got paid, and still has to invoice. */
  quoteLedger: (quoteId: string, opts: ApiOptions = {}) =>
    api.get<QuoteLedger>(`/quotes/${quoteId}/ledger`, opts),
  /** The quote record — its customer and job name seed the invoice form. */
  quote: (quoteId: string, opts: ApiOptions = {}) =>
    api.get<
      {
        id: string;
        customerId?: string;
        jobName?: string;
        summary?: string;
        /** REQ-483: the wizard terms — payment_terms seeds the invoice's days */
        terms?: Array<{ stepId?: string; value?: string }>;
      }
    >(`/quotes/${quoteId}`, opts),
};
