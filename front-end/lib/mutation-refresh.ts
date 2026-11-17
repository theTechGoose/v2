/**
 * REQ-424 (demo cycle 2, p2 "heavy polling") — the topbar's refetch on `pm:mutated`.
 *
 * REQ-319 made every successful non-GET through lib/api re-fetch the notifications feed at once.
 * In a chat that is every message and every wizard answer: the demo saw `/api/notifications`
 * every 1–2 s on the assistant. Now:
 *   - a chat post (`/agents/*`) is not a business event and triggers nothing (the poll covers
 *     whatever the assistant did);
 *   - any other mutation refetches at once when the last refetch is MUTATION_REFRESH_GAP_MS or
 *     more ago, otherwise ONE trailing refetch runs when the gap is up, however many came in.
 */

/** the closest two mutation-driven refetches may be */
export const MUTATION_REFRESH_GAP_MS = 5_000;

/** what lib/api puts on `pm:mutated` */
export interface MutationDetail {
  method?: string;
  path?: string;
}

/** a chat post — the assistant's conversation and message endpoints */
export function isChatMutation(d: MutationDetail | undefined): boolean {
  return typeof d?.path === "string" && d.path.startsWith("/agents/");
}

type TimeoutId = ReturnType<typeof setTimeout> | number;

export interface CoalesceEnv {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => TimeoutId;
  clearTimeout: (id: TimeoutId) => void;
}

/** coalesce mutation-driven refetches of `run`; returns the handler and stop() */
export function coalescedRefresh(
  run: () => void,
  opts: { gapMs?: number; env?: Partial<CoalesceEnv> } = {},
): { onMutation: (d: MutationDetail | undefined) => void; stop: () => void } {
  const env: CoalesceEnv = {
    now: () => Date.now(),
    setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id) => globalThis.clearTimeout(id as number),
    ...opts.env,
  };
  const gap = opts.gapMs ?? MUTATION_REFRESH_GAP_MS;
  let last = -Infinity;
  let pending: TimeoutId | null = null;
  let stopped = false;

  const fire = () => {
    pending = null;
    if (stopped) return;
    last = env.now();
    run();
  };

  return {
    onMutation: (d) => {
      if (stopped || isChatMutation(d) || pending !== null) return;
      const wait = last + gap - env.now();
      if (wait <= 0) fire();
      else pending = env.setTimeout(fire, wait);
    },
    stop: () => {
      stopped = true;
      if (pending !== null) env.clearTimeout(pending);
      pending = null;
    },
  };
}
