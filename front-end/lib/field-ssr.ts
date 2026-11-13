/**
 * REQ-730 (demo-loop cycle 5, issue c2-p13-p): the field routes read their
 * lists on the SSR side, so the first HTML already carries the rows instead
 * of a "Loading…" line that waits for hydration + a client fetch.
 */
import type {
  BatchView,
  FieldWorker,
  GenerateResult,
  RegionView,
  SubscriptionView,
  TaskView,
} from "../clients/field.ts";
import { ssrBackendGetAuthed } from "./backend-fetch.ts";

export interface FieldWorkersSeed {
  workers: FieldWorker[];
  regions: RegionView[];
}
export interface FieldAssignmentsSeed {
  regions: RegionView[];
  workers: FieldWorker[];
}
export interface FieldSubscriptionsSeed {
  subs: SubscriptionView[];
}
export interface FieldBatchesSeed {
  batches: BatchView[];
}
export interface FieldTasksSeed {
  date: string;
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
  const [workers, regions] = await Promise.all([
    readList<FieldWorker>(get, "/field/workers", sessionId),
    readList<RegionView>(get, "/field/regions", sessionId),
  ]);
  if (!workers) return null;
  return { workers, regions: regions ?? [] };
}

/** /field/assignments: the zones and the crew — both required, as the island's load() needs both. */
export async function loadFieldAssignmentsSeed(
  sessionId: string | undefined,
  get: AuthedGet = ssrBackendGetAuthed,
): Promise<FieldAssignmentsSeed | null> {
  if (!sessionId) return null;
  const [regions, workers] = await Promise.all([
    readList<RegionView>(get, "/field/regions", sessionId),
    readList<FieldWorker>(get, "/field/workers", sessionId),
  ]);
  if (!regions || !workers) return null;
  return { regions, workers };
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
 * /field/tasks: the day's round for `date` (required) + the unstaffed list
 * ([] when unreadable) + the crew (null when unreadable: the island fetches it).
 * The seed carries its date — the island uses it only when the browser's day matches.
 */
export async function loadFieldTasksSeed(
  sessionId: string | undefined,
  date: string,
  get: AuthedGet = ssrBackendGetAuthed,
): Promise<FieldTasksSeed | null> {
  if (!sessionId) return null;
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
  return { date, tasks, skipped: skipped ?? [], workers };
}
