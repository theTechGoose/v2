/**
 * REQ-602 (demo-loop cycle 4, issue M35) — where the office sidebar's
 * "Worker view" goes. /worker is the workers' own cell + PIN sign-in
 * (REQ-143); an account with no workers has nobody who can sign in there, so
 * the link sends the owner to /field/workers, where workers are added. While
 * the count is unknown (still loading, or the request failed) it stays /worker.
 */
export const WORKER_SCREEN_HREF = "/worker";
export const WORKERS_PAGE_HREF = "/field/workers";

export function workerViewHref(workerCount: number | null): string {
  return workerCount === 0 ? WORKERS_PAGE_HREF : WORKER_SCREEN_HREF;
}
