/**
 * HTTP client for the field pages (REQ-137..143).
 *
 * Backend: backend/src/field/entrypoints/field-controllers/mod.ts (the office,
 * behind the owner's pm_session) and worker-controller/mod.ts (the worker,
 * behind its own pm_worker cookie). Customers come from the existing
 * /customers resource and invoices from the existing /invoices one — this
 * module only names them by id.
 */
import { api, type ApiOptions } from "../lib/api.ts";
import type { SendFailure } from "../lib/field-batches.ts";

export type Cadence = "weekly" | "biweekly" | "monthly";
export type TaskStatus = "assigned" | "complete" | "skipped" | "deferred";

export interface FieldWorker {
  id: string;
  userId: string;
  name: string;
  /** digits only — the login name */
  phoneNumber: string;
  role?: "worker" | "foreman";
  /** REQ-155 — the language the worker is texted in */
  language?: "en" | "es";
  createdAt: string;
  updatedAt: string;
}

export interface TaskType {
  id: string;
  userId: string;
  name: string;
  createdAt: string;
}

export interface Region {
  id: string;
  userId: string;
  name: string;
  color: string;
  lat: number;
  lng: number;
  workerId?: string;
}

export interface SubscriptionItemView {
  taskTypeId: string;
  taskTypeName: string;
  priceCents: number;
}

/** GET /field/subscriptions — a subscription with its names resolved */
export interface SubscriptionView {
  id: string;
  userId: string;
  customerId: string;
  customerName: string;
  address: string;
  lat: number;
  lng: number;
  items: SubscriptionItemView[];
  cadence: Cadence;
  startDate?: string;
  /** weekdays, 0 = Sunday … 6 = Saturday */
  days?: number[];
  intervalWeeks?: number;
  /** REQ-157 — monthly: the picked days of the month, 1–31 */
  daysOfMonth?: number[];
  /** REQ-174: days to pay, from the day the invoice is sent; unset = the account's default */
  netDays?: number;
  active: boolean;
  regionId?: string;
  region: Region | null;
  pinned?: boolean;
  /** "Weekly · Mon, Thu" in both languages */
  schedule: { es: string; en: string };
  createdAt: string;
  updatedAt: string;
}

export interface SubscriptionItemInput {
  taskTypeId?: string;
  /** found in any case, or created */
  taskTypeName?: string;
  priceCents: number;
}

export interface SubscriptionInput {
  customerId: string;
  address: string;
  items: SubscriptionItemInput[];
  cadence?: Cadence;
  /** 1–8; 2 = biweekly */
  intervalWeeks?: number;
  days?: number[];
  /** REQ-157 — monthly: days of the month, 1–31 */
  daysOfMonth?: number[];
  startDate?: string;
  /** REQ-174: days to pay; null clears it (back to the account's default) */
  netDays?: number | null;
}

export type SubscriptionPatch =
  & Partial<Omit<SubscriptionInput, "customerId">>
  & { active?: boolean };

/** GET /field/regions — a zone with its worker and its active subscriptions */
export interface RegionView extends Region {
  worker: { id: string; name: string; role: "worker" | "foreman" } | null;
  subscriptions: SubscriptionView[];
}

/** REQ-288 — GET /field/regions/center: where the map starts with no subscriptions to fit */
export interface MapCenter {
  lat: number;
  lng: number;
  zoom: number;
  source: "business" | "none";
}

/** GET /field/tasks — the office's view: prices, notes, names */
export interface TaskView {
  id: string;
  userId: string;
  subscriptionId: string;
  taskTypeId: string;
  taskTypeName: string;
  customerId: string;
  customerName: string;
  regionId: string;
  regionName: string;
  workerId: string;
  workerName: string;
  date: string;
  address?: string;
  priceCents: number;
  status: TaskStatus;
  deferredTo?: string;
  deferredFrom?: string;
  /** the worker's note */
  note?: string;
  /** the office's note, never shown to the worker */
  adminNote?: string;
  addedBy?: "worker" | "office";
  addedByName?: string;
  completedAt?: string;
  invoiceId?: string;
  /** REQ-164 — made by hand for one day, no subscription behind it */
  oneOff?: true;
}

/** POST /field/tasks — REQ-164: a one-off task by hand */
export interface OneOffTaskInput {
  customerId: string;
  date: string;
  taskTypeId?: string;
  /** found in any case, or created */
  taskTypeName?: string;
  priceCents: number;
  /** omitted: the worker covering the customer's subscription's zone */
  workerId?: string;
  address?: string;
}

/** GET /field/worker/tasks — no prices, no invoice ids, no office notes */
export interface WorkerTaskView {
  id: string;
  subscriptionId: string;
  taskTypeId: string;
  taskTypeName: string;
  customerId: string;
  customerName: string;
  regionId: string;
  workerId: string;
  workerName: string;
  date: string;
  address?: string;
  status: TaskStatus;
  deferredTo?: string;
  deferredFrom?: string;
  note?: string;
  addedBy?: "worker";
  addedByName?: string;
  completedAt?: string;
  /** on an invoice already — read-only for the worker */
  locked: boolean;
  /** REQ-401: "draft" while that invoice is an unsent draft, "invoiced" once sent */
  lockState?: "draft" | "invoiced" | null;
}

export interface GenerateResult {
  created: number;
  tasks: TaskView[];
  /** subscriptions due that day whose zone has no worker */
  skipped: {
    subscriptionId: string;
    customerName: string;
    address: string;
    regionName: string;
  }[];
}

/** the existing invoice record (paperwork module), as the batch page needs it */
export interface BatchInvoice {
  id: string;
  customerId?: string;
  customerName: string;
  status: string;
  jobName?: string;
  amount: number;
  dueDate?: string;
  issuedDate?: string;
  lineItems?: {
    description: string;
    quantity: number;
    unit?: string;
    price: number;
  }[];
  /** lines priced $0 — the office prices them before sending */
  zeroLines: number;
  createdAt?: string;
}

export interface BatchView {
  id: string;
  userId: string;
  from: string;
  to: string;
  invoiceIds: string[];
  invoices: BatchInvoice[];
  createdAt: string;
}

export interface PullSummary {
  pullable: number;
  skipped: number;
  deferred: number;
  open: number;
  alreadyInvoiced: number;
  zeroPriced: number;
}

export type PullResult = BatchView & { summary: PullSummary };

export interface SendResult {
  sent: number;
  sentIds: string[];
  failed: SendFailure[];
  batch: BatchView;
}

export interface WorkerMe {
  id: string;
  name: string;
  role: "worker" | "foreman";
  /** REQ-285 — the language the worker's screen opens in (theirs, else the owner's) */
  language?: "en" | "es";
}

export const fieldClient = {
  // ---- workers (REQ-138) ----
  workers: (opts?: ApiOptions) =>
    api.get<FieldWorker[]>("/field/workers", opts),
  createWorker: (
    b: {
      name: string;
      phoneNumber: string;
      pin: string;
      role?: "worker" | "foreman";
      /** REQ-155 — Spanish when absent */
      language?: "en" | "es";
    },
    opts?: ApiOptions,
  ) =>
    api.post<
      FieldWorker & { texted: boolean; signInUrl?: string; shareText?: string }
    >("/field/workers", b, opts), // REQ-151 — texted: the welcome text went out; REQ-601 — signInUrl + shareText: what to share when it didn't
  /** REQ-155 — the worker's language, changed from the row */
  setWorkerLanguage: (id: string, language: "en" | "es", opts?: ApiOptions) =>
    api.put<FieldWorker>(`/field/workers/${id}`, { language }, opts),
  deleteWorker: (id: string, opts?: ApiOptions) =>
    api.delete<{ ok: true }>(`/field/workers/${id}`, opts),

  // ---- task types (REQ-139) ----
  taskTypes: (q = "", opts?: ApiOptions) =>
    api.get<TaskType[]>("/field/task-types", { ...opts, query: { q } }),

  // ---- subscriptions (REQ-139) ----
  subscriptions: (opts?: ApiOptions) =>
    api.get<SubscriptionView[]>("/field/subscriptions", opts),
  createSubscription: (b: SubscriptionInput, opts?: ApiOptions) =>
    api.post<SubscriptionView>("/field/subscriptions", b, opts),
  updateSubscription: (id: string, b: SubscriptionPatch, opts?: ApiOptions) =>
    api.put<SubscriptionView>(`/field/subscriptions/${id}`, b, opts),
  deleteSubscription: (id: string, opts?: ApiOptions) =>
    api.delete<{ ok: true }>(`/field/subscriptions/${id}`, opts),
  moveSubscription: (id: string, regionId: string, opts?: ApiOptions) =>
    api.post<SubscriptionView>(
      `/field/subscriptions/${id}/move`,
      { regionId },
      opts,
    ),
  unpinSubscription: (id: string, opts?: ApiOptions) =>
    api.post<SubscriptionView>(`/field/subscriptions/${id}/unpin`, {}, opts),

  // ---- zones (REQ-140) ----
  regions: (opts?: ApiOptions) => api.get<RegionView[]>("/field/regions", opts),
  mapCenter: (opts?: ApiOptions) =>
    api.get<MapCenter>("/field/regions/center", opts),
  regroup: (opts?: ApiOptions) =>
    api.post<{ regions: number }>("/field/regions/regroup", {}, opts),
  staffRegion: (id: string, workerId: string | null, opts?: ApiOptions) =>
    api.put<Region>(`/field/regions/${id}/worker`, { workerId }, opts),

  // ---- tasks (REQ-141) ----
  tasks: (date?: string, opts?: ApiOptions) =>
    api.get<TaskView[]>("/field/tasks", { ...opts, query: { date } }),
  generate: (date?: string, opts?: ApiOptions) =>
    api.post<GenerateResult>("/field/tasks/generate", { date }, opts),
  /** REQ-170 — the subscriptions due that day whose zone has no worker */
  unstaffed: (date?: string, opts?: ApiOptions) =>
    api.get<GenerateResult["skipped"]>("/field/tasks/unstaffed", {
      ...opts,
      query: { date },
    }),
  updateTask: (
    id: string,
    b: {
      adminNote?: string;
      priceCents?: number;
      status?: "complete" | "assigned";
      /** REQ-166 — another of the account's workers, this day only */
      workerId?: string;
    },
    opts?: ApiOptions,
  ) => api.put<TaskView>(`/field/tasks/${id}`, b, opts),
  /** REQ-163 */
  deleteTask: (id: string, opts?: ApiOptions) =>
    api.delete<{ ok: true }>(`/field/tasks/${id}`, opts),
  /** REQ-164 */
  createTask: (b: OneOffTaskInput, opts?: ApiOptions) =>
    api.post<TaskView>("/field/tasks", b, opts),
  /** REQ-165 — a service added to the visit the task belongs to */
  addTaskService: (
    id: string,
    b: { taskTypeId?: string; taskTypeName?: string; priceCents?: number },
    opts?: ApiOptions,
  ) => api.post<TaskView>(`/field/tasks/${id}/services`, b, opts),

  // ---- batches (REQ-142) ----
  batches: (opts?: ApiOptions) => api.get<BatchView[]>("/field/batches", opts),
  batch: (id: string, opts?: ApiOptions) =>
    api.get<BatchView>(`/field/batches/${id}`, opts),
  pull: (from: string, to: string, opts?: ApiOptions) =>
    api.post<PullResult>("/field/batches/pull", { from, to }, opts),
  send: (
    id: string,
    invoiceIds: string[],
    allowZero = false,
    opts?: ApiOptions,
  ) =>
    api.post<SendResult>(
      `/field/batches/${id}/send`,
      { invoiceIds, allowZero },
      opts,
    ),
};

/** The worker's own API — the pm_worker cookie travels with the browser; nothing here uses pm_session. */
export const workerClient = {
  login: (phoneNumber: string, pin: string) =>
    api.post<WorkerMe>("/field/worker/login", { phoneNumber, pin }),
  logout: () => api.post<{ ok: true }>("/field/worker/logout", {}),
  me: () => api.get<WorkerMe | null>("/field/worker/me"),
  /** `all` — a foreman asking for every crew (theirs first) */
  tasks: (date?: string, all = false) =>
    api.get<WorkerTaskView[]>("/field/worker/tasks", {
      query: { date, all: all ? "1" : undefined },
    }),
  taskTypes: () => api.get<TaskType[]>("/field/worker/task-types"),
  addService: (
    subscriptionId: string,
    b: { taskTypeId?: string; taskTypeName?: string; date?: string },
  ) =>
    api.post<WorkerTaskView>(
      `/field/worker/visits/${subscriptionId}/services`,
      b,
    ),
  complete: (id: string, note?: string) =>
    api.post<WorkerTaskView>(
      `/field/worker/tasks/${id}/complete`,
      note === undefined ? {} : { note },
    ),
  uncomplete: (id: string) =>
    api.post<WorkerTaskView>(`/field/worker/tasks/${id}/uncomplete`, {}),
  skip: (id: string) =>
    api.post<WorkerTaskView>(`/field/worker/tasks/${id}/skip`, {}),
  restore: (id: string) =>
    api.post<WorkerTaskView>(`/field/worker/tasks/${id}/restore`, {}),
  defer: (id: string, note?: string) =>
    api.post<WorkerTaskView>(`/field/worker/tasks/${id}/defer`, { note }),
  note: (id: string, note: string) =>
    api.post<WorkerTaskView>(`/field/worker/tasks/${id}/note`, { note }),
};
