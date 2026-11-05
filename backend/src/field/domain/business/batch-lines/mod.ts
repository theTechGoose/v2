/**
 * REQ-142 — a batch pull: completed tasks in a date range that are not on a
 * LIVE invoice become one group per customer, one line per task, priced from
 * the task's snapshot. Worker notes never carry over. Pure — the coordinator
 * turns each group into an invoice through InvoiceStore.
 */
import type { FieldTask, Subscription, TaskType } from "@field/dto/field.ts";

export interface BatchLine {
  taskId: string;
  date: string;
  description: string;
  address: string;
  priceCents: number;
}

export interface CustomerLines {
  customerId: string;
  lines: BatchLine[];
  amount: number;
}

export interface LinesInput {
  from: string;
  to: string;
  tasks: FieldTask[];
  subscriptions: Subscription[];
  taskTypes: TaskType[];
  /** the ids of the account's invoices that still exist and are not void */
  liveInvoiceIds: Set<string>;
}

const inRange = (t: FieldTask, from: string, to: string) => t.date >= from && t.date <= to;
const pullable = (t: FieldTask, live: Set<string>) => t.status === "complete" && !(t.invoiceId && live.has(t.invoiceId));

export function linesFor(input: LinesInput): CustomerLines[] {
  const subs = new Map(input.subscriptions.map((s) => [s.id, s]));
  const types = new Map(input.taskTypes.map((t) => [t.id, t.name]));
  const eligible = input.tasks
    .filter((t) => inRange(t, input.from, input.to) && pullable(t, input.liveInvoiceIds))
  const byCustomer = new Map<string, BatchLine[]>();
  for (const t of eligible) {
    const line: BatchLine = {
      taskId: t.id,
      date: t.date,
      description: types.get(t.taskTypeId) ?? "—",
      address: t.address ?? subs.get(t.subscriptionId)?.address ?? "",
      priceCents: t.priceCents,
      // note: deliberately not copied
    };
    if (!byCustomer.has(t.customerId)) byCustomer.set(t.customerId, []);
    byCustomer.get(t.customerId)!.push(line);
  }
  const ordered = (lines: BatchLine[]) => lines.sort((a, b) => a.date.localeCompare(b.date) || a.description.localeCompare(b.description) || a.taskId.localeCompare(b.taskId));
  return [...byCustomer.entries()].map(([customerId, lines]) => ({ customerId, lines: ordered(lines), amount: total(lines) }));
}

export const total = (lines: BatchLine[]) => lines.reduce((s, l) => s + l.priceCents, 0);

/** what the office needs to know about a date range before and after a pull */
export function summarize(input: { from: string; to: string; tasks: FieldTask[]; liveInvoiceIds: Set<string> }) {
  const rows = input.tasks.filter((t) => inRange(t, input.from, input.to));
  const can = rows.filter((t) => pullable(t, input.liveInvoiceIds));
  return {
    pullable: can.length,
    skipped: rows.filter((t) => t.status === "skipped").length,
    deferred: rows.filter((t) => t.status === "deferred").length,
    open: rows.filter((t) => t.status === "assigned").length,
    alreadyInvoiced: rows.filter((t) => t.status === "complete" && !!t.invoiceId && input.liveInvoiceIds.has(t.invoiceId)).length,
    zeroPriced: can.filter((t) => t.priceCents === 0).length,
  };
}

/** "Oct 12 — Lawn cut — 123 Oak St" / "12 oct — Lawn cut — 123 Oak St" — the invoice line item's description */
export function lineText(l: BatchLine, lang: "en" | "es" = "en"): string {
  const d = new Date(l.date + "T00:00:00Z");
  const month = d.toLocaleDateString(lang === "es" ? "es-ES" : "en-US", { month: "short", timeZone: "UTC" }).replace(".", "");
  const date = lang === "es" ? `${d.getUTCDate()} ${month}` : `${month.charAt(0).toUpperCase() + month.slice(1)} ${d.getUTCDate()}`;
  return `${date} — ${l.description} — ${l.address}`;
}

/** REQ-173: the invoice line item — the flat description for compatibility, plus date / service / address
 *  so the invoice shows the address as a heading with the visits under it */
export function lineItem(l: BatchLine, lang: "en" | "es" = "en") {
  return {
    description: lineText(l, lang),
    quantity: 1,
    unit: lang === "es" ? "visita" : "visit",
    price: l.priceCents,
    date: l.date,
    service: l.description,
    address: l.address,
  };
}
