/**
 * REQ-142 — a batch pull: completed tasks in a date range that are not on a
 * LIVE invoice become one group per customer, one line per task, priced from
 * the task's snapshot. Worker notes never carry over. Pure — the coordinator
 * turns each group into an invoice through InvoiceStore.
 */
import type { FieldTask, Subscription, TaskType } from "@field/dto/field.ts";
import { overheadCentsFor, type OverheadSetting } from "../../../../../../shared/field/overhead.ts";
import { lastDayOf } from "@field/domain/business/job-span/mod.ts";

export interface BatchLine {
  taskId: string;
  date: string;
  /** REQ-785: a job of several days — its last day; the ONE line names both */
  endDate?: string;
  description: string;
  address: string;
  priceCents: number;
  /** REQ-703: a one-off (REQ-164) — no subscription behind it; decides the invoice's title */
  oneOff?: true;
  /** REQ-788: the visit's overhead — no task behind it */
  overhead?: true;
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
  /** REQ-788: the account's overhead per visit (Settings — flat cents, or a percent of the visit's services) and the line's label in the invoice's language */
  overhead?: { label: string; setting: OverheadSetting };
}

/** REQ-785: a job of several days is in a range that reaches any of its days (it bills once: its line stamps it) */
const inRange = (t: FieldTask, from: string, to: string) => t.date <= to && lastDayOf(t) >= from;
const pullable = (t: FieldTask, live: Set<string>) => t.status === "complete" && !(t.invoiceId && live.has(t.invoiceId));

/** one task as its batch line — priced from the task's snapshot (REQ-810: also how an invoice's own tasks are matched to its lines) */
export function taskLine(t: FieldTask, subs: Map<string, Subscription>, types: Map<string, string>): BatchLine {
  return {
    taskId: t.id,
    date: t.date,
    description: types.get(t.taskTypeId) ?? "—",
    address: t.address ?? subs.get(t.subscriptionId)?.address ?? "",
    priceCents: t.priceCents,
    ...(lastDayOf(t) !== t.date ? { endDate: lastDayOf(t) } : {}),
    ...(t.oneOff || !t.subscriptionId ? { oneOff: true as const } : {}),
    // note: deliberately not copied
  };
}

/** REQ-810: the task lines of these tasks, for matching an invoice's lines back to them */
export function taskLines(input: { tasks: FieldTask[]; subscriptions: Subscription[]; taskTypes: TaskType[] }): BatchLine[] {
  const subs = new Map(input.subscriptions.map((s) => [s.id, s]));
  const types = new Map(input.taskTypes.map((t) => [t.id, t.name]));
  return input.tasks.map((t) => taskLine(t, subs, types));
}

export function linesFor(input: LinesInput): CustomerLines[] {
  const subs = new Map(input.subscriptions.map((s) => [s.id, s]));
  const types = new Map(input.taskTypes.map((t) => [t.id, t.name]));
  const eligible = input.tasks
    .filter((t) => inRange(t, input.from, input.to) && pullable(t, input.liveInvoiceIds));
  const byCustomer = new Map<string, BatchLine[]>();
  for (const t of eligible) {
    const line = taskLine(t, subs, types);
    if (!byCustomer.has(t.customerId)) byCustomer.set(t.customerId, []);
    byCustomer.get(t.customerId)!.push(line);
  }
  // REQ-788: one overhead line per visit (subscription × date) whose subscription has the toggle on —
  // the flat amount, or (AMENDMENT) the percent of that visit's service lines
  if (input.overhead) {
    const visits = new Map<string, { t: FieldTask; s: Subscription; services: number }>();
    for (const t of eligible) {
      const s = subs.get(t.subscriptionId);
      if (!s?.overhead) continue;
      const key = `${t.subscriptionId}|${t.date}`;
      const v = visits.get(key);
      if (v) v.services += t.priceCents;
      else visits.set(key, { t, s, services: t.priceCents });
    }
    for (const { t, s, services } of visits.values()) {
      const priceCents = overheadCentsFor(input.overhead.setting, services);
      if (priceCents <= 0) continue;
      byCustomer.get(t.customerId)!.push({
        taskId: "",
        date: t.date,
        description: input.overhead.label,
        address: t.address ?? s.address,
        priceCents,
        overhead: true,
      });
    }
  }
  const rank = (l: BatchLine) => (l.overhead ? 1 : 0);
  const ordered = (lines: BatchLine[]) => lines.sort((a, b) => a.date.localeCompare(b.date) || rank(a) - rank(b) || a.description.localeCompare(b.description) || a.taskId.localeCompare(b.taskId));
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

/** "Oct 12" / "12 oct" — a YYYY-MM-DD as the invoice shows it */
function shortDate(iso: string, lang: "en" | "es"): string {
  const d = new Date(iso + "T00:00:00Z");
  const month = d.toLocaleDateString(lang === "es" ? "es-ES" : "en-US", { month: "short", timeZone: "UTC" }).replace(".", "");
  return lang === "es" ? `${d.getUTCDate()} ${month}` : `${month.charAt(0).toUpperCase() + month.slice(1)} ${d.getUTCDate()}`;
}

/** "Oct 12 — Lawn cut — 123 Oak St" / "12 oct — Lawn cut — 123 Oak St" — the invoice line item's description;
 *  REQ-785: a job of several days names its first and last day, "Nov 16 – Nov 18 — Fence install — …" */
export function lineText(l: BatchLine, lang: "en" | "es" = "en"): string {
  const when = l.endDate ? `${shortDate(l.date, lang)} – ${shortDate(l.endDate, lang)}` : shortDate(l.date, lang);
  return `${when} — ${l.description} — ${l.address}`;
}

/** REQ-703 (demo m54): the draft's title and service period, from its own lines — one task → its service
 *  ("Fix 3 sagging fence posts"); subscription visits only → "Maintenance · Oct 29 – Nov 12"; mixed → "Services · …" */
export function batchTitle(lines: BatchLine[], lang: "en" | "es" = "en"): { jobName: string; serviceDateFrom: string; serviceDateTo: string } {
  const dates = lines.flatMap((l) => (l.endDate ? [l.date, l.endDate] : [l.date])).sort(); // REQ-785: a job's last day too
  const serviceDateFrom = dates[0] ?? "", serviceDateTo = dates[dates.length - 1] ?? "";
  const period = serviceDateFrom === serviceDateTo
    ? shortDate(serviceDateFrom, lang)
    : `${shortDate(serviceDateFrom, lang)} – ${shortDate(serviceDateTo, lang)}`;
  const kind = lines.every((l) => !l.oneOff)
    ? (lang === "es" ? "Mantenimiento" : "Maintenance")
    : (lang === "es" ? "Servicios" : "Services");
  const single = lines.length === 1 && lines[0].description !== "—" ? lines[0].description : "";
  return { jobName: single || (dates.length ? `${kind} · ${period}` : kind), serviceDateFrom, serviceDateTo };
}

/** REQ-173: the invoice line item — the flat description for compatibility, plus date / service / address
 *  so the invoice shows the address as a heading with the visits under it */
export function lineItem(l: BatchLine, lang: "en" | "es" = "en") {
  return {
    description: lineText(l, lang),
    quantity: 1,
    unit: l.endDate ? (lang === "es" ? "trabajo" : "job") : lang === "es" ? "visita" : "visit", // REQ-785: a job of several days
    price: l.priceCents,
    date: l.date,
    service: l.description,
    address: l.address,
    // REQ-810: the line names its task, so removing the line frees exactly that task
    ...(l.taskId ? { taskId: l.taskId } : {}),
    ...(l.overhead ? { overhead: true as const } : {}),
  };
}

/** REQ-810: an invoice line as stored — what `lineItem` writes, or (pulled before REQ-810) the same without taskId / overhead */
export interface StoredLine {
  description: string;
  quantity: number;
  unit?: string;
  price: number;
  date?: string;
  service?: string;
  address?: string;
  taskId?: string;
  overhead?: boolean;
}

/** the overhead line's label in each language (REQ-788) — how a line written before REQ-810 is known as overhead */
const OVERHEAD_LABELS = new Set(["Overhead", "Gastos generales"]);

/**
 * REQ-810: the task behind an invoice line, among the invoice's own task lines (`candidates`: the tasks stamped
 * with this invoice). A line written since REQ-810 names it; an older line is matched by date + service +
 * address, the price breaking a tie — only a UNIQUE match counts, so the wrong task is never freed.
 */
export function taskForItem(item: StoredLine, candidates: BatchLine[]): string | null {
  if (item.overhead) return null;
  if (item.taskId) return candidates.some((c) => c.taskId === item.taskId) ? item.taskId : null;
  const tasks = candidates.filter((c) => !c.overhead && c.taskId);
  let hits = tasks.filter((c) => c.date === item.date && c.description === item.service && c.address === item.address);
  if (hits.length > 1) hits = hits.filter((c) => c.priceCents === item.price);
  return hits.length === 1 ? hits[0].taskId : null;
}

/** an invoice line back as a batch line (for its title): its task's, else what the line itself says */
function itemLine(item: StoredLine, candidates: BatchLine[]): BatchLine {
  const id = taskForItem(item, candidates);
  const task = id ? candidates.find((c) => c.taskId === id) : undefined;
  if (task) return { ...task, priceCents: item.price };
  const overhead = item.overhead === true || (!item.taskId && OVERHEAD_LABELS.has(item.service ?? ""));
  return {
    taskId: item.taskId ?? "",
    date: item.date ?? "",
    description: item.service ?? item.description,
    address: item.address ?? "",
    priceCents: item.price,
    ...(overhead ? { overhead: true as const } : {}),
  };
}

/**
 * REQ-810: a draft without its line `index` — the lines left, the amount, the description and the title /
 * service dates (REQ-703) recomputed from them, the task freed (null when the line names none), and `last`:
 * no task line is left (only an overhead line, or nothing) — the whole invoice leaves the batch.
 */
export function withoutLine(items: StoredLine[], index: number, candidates: BatchLine[], lang: "en" | "es" = "en") {
  const freedTaskId = taskForItem(items[index], candidates);
  const rest = items.filter((_, i) => i !== index);
  const lines = rest.map((it) => itemLine(it, candidates));
  return {
    freedTaskId,
    last: !lines.some((l) => !l.overhead),
    patch: {
      lineItems: rest,
      amount: rest.reduce((s, it) => s + it.price * (it.quantity ?? 1), 0),
      description: rest.map((it) => it.description).join("\n"),
      ...batchTitle(lines.filter((l) => l.date), lang),
    },
  };
}
