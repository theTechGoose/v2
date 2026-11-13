/**
 * REQ-602 (demo-loop cycle 4, issue M35) — where the office sidebar's
 * "Worker view" goes. /worker is the workers' own cell + PIN sign-in
 * (REQ-143); an account with no workers has nobody who can sign in there, so
 * the link sends the owner to /field/workers, where workers are added.
 *
 * REQ-739 (cycle 5, issue p18-3f) — the row says where it goes ("Add a
 * worker" when it opens /field/workers), and while the count is still loading
 * it has no href at all, so the href is set once instead of flipping from
 * /worker to /field/workers. A failed count ("unknown") keeps /worker.
 */
export const WORKER_SCREEN_HREF = "/worker";
export const WORKERS_PAGE_HREF = "/field/workers";

export function workerViewHref(workerCount: number | null): string {
  return workerCount === 0 ? WORKERS_PAGE_HREF : WORKER_SCREEN_HREF;
}

/** The sidebar's worker count: still loading, failed, or known. */
export type WorkerCountState = number | "loading" | "unknown";

export interface WorkerViewLink {
  /** null while the count loads — render a hidden placeholder, no link */
  href: string | null;
  labelKey: "nav.workerView" | "nav.addWorker";
  pending: boolean;
}

export function workerViewLink(state: WorkerCountState): WorkerViewLink {
  if (state === "loading") {
    return { href: null, labelKey: "nav.workerView", pending: true };
  }
  if (state === 0) {
    return {
      href: WORKERS_PAGE_HREF,
      labelKey: "nav.addWorker",
      pending: false,
    };
  }
  return {
    href: WORKER_SCREEN_HREF,
    labelKey: "nav.workerView",
    pending: false,
  };
}
