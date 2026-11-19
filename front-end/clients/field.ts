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

export type Cadence = "weekly" | "biweekly" | "monthly" | "annual";
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
  /** REQ-840 — the ONE crew the worker is in, and its name */
  crewId?: string;
  crewName?: string;
  createdAt: string;
  updatedAt: string;
}

/** REQ-839 — a service in the catalogue; the price lives where it is used */
export interface TaskType {
  id: string;
  userId: string;
  name: string;
  description?: string;
  /** out of every combobox; history keeps the name */
  archived?: true;
  /** GET /field/task-types — where it is used */
  usedBy?: { subscriptions: number; checklists: number };
  createdAt: string;
  updatedAt?: string;
}

/** REQ-927 — one service migration (a segment): the records it moved, undoable, redoable, movable */
export interface ServiceMigrationView {
  id: string;
  fromTypeId: string;
  toTypeId: string;
  fromName: string;
  /** the old service was deleted — undo brings it back */
  fromDeleted: boolean;
  toName: string;
  state: "applied" | "undone";
  counts: { subscriptions: number; checklists: number; tasks: number; crews: number };
  history: { action: "migrate" | "undo" | "redo" | "move"; toTypeId: string; at: string }[];
  createdAt: string;
  updatedAt: string;
}

export interface TaskTypeInput {
  name: string;
  description?: string | null;
}

/** REQ-840 — a crew: a foreman and members who go out together, and the services it does */
export interface CrewView {
  id: string;
  userId: string;
  name: string;
  color: string;
  foremanId?: string;
  foremanName?: string;
  /** [] = any service */
  taskTypeIds: string[];
  taskTypeNames: string[];
  /** staff on every zone, not only the zones that list it (REQ-841) */
  coversAll?: true;
  members: { id: string; name: string }[];
  /** how many zones list it */
  zones: number;
  createdAt: string;
  updatedAt: string;
}

export interface CrewInput {
  name?: string;
  color?: string;
  /** null = none */
  foremanId?: string | null;
  /** replaces the membership */
  memberIds?: string[];
  taskTypeIds?: string[];
  coversAll?: boolean;
}

/** REQ-842 — a worker or a crew out from `from` to `to`, and what happens to their work */
export type AbsenceDisposition = "cover" | "defer" | "skip";
export interface AbsenceView {
  id: string;
  userId: string;
  workerId?: string;
  crewId?: string;
  /** who is out */
  name: string;
  from: string;
  to: string;
  disposition: AbsenceDisposition;
  coverCrewId?: string;
  coverWorkerId?: string;
  coverName?: string;
  note?: string;
  createdAt: string;
}

export interface AbsenceInput {
  workerId?: string;
  crewId?: string;
  from: string;
  to: string;
  disposition: AbsenceDisposition;
  coverCrewId?: string;
  coverWorkerId?: string;
  note?: string;
}

export interface Region {
  id: string;
  userId: string;
  name: string;
  color: string;
  lat: number;
  lng: number;
  workerId?: string;
  /** REQ-841 — the crews staffing the zone, in order */
  crewIds?: string[];
}

export interface SubscriptionItemView {
  taskTypeId: string;
  taskTypeName: string;
  priceCents: number;
  /** REQ-811: the row comes from the visit's checklist (not one of its own) */
  fromChecklist?: true;
}

/** REQ-811: GET /field/checklists — a named list of services a repeat visit references */
export interface ChecklistView {
  id: string;
  userId: string;
  name: string;
  items: SubscriptionItemView[];
  /** how many repeat visits reference it */
  usedBy: number;
  createdAt: string;
  updatedAt: string;
}

export interface ChecklistInput {
  name: string;
  items: SubscriptionItemInput[];
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
  /** REQ-811: the EFFECTIVE services — the checklist's rows (flagged) then the visit's own */
  items: SubscriptionItemView[];
  /** REQ-811: the checklist referenced, and its name */
  checklistId?: string;
  checklistName?: string;
  cadence: Cadence;
  startDate?: string;
  /** weekdays, 0 = Sunday … 6 = Saturday */
  days?: number[];
  intervalWeeks?: number;
  /** REQ-157 — monthly: the picked days of the month, 1–31 */
  daysOfMonth?: number[];
  /** REQ-787 — annual: the month of the yearly visit, 1–12 */
  month?: number;
  /** REQ-174: days to pay, from the day the invoice is sent; unset = the account's default */
  netDays?: number;
  /** REQ-788: every visit bills the account's overhead cost (Settings) */
  overhead?: boolean;
  active: boolean;
  regionId?: string;
  region: Region | null;
  pinned?: boolean;
  /** "Weekly · Mon, Thu" in both languages */
  schedule: { es: string; en: string };
  /** REQ-699: the last service day, if the quote's term ends */
  endDate?: string;
  /** REQ-699: the signed quote that made it, and its number */
  quoteId?: string;
  quoteNumber?: string;
  /** REQ-699: a quote's subscription as the quote said it — "Monthly · $180/mo" */
  billing?: { es: string; en: string };
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
  /** the visit's own rows — may be empty when `checklistId` is set (REQ-811) */
  items: SubscriptionItemInput[];
  /** REQ-811: a checklist's id; null clears it */
  checklistId?: string | null;
  cadence?: Cadence;
  /** 1–8; 2 = biweekly */
  intervalWeeks?: number;
  days?: number[];
  /** REQ-157 — monthly: days of the month, 1–31 */
  daysOfMonth?: number[];
  /** REQ-787 — annual: the month, 1–12 */
  month?: number;
  startDate?: string;
  /** REQ-174: days to pay; null clears it (back to the account's default) */
  netDays?: number | null;
  /** REQ-788: the overhead toggle */
  overhead?: boolean;
}

export type SubscriptionPatch =
  & Partial<Omit<SubscriptionInput, "customerId">>
  & { active?: boolean };

/** GET /field/regions — a zone with its worker, its crews (REQ-841) and its active subscriptions */
export interface RegionView extends Region {
  worker: { id: string; name: string; role: "worker" | "foreman" } | null;
  crews: { id: string; name: string; color: string }[];
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
  /** the day — a job of several days' FIRST day */
  date: string;
  /** REQ-785: a job of several days — its last day; it shows on every day between */
  endDate?: string;
  /** REQ-785: the job's other workers, and their names */
  crewIds?: string[];
  crewNames?: string[];
  /** REQ-841: the crew doing it */
  crewId?: string;
  crewName?: string;
  /** REQ-842: made for someone who is out — their name */
  coverFor?: string;
  coverForName?: string;
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
  /** REQ-785: a job of several days — its last day (omitted: one day) */
  endDate?: string;
  /** REQ-785: more workers on the job */
  crewIds?: string[];
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
  /** REQ-785: a job of several days — its last day */
  endDate?: string;
  /** REQ-785: the job's other workers, and their names */
  crewIds?: string[];
  crewNames?: string[];
  /** REQ-841/842: the crew doing it; who it covers for */
  crewId?: string;
  crewName?: string;
  coverFor?: string;
  coverForName?: string;
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
  /** subscriptions due that day with a service nobody covers (REQ-841: which services) */
  skipped: {
    subscriptionId: string;
    customerName: string;
    address: string;
    regionName: string;
    taskTypeNames?: string[];
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
    service?: string;
    /** REQ-810: the field task the line bills (lines pulled since REQ-810) */
    taskId?: string;
    overhead?: boolean;
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
  /** REQ-840 — "foreman" for the account foreman or a worker who leads their crew */
  role: "worker" | "foreman";
  /** REQ-1008 — true when the foreman power is only their own crew's (a crew lead), not the account-wide role */
  crewLead?: true;
  /** REQ-285 — the language the worker's screen opens in (theirs, else the owner's) */
  language?: "en" | "es";
  /** REQ-840 — the crew, when in one */
  crewId?: string;
  crewName?: string;
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
  /** REQ-840 — the worker's crew, from the row (null = none) */
  setWorkerCrew: (id: string, crewId: string | null, opts?: ApiOptions) =>
    api.put<FieldWorker>(`/field/workers/${id}`, { crewId }, opts),
  deleteWorker: (id: string, opts?: ApiOptions) =>
    api.delete<{ ok: true }>(`/field/workers/${id}`, opts),

  // ---- task types (REQ-139) · the service catalogue (REQ-839) ----
  taskTypes: (q = "", opts?: ApiOptions) =>
    api.get<TaskType[]>("/field/task-types", { ...opts, query: { q } }),
  /** REQ-839 — every service, the archived ones too, with its usage */
  allTaskTypes: (opts?: ApiOptions) =>
    api.get<TaskType[]>("/field/task-types", { ...opts, query: { all: "1" } }),
  createTaskType: (b: TaskTypeInput, opts?: ApiOptions) =>
    api.post<TaskType>("/field/task-types", b, opts),
  updateTaskType: (
    id: string,
    b: Partial<TaskTypeInput> & { archived?: boolean },
    opts?: ApiOptions,
  ) => api.put<TaskType>(`/field/task-types/${id}`, b, opts),
  deleteTaskType: (id: string, opts?: ApiOptions) =>
    api.delete<{ ok: true }>(`/field/task-types/${id}`, opts),
  // ---- service migrations (REQ-927) ----
  migrateTaskType: (
    id: string,
    b: { toId: string; deleteAfter?: boolean },
    opts?: ApiOptions,
  ) =>
    api.post<ServiceMigrationView>(`/field/task-types/${id}/migrate`, b, opts),
  serviceMigrations: (opts?: ApiOptions) =>
    api.get<ServiceMigrationView[]>("/field/service-migrations", opts),
  undoServiceMigration: (id: string, opts?: ApiOptions) =>
    api.post<ServiceMigrationView>(`/field/service-migrations/${id}/undo`, {}, opts),
  redoServiceMigration: (id: string, opts?: ApiOptions) =>
    api.post<ServiceMigrationView>(`/field/service-migrations/${id}/redo`, {}, opts),
  moveServiceMigration: (id: string, toId: string, opts?: ApiOptions) =>
    api.post<ServiceMigrationView>(`/field/service-migrations/${id}/move`, { toId }, opts),

  // ---- crews (REQ-840) ----
  crews: (opts?: ApiOptions) => api.get<CrewView[]>("/field/crews", opts),
  createCrew: (b: CrewInput, opts?: ApiOptions) =>
    api.post<CrewView>("/field/crews", b, opts),
  updateCrew: (id: string, b: CrewInput, opts?: ApiOptions) =>
    api.put<CrewView>(`/field/crews/${id}`, b, opts),
  deleteCrew: (id: string, opts?: ApiOptions) =>
    api.delete<{ ok: true }>(`/field/crews/${id}`, opts),

  // ---- absences (REQ-842) ----
  absences: (opts?: ApiOptions) =>
    api.get<AbsenceView[]>("/field/absences", opts),
  createAbsence: (b: AbsenceInput, opts?: ApiOptions) =>
    api.post<AbsenceView>("/field/absences", b, opts),
  deleteAbsence: (id: string, opts?: ApiOptions) =>
    api.delete<{ ok: true }>(`/field/absences/${id}`, opts),

  // ---- checklists (REQ-811) ----
  checklists: (opts?: ApiOptions) =>
    api.get<ChecklistView[]>("/field/checklists", opts),
  createChecklist: (b: ChecklistInput, opts?: ApiOptions) =>
    api.post<ChecklistView>("/field/checklists", b, opts),
  updateChecklist: (
    id: string,
    b: Partial<ChecklistInput>,
    opts?: ApiOptions,
  ) => api.put<ChecklistView>(`/field/checklists/${id}`, b, opts),
  deleteChecklist: (id: string, opts?: ApiOptions) =>
    api.delete<{ ok: true }>(`/field/checklists/${id}`, opts),

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
  /** REQ-841 — the crews staffing the zone, in order ([] clears) */
  staffRegionCrews: (id: string, crewIds: string[], opts?: ApiOptions) =>
    api.put<Region>(`/field/regions/${id}/worker`, { crewIds }, opts),

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
      /** REQ-785 — a one-off's first day */
      date?: string;
      /** REQ-785 — its last day; null = one day */
      endDate?: string | null;
      /** REQ-785 — the job's other workers */
      crewIds?: string[];
    },
    opts?: ApiOptions,
  ) => api.put<TaskView>(`/field/tasks/${id}`, b, opts),
  /** REQ-842 — one worker's or crew's whole day to another worker or crew */
  reassignDay: (
    b: {
      date: string;
      fromWorkerId?: string;
      fromCrewId?: string;
      toWorkerId?: string;
      toCrewId?: string;
    },
    opts?: ApiOptions,
  ) => api.post<{ moved: number }>("/field/tasks/reassign", b, opts),
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
  /** REQ-924: `customerId?: string` — the customer page's Bill now drafts only her visits */
  pull: (from: string, to: string, opts?: ApiOptions, customerId?: string) =>
    api.post<PullResult>(
      "/field/batches/pull",
      customerId ? { from, to, customerId } : { from, to },
      opts,
    ),
  /** REQ-810: take a draft out of the batch (deleted; its tasks un-invoiced) — answers the batch */
  removeInvoice: (id: string, invoiceId: string, opts?: ApiOptions) =>
    api.delete<BatchView>(`/field/batches/${id}/invoices/${invoiceId}`, opts),
  /** REQ-810: take one line off a draft; `key` is the row as the page shows it (a stale page is 409) */
  removeLine: (
    id: string,
    invoiceId: string,
    index: number,
    key: string,
    opts?: ApiOptions,
  ) =>
    api.delete<BatchView>(
      `/field/batches/${id}/invoices/${invoiceId}/lines/${index}?key=${
        encodeURIComponent(key)
      }`,
      opts,
    ),
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
  me: (opts: ApiOptions = {}) =>
    api.get<WorkerMe | null>("/field/worker/me", opts),
  /** `all` — a foreman asking for every crew (theirs first) */
  tasks: (date?: string, all = false, opts: ApiOptions = {}) =>
    api.get<WorkerTaskView[]>("/field/worker/tasks", {
      ...opts,
      query: { date, all: all ? "1" : undefined },
    }),
  taskTypes: (opts: ApiOptions = {}) =>
    api.get<TaskType[]>("/field/worker/task-types", opts),
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
