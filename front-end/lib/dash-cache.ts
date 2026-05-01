/**
 * Shared client-side cache for the dashboard's snapshot state — the
 * `DashboardStats` and `ProfileSnapshot` rolls every authed page needs.
 *
 * Why this exists: each authed page mounts its own `DashSidebar`, which
 * means each route was firing its own `/profile` + `/analytics/dashboard`
 * pair on mount. The badges flickered between pages because nothing
 * replayed the last-known counts during the refetch (audit1 #20). With
 * `AsstChat` also wanting `stats.invoices.overdue` to gate its empty-state
 * chip (audit1 #27), it became cheaper to extract the primitive than to
 * re-implement it per-island.
 *
 * Surface:
 *   - `readCached()` — synchronous read of the last resolved snapshot
 *      (module-level cache, falling back to sessionStorage so a fresh
 *      tab navigation gets a warm start). Returns null on first ever load.
 *   - `refreshDash()` — async refetch. Single-flight: concurrent callers
 *      share the same in-flight Promise. Writes through to module + storage.
 *   - `subscribeDash(fn)` — fires whenever a refresh resolves. Used by
 *      late-mounting islands that want fresh data without re-fetching.
 */

import { dashboardClient, type DashboardStats } from "../clients/dashboard.ts";
import { profileClient, type ProfileSnapshot } from "../clients/profile.ts";

export interface CachedDash {
  stats: DashboardStats | null;
  profile: ProfileSnapshot | null;
}

const STORAGE_KEY = "pm:dash-cache:v1";
let cached: CachedDash | null = null;
let inflight: Promise<CachedDash> | null = null;
type Listener = (snap: CachedDash) => void;
const listeners = new Set<Listener>();

/** Underlying fetchers — swappable for tests so we don't need a live
 *  backend round-trip. Defaults pull from the real HTTP clients. */
interface Fetchers {
  stats: () => Promise<DashboardStats | null>;
  profile: () => Promise<ProfileSnapshot | null>;
}
const DEFAULT_FETCHERS: Fetchers = {
  stats:   () => dashboardClient.stats().catch(() => null as DashboardStats | null),
  profile: () => profileClient.get().catch(() => null as ProfileSnapshot | null),
};
let fetchers: Fetchers = DEFAULT_FETCHERS;

export function readCached(): CachedDash | null {
  if (cached) return cached;
  try {
    const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedDash;
    cached = parsed;
    return parsed;
  } catch {
    return null;
  }
}

function writeCached(snap: CachedDash) {
  cached = snap;
  try { globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(snap)); } catch { /* SSR / private mode */ }
  for (const fn of listeners) {
    try { fn(snap); } catch { /* listener errors must not poison other listeners */ }
  }
}

export function refreshDash(): Promise<CachedDash> {
  if (inflight) return inflight;
  inflight = (async () => {
    const [profile, stats] = await Promise.all([
      fetchers.profile(),
      fetchers.stats(),
    ]);
    const next: CachedDash = { stats, profile };
    writeCached(next);
    return next;
  })().finally(() => { inflight = null; });
  return inflight;
}

export function subscribeDash(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Test-only seam — clears module state and (optionally) replaces the
 *  underlying fetchers with stubs. Call with no args to reset to the real
 *  HTTP clients. Production code MUST NOT call this. */
export function _resetForTest(stub?: Partial<Fetchers>): void {
  cached = null;
  inflight = null;
  listeners.clear();
  try { globalThis.sessionStorage?.removeItem(STORAGE_KEY); } catch { /* */ }
  fetchers = stub
    ? { stats: stub.stats ?? DEFAULT_FETCHERS.stats, profile: stub.profile ?? DEFAULT_FETCHERS.profile }
    : DEFAULT_FETCHERS;
}
