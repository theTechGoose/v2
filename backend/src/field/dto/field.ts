/**
 * REQ-137 — the field module's own records. A subscription names one of the
 * account's CUSTOMERS (`customerId`, read through CustomerStore); a task names
 * the INVOICE it was billed on (`invoiceId`, written through InvoiceStore).
 * Nothing here is a field on a customer or an invoice.
 */

/** REQ-138: a worker has their own login (cell + PIN). */
export interface FieldWorker {
  id: string;
  userId: string;
  name: string;
  /** digits only — the login name, unique across the app */
  phoneNumber: string;
  pin: string;
  /** a foreman sees and closes every worker's visits */
  role?: "worker" | "foreman";
  /** REQ-155 — the language the worker is texted in (Spanish by default); absent on workers from before */
  language?: "en" | "es";
  /** REQ-840: the ONE crew the worker is in */
  crewId?: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * REQ-840: a crew — a foreman and members who go out together, and the services it does
 * (`taskTypeIds`; [] = any service). `coversAll`: it is staff on every zone, not only the
 * zones that list it (REQ-841).
 */
export interface Crew {
  id: string;
  userId: string;
  name: string;
  color: string;
  /** one of the members; leads the crew's tasks and sees every one of them */
  foremanId?: string;
  taskTypeIds: string[];
  coversAll?: true;
  createdAt: string;
  updatedAt: string;
}

/** REQ-842: what happens to the work of someone who is out */
export type AbsenceDisposition = "cover" | "defer" | "skip";
export const DISPOSITIONS: readonly AbsenceDisposition[] = [
  "cover",
  "defer",
  "skip",
];

/** REQ-842: a worker or a crew is out from `from` to `to` (inclusive) */
export interface Absence {
  id: string;
  userId: string;
  workerId?: string;
  crewId?: string;
  from: string;
  to: string;
  disposition: AbsenceDisposition;
  /** cover: who takes the work — a crew or a worker */
  coverCrewId?: string;
  coverWorkerId?: string;
  note?: string;
  createdAt: string;
}

/** REQ-139: a task type, created on the fly from the combobox. REQ-839: the service catalogue's row — a description, archivable. */
export interface TaskType {
  id: string;
  userId: string;
  name: string;
  /** REQ-839: what the service is — the price lives where the type is used */
  description?: string;
  /** REQ-839: out of every combobox; history keeps the name */
  archived?: true;
  createdAt: string;
  updatedAt?: string;
}

export interface SubscriptionItem {
  taskTypeId: string;
  priceCents: number;
  /** REQ-927: the services this row was before each migration moved it — the last is the latest */
  migratedFrom?: MigrationMark[];
}

/** REQ-927: "this record belonged to `typeId` before migration `migrationId`" */
export interface MigrationMark {
  typeId: string;
  migrationId: string;
}

/**
 * REQ-927: one service migration — a segment. Every record it moved from `fromTypeId` to
 * `toTypeId` is marked (`migratedFrom`) and listed in `refs`, so the segment can be undone,
 * redone or moved on to another service. `from` keeps the old service, so undoing after it was
 * deleted brings it back under the same id.
 */
export interface ServiceMigration {
  id: string;
  userId: string;
  fromTypeId: string;
  toTypeId: string;
  from: { name: string; description?: string; archived?: true; createdAt: string };
  state: "applied" | "undone";
  refs: {
    subscriptions: string[];
    checklists: string[];
    tasks: string[];
    /** "replaced": the crew's service became the target; "dropped": the target was already the crew's (or another crew's), so the old one left the list */
    crews: { id: string; action: "replaced" | "dropped" }[];
  };
  /** rows removed because their record already had the target service — undo puts them back */
  merged: { kind: "subscription" | "checklist"; id: string; at: number; item: SubscriptionItem }[];
  history: { action: "migrate" | "undo" | "redo" | "move"; toTypeId: string; at: string }[];
  createdAt: string;
  updatedAt: string;
}

/** REQ-811: a named list of services (task types with a price each) a repeat visit references instead of listing the same items again */
export interface Checklist {
  id: string;
  userId: string;
  name: string;
  items: SubscriptionItem[];
  createdAt: string;
  updatedAt: string;
}

export type Cadence = "weekly" | "biweekly" | "monthly" | "annual";
export const CADENCES: readonly Cadence[] = [
  "weekly",
  "biweekly",
  "monthly",
  "annual", // REQ-787
];

/** REQ-139: the recurring maintenance agreement on an existing customer. */
export interface Subscription {
  id: string;
  userId: string;
  customerId: string;
  address: string;
  /** geocoded once, kept with the subscription */
  lat: number;
  lng: number;
  /** the visit's OWN rows; REQ-811: with a checklist, the effective services are the checklist's + these (an own row on the same type wins) */
  items: SubscriptionItem[];
  /** REQ-811: the checklist referenced (ChecklistStore) — optional; a visit needs it or at least one own row */
  checklistId?: string;
  cadence: Cadence;
  /** the first service day; cadence counts from here (defaults to createdAt's day) */
  startDate?: string;
  /** weekdays (0 = Sunday … 6 = Saturday); default: the start date's weekday */
  days?: number[];
  /** every N weeks (1–8); weekly = 1, biweekly = 2. Ignored for monthly. */
  intervalWeeks?: number;
  /** REQ-157 — monthly: the days of the month (1–31, unique, sorted); 29–31 fall on a shorter month's last day. Default: the start date's day. */
  daysOfMonth?: number[];
  /** REQ-787 — annual: the month of the yearly visit (1 = January … 12); its day(s) are daysOfMonth. Default: the start date's month. */
  month?: number;
  /** REQ-174: days the customer has to pay, from the day the invoice is sent; unset = the account's default */
  netDays?: number;
  /** REQ-699: the last service day — nothing is due after it; unset = until it is paused or deleted */
  endDate?: string;
  /** REQ-699: the signed quote whose recurring payment term made it (QuoteStore), and that quote's number */
  quoteId?: string;
  quoteNumber?: string;
  /** REQ-788: every visit bills the account's overhead cost (Settings) on top of its services */
  overhead?: boolean;
  active: boolean;
  /** set by the grouping (REQ-140) — or by the owner's drag */
  regionId?: string;
  /** the owner moved it by hand; re-grouping leaves it alone */
  pinned?: boolean;
  createdAt: string;
  updatedAt: string;
}

/** REQ-140: a geographic zone; one worker covers it. */
export interface Region {
  id: string;
  userId: string;
  name: string;
  color: string;
  lat: number;
  lng: number;
  workerId?: string;
  /** REQ-841: the crews staffing the zone, in order — the first that does a service takes it */
  crewIds?: string[];
}

export type TaskStatus = "assigned" | "complete" | "skipped" | "deferred";

/** REQ-141: one piece of work on one day. */
export interface FieldTask {
  id: string;
  userId: string;
  subscriptionId: string;
  taskTypeId: string;
  customerId: string;
  regionId: string;
  workerId: string;
  /** the day — a multi-day job's FIRST day */
  date: string;
  /** REQ-785: a multi-day job's last day (after `date`): this ONE record shows on every day between and is done once */
  endDate?: string;
  /** REQ-785: the other workers on the job, besides `workerId` — they see it and may check it off */
  crewIds?: string[];
  /** REQ-841: the crew doing it (its members are `workerId` + `crewIds` at generation time) */
  crewId?: string;
  /** REQ-842: made for someone who is out — the absent crew's or worker's id */
  coverFor?: string;
  /** REQ-842: the absence that decided this task (cover, defer, skip) — removing it re-derives the task */
  byAbsence?: string;
  /** address snapshot, so a deleted subscription's history keeps it */
  address?: string;
  /** price snapshot at generation time */
  priceCents: number;
  /** "skipped" = the worker removed the service; "deferred" = pushed to the next day — neither is ever invoiced */
  status: TaskStatus;
  deferredTo?: string;
  deferredFrom?: string;
  /** the worker's note, office-only */
  note?: string;
  /** the office's own note; never sent to the worker */
  adminNote?: string;
  /** the worker added this service on site (the office prices it) — or the office added it by hand (REQ-164/165) */
  addedBy?: "worker" | "office";
  /** REQ-164: made by hand for one day — no subscription behind it; generation and re-sync never touch it */
  oneOff?: true;
  /** REQ-163: the office deleted it — kept only so the day's generation does not bring it back; never listed */
  deleted?: true;
  addedByName?: string;
  completedAt?: string;
  /** REQ-142: set once the task is on an invoice (the invoice's id, in InvoiceStore) */
  invoiceId?: string;
  /** REQ-927: the services this task was before each migration moved it — the last is the latest */
  migratedFrom?: MigrationMark[];
}

/** REQ-142: one pull over a date range. */
export interface Batch {
  id: string;
  userId: string;
  from: string;
  to: string;
  invoiceIds: string[];
  createdAt: string;
}

/**
 * An error with the HTTP status Danet should answer with (`error.status || 500`).
 * REQ-421 — `code`: a stable machine code the page maps to its own words (en/es);
 * `message` stays the developer's English for logs and API callers.
 */
export class FieldError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly detail?: Record<string, unknown>,
    readonly code?: string,
  ) {
    super(message);
    this.name = "FieldError";
  }
}

/** free-text caps */
export const CAP = {
  note: 2000,
  text: 300,
  taskType: 80,
  checklist: 80,
  crew: 80,
} as const;

export const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
export const tooLong = (v: unknown, max: number) =>
  typeof v === "string" && v.length > max;
export const digitsOf = (v: unknown) => String(v ?? "").replace(/\D/g, "");
