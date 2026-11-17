/**
 * REQ-605 (demo-loop cycle 4, issue m19) — the worker screen's refresh.
 *
 * /worker ran a fixed 5 s setInterval with no idle back-off, and every tick re-read
 * /field/worker/me, /field/worker/tasks and /field/worker/task-types — three requests every
 * 5 s although the worker and the task types rarely change. Now it polls through REQ-221's
 * scheduler with REQ-424's back-off (5 s while someone uses the page, doubling to a 60 s cap
 * while idle), and a tick reads only the tasks. The full read (me + tasks + task types) runs
 * on the catch-up after the tab was hidden; the island also runs it on login and on a
 * language pick.
 */
import { type Poll, type PollEnv, startPoll } from "./poll.ts";

export const WORKER_REFRESH_MS = 5_000;
export const WORKER_REFRESH_MAX_MS = 60_000;

export interface WorkerRefreshOptions {
  /** me + tasks + task types */
  full: () => unknown;
  /** the tasks only */
  tasks: () => unknown;
  /** the island's gate, read at every tick (signed in, nothing typed, not busy …) */
  due: () => boolean;
  /** test seam; defaults to the browser's */
  env?: Partial<PollEnv>;
}

/** start the worker screen's refresh; returns the stop function */
export function startWorkerRefresh(opts: WorkerRefreshOptions): Poll {
  const doc = opts.env && "doc" in opts.env
    ? opts.env.doc ?? null
    : (globalThis as { document?: PollEnv["doc"] }).document ?? null;
  /** the tab was hidden since the last full read: the next read is a full one */
  let stale = false;
  const onVisibility = () => {
    if (doc?.hidden) stale = true;
  };
  doc?.addEventListener("visibilitychange", onVisibility);

  const poll = startPoll(
    () => {
      if (!opts.due()) return;
      if (stale) {
        stale = false;
        return opts.full();
      }
      return opts.tasks();
    },
    WORKER_REFRESH_MS,
    { idleMaxMs: WORKER_REFRESH_MAX_MS, env: opts.env },
  );
  return Object.assign(() => {
    poll();
    doc?.removeEventListener("visibilitychange", onVisibility);
  }, { catchUp: poll.catchUp });
}
