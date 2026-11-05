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
  createdAt: string;
  updatedAt: string;
}

/** REQ-139: a task type, created on the fly from the combobox. */
export interface TaskType {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
}

export interface SubscriptionItem {
  taskTypeId: string;
  priceCents: number;
}

export type Cadence = "weekly" | "biweekly" | "monthly";
export const CADENCES: readonly Cadence[] = ["weekly", "biweekly", "monthly"];

/** REQ-139: the recurring maintenance agreement on an existing customer. */
export interface Subscription {
  id: string;
  userId: string;
  customerId: string;
  address: string;
  /** geocoded once, kept with the subscription */
  lat: number;
  lng: number;
  items: SubscriptionItem[];
  cadence: Cadence;
  /** the first service day; cadence counts from here (defaults to createdAt's day) */
  startDate?: string;
  /** weekdays (0 = Sunday … 6 = Saturday); default: the start date's weekday */
  days?: number[];
  /** every N weeks (1–8); weekly = 1, biweekly = 2. Ignored for monthly. */
  intervalWeeks?: number;
  /** REQ-157 — monthly: the days of the month (1–31, unique, sorted); 29–31 fall on a shorter month's last day. Default: the start date's day. */
  daysOfMonth?: number[];
  /** REQ-174: days the customer has to pay, from the day the invoice is sent; unset = the account's default */
  netDays?: number;
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
  date: string;
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

/** An error with the HTTP status Danet should answer with (`error.status || 500`). */
export class FieldError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly detail?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "FieldError";
  }
}

/** free-text caps */
export const CAP = { note: 2000, text: 300, taskType: 80 } as const;

export const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;
export const tooLong = (v: unknown, max: number) =>
  typeof v === "string" && v.length > max;
export const digitsOf = (v: unknown) => String(v ?? "").replace(/\D/g, "");
