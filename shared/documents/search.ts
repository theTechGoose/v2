/**
 * REQ-207 — the dashboard's global search, pure.
 *
 * One box finds a customer, a quote, an invoice, a change order or a work
 * order by its number (full or partial, with or without the prefix — "INV-5",
 * "5000", "inv5000", "Q-1"), by the customer's name or number, by an address
 * (the customer's, the billing one, the service one), by a date (an ISO date
 * or "Nov 6"), or by a word in the job name / description. Results are
 * ranked: an exact number match first, then a number prefix, then any
 * substring. Every row carries what the contractor needs to recognise it —
 * the customer, the number and type, the amount, the state — and the records
 * it is tied to (an invoice shows its quote; a quote its invoices; a customer
 * its counts).
 *
 * The backend coordinator loads one account's records and calls
 * `searchRecords`; the island groups the rows with `groupHits`. Nothing here
 * touches I/O, so the ranking is the same in the unit tests, the backend and
 * the browser.
 *
 * REQ-360 (demo-loop cycle 1, m11): the onboarding sample quote (P-15's
 * `isSample`, or the legacy summary tag) is not a record the contractor made —
 * it never enters the candidate set, so it is never a row ("#9876481D … Draft")
 * nor counted on a customer's row.
 */
import { isSampleQuote } from "../quote-flow/pipeline-stats.ts";
import {
  foldSearch,
  textsMatchAllWords,
} from "../quote-flow/customer-search.ts";
import { docNumberOf, matchesDocNumber } from "./numbering.ts";
import { formatShortDate } from "../quote-flow/format-helpers.ts";
import {
  invoiceBalance,
  invoiceState,
  quoteState,
  versionOf,
} from "./versions.ts";

export const SEARCH_TYPES = [
  "customer",
  "quote",
  "invoice",
  "changeOrder",
  "workOrder",
] as const;
export type SearchType = typeof SEARCH_TYPES[number];

export function isSearchType(v: unknown): v is SearchType {
  return typeof v === "string" &&
    (SEARCH_TYPES as readonly string[]).includes(v);
}

/** 0 = the number exactly, 1 = a prefix of the number, 2 = any other match. */
export type SearchRank = 0 | 1 | 2;

export interface SearchRelated {
  type: SearchType;
  id: string;
  number: string;
  url: string;
}

export interface SearchHit {
  type: SearchType;
  id: string;
  /** "INV-001" (or "#1A2B3C4D" for a row written before numbering) */
  number: string;
  version: number;
  rank: SearchRank;
  /** the dashboard page that opens this record */
  url: string;
  /** the record's own title: job name, summary, description — the customer's name for a customer */
  label: string;
  /** a second line: the address, the email, the assignee… — free text, never a date (REQ-713) */
  sub?: string;
  /**
   * REQ-713 (demo-loop cycle 5, m27): dates travel as typed "YYYY-MM-DD"
   * fields, not baked into `sub`, so the client spells them in the page
   * language (searchHitLine) instead of printing raw ISO in the Spanish UI.
   */
  dueDate?: string;
  serviceFrom?: string;
  serviceTo?: string;
  scheduledFor?: string;
  customerId?: string;
  customerName?: string;
  customerNumber?: string;
  amountCents?: number;
  status?: string;
  /** the records this one is tied to, in display order */
  related: SearchRelated[];
  /** a customer row: how many of each it has */
  counts?: {
    quotes: number;
    invoices: number;
    changeOrders: number;
    workOrders: number;
  };
}

// ---- the records, structurally (both the backend DTOs and the tests satisfy these) ----

export interface SearchCustomer {
  id: string;
  number?: string;
  name: string;
  businessName?: string;
  email?: string;
  phoneNumber?: string;
  address?: string;
  notes?: string;
  createdAt?: string;
}

interface Snapshot {
  name?: string;
  businessName?: string;
  email?: string;
  phoneNumber?: string;
  address?: string;
  number?: string;
}

export interface SearchQuote {
  id: string;
  number?: string;
  seq?: number;
  version?: number;
  customerId?: string;
  summary?: string;
  jobName?: string;
  description?: string;
  status?: string;
  acceptedAt?: string;
  sentAt?: string;
  estimatedTotal?: number;
  effectiveDate?: string;
  startDate?: string;
  createdAt?: string;
  customerSnapshot?: Snapshot;
  /** P-15: the onboarding sample — never searchable (REQ-360) */
  isSample?: boolean;
}

export interface SearchInvoice {
  id: string;
  number?: string;
  seq?: number;
  version?: number;
  customerId?: string;
  quoteId?: string;
  jobName?: string;
  description?: string;
  status?: string;
  amount?: number;
  paidCents?: number;
  issuedDate?: string;
  dueDate?: string;
  paidAt?: string;
  serviceAddress?: string;
  serviceDateFrom?: string;
  serviceDateTo?: string;
  createdAt?: string;
  billTo?: Snapshot;
  customerSnapshot?: Snapshot;
}

export interface SearchChangeOrder {
  id: string;
  number?: string;
  seq?: number;
  version?: number;
  invoiceId: string;
  quoteId?: string;
  customerId?: string;
  description: string;
  deltaAmountCents: number;
  status?: string;
  createdAt?: string;
  decidedAt?: string;
}

export interface SearchWorkOrder {
  id: string;
  number?: string;
  seq?: number;
  version?: number;
  customerId?: string;
  quoteId?: string;
  invoiceId?: string;
  description: string;
  serviceAddress?: string;
  scheduledFor?: string;
  completedOn?: string;
  assignee?: string;
  status?: string;
  createdAt?: string;
}

export interface SearchData {
  customers: readonly SearchCustomer[];
  quotes: readonly SearchQuote[];
  invoices: readonly SearchInvoice[];
  changeOrders?: readonly SearchChangeOrder[];
  workOrders?: readonly SearchWorkOrder[];
}

export interface SearchOptions {
  /** rows per type (default 10) */
  limit?: number;
  /** only these types (default all) */
  types?: readonly SearchType[];
}

// ---- urls ----

/** The dashboard page that opens the record. Customers have no deep link yet: the roster. */
export function urlFor(type: SearchType, id: string): string {
  switch (type) {
    case "customer":
      return "/customers";
    case "quote":
      return `/quotes?open=${id}`;
    case "invoice":
      return `/invoices?open=${id}`;
    case "changeOrder":
      return `/co/${id}`;
    case "workOrder":
      return `/wo/${id}`;
  }
}

// ---- matching ----

function fold(s: string): string {
  // REQ-519: fold accents ("é" → "e") before stripping, never drop the letter
  return foldSearch(s).replace(/[^a-z0-9]/g, "");
}

function splitNumber(folded: string): { letters: string; digits: string } {
  const m = folded.match(/^([a-z]*)(\d*)$/);
  return m ? { letters: m[1], digits: m[2] } : { letters: folded, digits: "" };
}

function unpad(digits: string): string {
  return digits.replace(/^0+/, "") || (digits ? "0" : "");
}

/**
 * How well `query` names `number`: 0 when it names it exactly ("INV-5000",
 * "5000", "inv5000" → INV-5000; "Q-1" → Q-001), 1 when it is a prefix
 * ("INV-5" → INV-5000, "INV-2" → INV-020), 2 when the digits appear inside
 * ("102" → INV-5102), null when it does not. A prefix that names another
 * kind never hits ("Q-1" is not INV-001; "CO-1" is not C-001).
 */
export function numberRank(
  number: string | undefined,
  query: string,
): SearchRank | null {
  if (!number) return null;
  const n = fold(number);
  const q = fold(query);
  if (!n || !q) return null;
  const nn = splitNumber(n);
  const qq = splitNumber(q);
  const letters = qq.letters;
  const letterOk = letters === "" || letters === nn.letters;
  const letterPrefixOk = letters === "" || nn.letters.startsWith(letters);
  if (!letterPrefixOk) return null;
  if (qq.digits) {
    const want = unpad(qq.digits);
    const have = unpad(nn.digits);
    if (letterOk && want === have) return 0;
    if (have.startsWith(want)) return 1;
    if (nn.digits.includes(qq.digits)) return 2;
    return null;
  }
  // letters only: "inv" names every invoice, loosely
  return matchesDocNumber(number, query) ? 2 : null;
}

const MONTHS: ReadonlyArray<readonly string[]> = [
  ["january", "enero", "jan", "ene"],
  ["february", "febrero", "feb"],
  ["march", "marzo", "mar"],
  ["april", "abril", "apr", "abr"],
  ["may", "mayo"],
  ["june", "junio", "jun"],
  ["july", "julio", "jul"],
  ["august", "agosto", "aug", "ago"],
  ["september", "septiembre", "setiembre", "sep", "sept", "set"],
  ["october", "octubre", "oct"],
  ["november", "noviembre", "nov"],
  ["december", "diciembre", "dec", "dic"],
];

function monthIndex(name: string): number | null {
  const w = name.toLowerCase();
  if (w.length < 3) return null;
  for (let i = 0; i < MONTHS.length; i++) {
    if (MONTHS[i].some((m) => m === w || (w.length >= 3 && m.startsWith(w)))) {
      return i + 1;
    }
  }
  return null;
}

/** The ISO day of a stored date ("2026-11-06" from "2026-11-06T10:00:00.000Z"), or null. */
function isoDay(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const d = value.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null;
}

/**
 * Does `query` name this date? An ISO substring of at least four characters
 * ("2026-11-06", "2026-11", "11-06") or a month name with an optional day,
 * in English or Spanish, in either order ("Nov 6", "6 nov", "noviembre").
 */
export function matchesDate(value: string | undefined, query: string): boolean {
  const d = isoDay(value);
  if (!d) return false;
  const q = query.trim().toLowerCase();
  if (!q) return false;
  if (/^[\d-]+$/.test(q)) return q.length >= 4 && d.includes(q);
  let month: number | null = null;
  let day: number | null = null;
  let m = q.match(/^([a-záéíóúñ]+)\.?\s*(\d{1,2})?$/i);
  if (m) {
    month = monthIndex(m[1]);
    day = m[2] ? Number(m[2]) : null;
  } else {
    m = q.match(/^(\d{1,2})\s*(?:de\s+)?([a-záéíóúñ]+)\.?$/i);
    if (!m) return false;
    day = Number(m[1]);
    month = monthIndex(m[2]);
  }
  if (month === null) return false;
  if (Number(d.slice(5, 7)) !== month) return false;
  return day === null || Number(d.slice(8, 10)) === day;
}

function hasPhone(phone: string | undefined, q: string): boolean {
  if (!phone) return false;
  const qd = q.replace(/\D/g, "");
  if (qd.length < 3 || /[a-z]/i.test(q)) return false;
  return phone.replace(/\D/g, "").includes(qd);
}

/** A row written before numbering is still found by the start of its id (at least four characters). */
function hasId(id: string, q: string): boolean {
  return q.length >= 4 && id.toLowerCase().startsWith(q);
}

/** REQ-519 (demo cycle 3, M33): accent- and case-blind, every word of q somewhere in the
 *  record's texts, any order — "maria" and "maria pena" find "María José Peña" */
function anyText(q: string, ...hays: Array<string | undefined>): boolean {
  return textsMatchAllWords(hays, q);
}

function anyDate(q: string, ...dates: Array<string | undefined>): boolean {
  return dates.some((d) => matchesDate(d, q));
}

/** The rank a record's number earns, else 2 when any text/date/related test passes, else null. */
function rankOf(
  number: string | undefined,
  raw: string,
  ...tests: boolean[]
): SearchRank | null {
  const byNumber = numberRank(number, raw);
  if (byNumber !== null) return byNumber;
  return tests.some(Boolean) ? 2 : null;
}

// ---- the search ----

export function searchRecords(
  data: SearchData,
  query: string,
  opts: SearchOptions = {},
): SearchHit[] {
  const raw = query.trim();
  const q = raw.toLowerCase();
  if (!q) return [];
  const limit = Math.max(1, opts.limit ?? 10);
  const types = new Set<SearchType>(opts.types ?? SEARCH_TYPES);
  // REQ-360: the onboarding sample is not the contractor's record.
  data = { ...data, quotes: data.quotes.filter((x) => !isSampleQuote(x)) };
  const changeOrders = data.changeOrders ?? [];
  const workOrders = data.workOrders ?? [];

  const customerById = new Map(data.customers.map((c) => [c.id, c]));
  const quoteById = new Map(data.quotes.map((x) => [x.id, x]));
  const invoiceById = new Map(data.invoices.map((x) => [x.id, x]));
  const invoicesByQuote = groupBy(data.invoices, (i) => i.quoteId);
  const invoicesByCustomer = groupBy(data.invoices, (i) => i.customerId);
  const quotesByCustomer = groupBy(data.quotes, (x) => x.customerId);
  const cosByInvoice = groupBy(changeOrders, (co) => co.invoiceId);
  const cosByQuote = groupBy(changeOrders, (co) => co.quoteId);
  const cosByCustomer = groupBy(changeOrders, (co) => co.customerId);
  const wosByInvoice = groupBy(workOrders, (wo) => wo.invoiceId);
  const wosByQuote = groupBy(workOrders, (wo) => wo.quoteId);
  const wosByCustomer = groupBy(workOrders, (wo) => wo.customerId);

  const ref = (
    type: SearchType,
    doc: { id: string; number?: string },
  ): SearchRelated => ({
    type,
    id: doc.id,
    number: docNumberOf(doc),
    url: urlFor(type, doc.id),
  });
  const bySeq = <
    T extends { seq?: number; number?: string; createdAt?: string },
  >(a: T, b: T) =>
    (a.seq ?? 0) - (b.seq ?? 0) ||
    (a.number ?? "").localeCompare(b.number ?? "") ||
    (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
  const customerOf = (
    doc: {
      customerId?: string;
      customerSnapshot?: Snapshot;
      billTo?: Snapshot;
    },
  ) => {
    const c = doc.customerId ? customerById.get(doc.customerId) : undefined;
    return {
      id: doc.customerId,
      name: doc.billTo?.name ?? c?.name ?? doc.customerSnapshot?.name,
      number: c?.number ?? doc.customerSnapshot?.number,
      texts: [
        c?.name,
        c?.businessName,
        c?.address,
        c?.email,
        doc.customerSnapshot?.name,
        doc.customerSnapshot?.businessName,
        doc.customerSnapshot?.address,
        doc.billTo?.name,
        doc.billTo?.businessName,
        doc.billTo?.address,
      ],
      numbers: [c?.number, doc.customerSnapshot?.number, doc.billTo?.number],
      phone: c?.phoneNumber,
    };
  };
  const customerHit = (cust: ReturnType<typeof customerOf>) =>
    anyText(q, ...cust.texts) || hasPhone(cust.phone, q) ||
    cust.numbers.some((n) => numberRank(n, raw) === 0);
  const relatedHit = (rel: SearchRelated[]) =>
    rel.some((r) => numberRank(r.number, raw) === 0);

  const hits: SearchHit[] = [];

  if (types.has("customer")) {
    const rows: SearchHit[] = [];
    for (const c of [...data.customers].sort(bySeq)) {
      const rank = rankOf(
        c.number,
        raw,
        anyText(q, c.name, c.businessName, c.email, c.address, c.notes),
        hasPhone(c.phoneNumber, q),
        anyDate(q, c.createdAt),
      );
      if (rank === null) continue;
      const quotes = quotesByCustomer.get(c.id) ?? [];
      const invoices = invoicesByCustomer.get(c.id) ?? [];
      rows.push({
        type: "customer",
        id: c.id,
        number: docNumberOf(c),
        version: 1,
        rank,
        url: urlFor("customer", c.id),
        label: c.name,
        sub: c.businessName ?? c.address ?? c.email ?? c.phoneNumber,
        customerId: c.id,
        customerName: c.name,
        customerNumber: c.number,
        related: [],
        counts: {
          quotes: quotes.length,
          invoices: invoices.length,
          changeOrders: (cosByCustomer.get(c.id) ?? []).length,
          workOrders: (wosByCustomer.get(c.id) ?? []).length,
        },
      });
    }
    hits.push(...take(rows, limit));
  }

  if (types.has("quote")) {
    const rows: SearchHit[] = [];
    for (const x of [...data.quotes].sort(bySeq)) {
      const cust = customerOf(x);
      const related = [
        ...(invoicesByQuote.get(x.id) ?? []).sort(bySeq).map((i) =>
          ref("invoice", i)
        ),
        ...(cosByQuote.get(x.id) ?? []).sort(bySeq).map((co) =>
          ref("changeOrder", co)
        ),
        ...(wosByQuote.get(x.id) ?? []).sort(bySeq).map((wo) =>
          ref("workOrder", wo)
        ),
      ];
      const rank = rankOf(
        x.number,
        raw,
        anyText(q, x.summary, x.jobName, x.description),
        customerHit(cust),
        anyDate(
          q,
          x.createdAt,
          x.sentAt,
          x.acceptedAt,
          x.effectiveDate,
          x.startDate,
        ),
        relatedHit(related),
        hasId(x.id, q),
      );
      if (rank === null) continue;
      rows.push({
        type: "quote",
        id: x.id,
        number: docNumberOf(x),
        version: versionOf(x),
        rank,
        url: urlFor("quote", x.id),
        label: x.jobName ?? x.summary ?? cust.name ?? docNumberOf(x),
        sub: x.jobName && x.summary && x.jobName !== x.summary
          ? x.summary
          : undefined,
        customerId: cust.id,
        customerName: cust.name,
        customerNumber: cust.number,
        amountCents: x.estimatedTotal,
        status: quoteState(x),
        related,
      });
    }
    hits.push(...take(rows, limit));
  }

  if (types.has("invoice")) {
    const rows: SearchHit[] = [];
    for (const i of [...data.invoices].sort(bySeq)) {
      const cust = customerOf(i);
      const quote = i.quoteId ? quoteById.get(i.quoteId) : undefined;
      const related = [
        ...(quote ? [ref("quote", quote)] : []),
        ...(cosByInvoice.get(i.id) ?? []).sort(bySeq).map((co) =>
          ref("changeOrder", co)
        ),
        ...(wosByInvoice.get(i.id) ?? []).sort(bySeq).map((wo) =>
          ref("workOrder", wo)
        ),
      ];
      const rank = rankOf(
        i.number,
        raw,
        anyText(q, i.jobName, i.description, i.serviceAddress),
        customerHit(cust),
        anyDate(
          q,
          i.issuedDate,
          i.dueDate,
          i.createdAt,
          i.paidAt,
          i.serviceDateFrom,
          i.serviceDateTo,
        ),
        relatedHit(related),
        hasId(i.id, q),
      );
      if (rank === null) continue;
      rows.push({
        type: "invoice",
        id: i.id,
        number: docNumberOf(i),
        version: versionOf(i),
        rank,
        url: urlFor("invoice", i.id),
        label: i.jobName ?? firstLine(i.description) ?? quote?.jobName ??
          quote?.summary ?? cust.name ?? docNumberOf(i),
        sub: i.serviceAddress,
        dueDate: dayOf(i.dueDate),
        serviceFrom: dayOf(i.serviceDateFrom),
        serviceTo: dayOf(i.serviceDateTo),
        customerId: cust.id,
        customerName: cust.name,
        customerNumber: cust.number,
        amountCents: i.amount,
        status: invoiceState(i),
        related,
      });
    }
    hits.push(...take(rows, limit));
  }

  if (types.has("changeOrder")) {
    const rows: SearchHit[] = [];
    for (const co of [...changeOrders].sort(bySeq)) {
      const invoice = invoiceById.get(co.invoiceId);
      const quote = co.quoteId ? quoteById.get(co.quoteId) : undefined;
      const cust = customerOf({
        customerId: co.customerId ?? invoice?.customerId,
        customerSnapshot: invoice?.customerSnapshot,
      });
      const related = [
        ...(invoice ? [ref("invoice", invoice)] : []),
        ...(quote ? [ref("quote", quote)] : []),
      ];
      const rank = rankOf(
        co.number,
        raw,
        anyText(q, co.description),
        customerHit(cust),
        anyDate(q, co.createdAt, co.decidedAt),
        relatedHit(related),
        hasId(co.id, q),
      );
      if (rank === null) continue;
      rows.push({
        type: "changeOrder",
        id: co.id,
        number: docNumberOf(co),
        version: versionOf(co),
        rank,
        url: urlFor("changeOrder", co.id),
        label: co.description,
        customerId: cust.id,
        customerName: cust.name,
        customerNumber: cust.number,
        amountCents: co.deltaAmountCents,
        status: co.status ?? "pending",
        related,
      });
    }
    hits.push(...take(rows, limit));
  }

  if (types.has("workOrder")) {
    const rows: SearchHit[] = [];
    for (const wo of [...workOrders].sort(bySeq)) {
      const invoice = wo.invoiceId ? invoiceById.get(wo.invoiceId) : undefined;
      const quote = wo.quoteId ? quoteById.get(wo.quoteId) : undefined;
      const cust = customerOf({
        customerId: wo.customerId ?? invoice?.customerId ?? quote?.customerId,
      });
      const related = [
        ...(invoice ? [ref("invoice", invoice)] : []),
        ...(quote ? [ref("quote", quote)] : []),
      ];
      const rank = rankOf(
        wo.number,
        raw,
        anyText(q, wo.description, wo.serviceAddress, wo.assignee),
        customerHit(cust),
        anyDate(q, wo.scheduledFor, wo.completedOn, wo.createdAt),
        relatedHit(related),
        hasId(wo.id, q),
      );
      if (rank === null) continue;
      rows.push({
        type: "workOrder",
        id: wo.id,
        number: docNumberOf(wo),
        version: versionOf(wo),
        rank,
        url: urlFor("workOrder", wo.id),
        label: wo.description,
        sub: wo.serviceAddress ?? (wo.scheduledFor ? undefined : wo.assignee),
        scheduledFor: dayOf(wo.scheduledFor),
        customerId: cust.id,
        customerName: cust.name,
        customerNumber: cust.number,
        status: wo.status ?? "open",
        related,
      });
    }
    hits.push(...take(rows, limit));
  }

  return hits.sort((a, b) =>
    a.rank - b.rank || typeOrder(a.type) - typeOrder(b.type)
  );
}

/** The rows grouped by type, in the fixed order; empty groups are skipped. */
export function groupHits(
  hits: readonly SearchHit[],
): Array<{ type: SearchType; hits: SearchHit[] }> {
  return SEARCH_TYPES
    .map((type) => ({ type, hits: hits.filter((h) => h.type === type) }))
    .filter((g) => g.hits.length > 0);
}

/** The row to open when the contractor presses Enter: the best-ranked one. */
export function bestHit(hits: readonly SearchHit[]): SearchHit | undefined {
  return hits.length
    ? hits.reduce((b, h) => (h.rank < b.rank ? h : b), hits[0])
    : undefined;
}

/** The open balance of an invoice row, for display next to its amount. */
export function hitBalanceCents(
  i: { amount?: number; paidCents?: number; status?: string },
): number {
  return invoiceBalance(
    i.amount,
    i.paidCents ?? (i.status === "paid" ? i.amount ?? 0 : 0),
  ).balanceCents;
}

function typeOrder(type: SearchType): number {
  return SEARCH_TYPES.indexOf(type);
}

/** The best `limit` rows of one type, ranked, ties in number order (the lists are pre-sorted by seq). */
/** REQ-713: a stored date (bare day or full ISO) as its "YYYY-MM-DD" day */
function dayOf(v: string | undefined): string | undefined {
  return v ? v.slice(0, 10) : undefined;
}

/**
 * REQ-713 (demo-loop cycle 5, m27): a hit's typed dates in the page language
 * — "20 nov → 22 nov" for a service window, else the due or scheduled day.
 */
export function searchHitDates(
  h: SearchHit,
  lang: "en" | "es",
): string | undefined {
  const service = [h.serviceFrom, h.serviceTo]
    .filter((d): d is string => !!d)
    .map((d) => formatShortDate(d, lang))
    .join(" → ");
  if (service) return service;
  const day = h.dueDate ?? h.scheduledFor;
  return day ? formatShortDate(day, lang) : undefined;
}

/**
 * REQ-713: the row's second line in the topbar search — the record's own
 * label when the title is the customer, then the address / email / assignee
 * (`sub`), falling back to the localized date when there is no `sub`.
 */
export function searchHitLine(
  h: SearchHit,
  lang: "en" | "es",
): string | undefined {
  const second = h.sub ?? searchHitDates(h, lang);
  if (h.type === "customer") return second;
  const title = h.customerName ?? h.label;
  return [h.label !== title ? h.label : undefined, second]
    .filter(Boolean).join(" · ") || undefined;
}

function take(rows: SearchHit[], limit: number): SearchHit[] {
  return rows
    .map((h, i) => ({ h, i }))
    .sort((a, b) => a.h.rank - b.h.rank || a.i - b.i)
    .slice(0, limit)
    .map(({ h }) => h);
}

function groupBy<T>(
  rows: readonly T[],
  key: (row: T) => string | undefined,
): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    if (!k) continue;
    const list = out.get(k);
    if (list) list.push(row);
    else out.set(k, [row]);
  }
  return out;
}

function firstLine(s: string | undefined): string | undefined {
  const line = s?.split("\n")[0]?.trim();
  return line || undefined;
}
