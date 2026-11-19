/**
 * REQ-730 (demo-loop cycle 5, issue c2-p13-p): the field routes read their
 * lists on the SSR side, so the first HTML already carries the rows instead
 * of a "Loading…" line that waits for hydration + a client fetch.
 */
import type {
  AbsenceView,
  BatchView,
  ChecklistView,
  CrewView,
  FieldWorker,
  GenerateResult,
  RegionView,
  SubscriptionView,
  TaskType,
  TaskView,
} from "../clients/field.ts";
import { ssrBackendGetAuthed } from "./backend-fetch.ts";

export interface FieldWorkersSeed {
  workers: FieldWorker[];
  regions: RegionView[];
  /** REQ-840/842 — the crews and who is away; [] when unreadable */
  crews: CrewView[];
  absences: AbsenceView[];
  /** REQ-840 — the live services, for the crew form; [] when unreadable */
  types: TaskType[];
}
export interface FieldAssignmentsSeed {
  regions: RegionView[];
  workers: FieldWorker[];
  /** REQ-841 — the crews a zone can be staffed with; [] when unreadable */
  crews: CrewView[];
}
/** REQ-839 */
export interface FieldServicesSeed {
  types: TaskType[];
}
export interface FieldSubscriptionsSeed {
  subs: SubscriptionView[];
}
/** REQ-811 */
export interface FieldChecklistsSeed {
  checklists: ChecklistView[];
}
export interface FieldBatchesSeed {
  batches: BatchView[];
}
export interface FieldTasksSeed {
  date: string;
  /** REQ-940 — the business's field day (the page's "Today") */
  today?: string;
  tasks: TaskView[];
  skipped: GenerateResult["skipped"];
  workers: FieldWorker[] | null;
}

export type AuthedGet = <T>(
  path: string,
  sessionId: string | undefined,
) => Promise<{ ok: boolean; status: number; data?: T }>;

/** One authed read; a thrown or non-ok read is null. */
async function readList<T>(
  get: AuthedGet,
  path: string,
  sessionId: string,
): Promise<T[] | null> {
  try {
    const r = await get<T[]>(path, sessionId);
    return r.ok && Array.isArray(r.data) ? r.data : null;
  } catch {
    return null;
  }
}

/** /field/workers: the crew (required) + the zones they cover (optional, [] when unreadable — as the island does). */
export async function loadFieldWorkersSeed(
  sessionId: string | undefined,
  get: AuthedGet = ssrBackendGetAuthed,
): Promise<FieldWorkersSeed | null> {
  if (!sessionId) return null;
  const [workers, regions, crews, absences, types] = await Promise.all([
    readList<FieldWorker>(get, "/field/workers", sessionId),
    readList<RegionView>(get, "/field/regions", sessionId),
    readList<CrewView>(get, "/field/crews", sessionId),
    readList<AbsenceView>(get, "/field/absences", sessionId),
    readList<TaskType>(get, "/field/task-types", sessionId),
  ]);
  if (!workers) return null;
  return {
    workers,
    regions: regions ?? [],
    crews: crews ?? [],
    absences: absences ?? [],
    types: types ?? [],
  };
}

/** /field/assignments: the zones and the crew — both required, as the island's load() needs both. */
export async function loadFieldAssignmentsSeed(
  sessionId: string | undefined,
  get: AuthedGet = ssrBackendGetAuthed,
): Promise<FieldAssignmentsSeed | null> {
  if (!sessionId) return null;
  const [regions, workers, crews] = await Promise.all([
    readList<RegionView>(get, "/field/regions", sessionId),
    readList<FieldWorker>(get, "/field/workers", sessionId),
    readList<CrewView>(get, "/field/crews", sessionId),
  ]);
  if (!regions || !workers) return null;
  return { regions, workers, crews: crews ?? [] };
}

/** REQ-839 /field/services: every service, the archived ones too. */
export async function loadFieldServicesSeed(
  sessionId: string | undefined,
  get: AuthedGet = ssrBackendGetAuthed,
): Promise<FieldServicesSeed | null> {
  if (!sessionId) return null;
  const types = await readList<TaskType>(
    get,
    "/field/task-types?all=1",
    sessionId,
  );
  return types ? { types } : null;
}

/** /field/subscriptions: the subscription cards. */
export async function loadFieldSubscriptionsSeed(
  sessionId: string | undefined,
  get: AuthedGet = ssrBackendGetAuthed,
): Promise<FieldSubscriptionsSeed | null> {
  if (!sessionId) return null;
  const subs = await readList<SubscriptionView>(
    get,
    "/field/subscriptions",
    sessionId,
  );
  return subs ? { subs } : null;
}

/** REQ-811 /field/checklists: the checklist cards. */
export async function loadFieldChecklistsSeed(
  sessionId: string | undefined,
  get: AuthedGet = ssrBackendGetAuthed,
): Promise<FieldChecklistsSeed | null> {
  if (!sessionId) return null;
  const checklists = await readList<ChecklistView>(
    get,
    "/field/checklists",
    sessionId,
  );
  return checklists ? { checklists } : null;
}

/** /field/batches: the past batches (the island filters and sorts them). */
export async function loadFieldBatchesSeed(
  sessionId: string | undefined,
  get: AuthedGet = ssrBackendGetAuthed,
): Promise<FieldBatchesSeed | null> {
  if (!sessionId) return null;
  const batches = await readList<BatchView>(get, "/field/batches", sessionId);
  return batches ? { batches } : null;
}

/**
 * /field/tasks: the day's round for `date` (else the business's day) + the unstaffed list
 * ([] when unreadable) + the crew (null when unreadable: the island fetches it).
 * The seed carries its date — REQ-940: with no date given it is the business's day, from the server.
 */
export async function loadFieldTasksSeed(
  sessionId: string | undefined,
  date: string | undefined,
  get: AuthedGet = ssrBackendGetAuthed,
): Promise<FieldTasksSeed | null> {
  if (!sessionId) return null;
  // REQ-940 — no day given: the business's day, from the server (GET /field/tasks/today)
  let today: string | undefined;
  if (!date) {
    try {
      const r = await get<{ date?: unknown }>("/field/tasks/today", sessionId);
      if (r.ok && typeof r.data?.date === "string") today = r.data.date;
    } catch { /* no seed */ }
    if (!today) return null;
    date = today;
  }
  const q = `?date=${encodeURIComponent(date)}`;
  const [tasks, skipped, workers] = await Promise.all([
    readList<TaskView>(get, `/field/tasks${q}`, sessionId),
    readList<GenerateResult["skipped"][number]>(
      get,
      `/field/tasks/unstaffed${q}`,
      sessionId,
    ),
    readList<FieldWorker>(get, "/field/workers", sessionId),
  ]);
  if (!tasks) return null;
  return {
    date,
    ...(today ? { today } : {}),
    tasks,
    skipped: skipped ?? [],
    workers,
  };
}
