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
import { langChoiceMark, langSignal, setLang } from "./i18n.ts";

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
  stats: () =>
    dashboardClient.stats().catch(() => null as DashboardStats | null),
  profile: () =>
    profileClient.get().catch(() => null as ProfileSnapshot | null),
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

function persist(snap: CachedDash) {
  try {
    globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(snap));
  } catch { /* SSR / private mode */ }
}

/** Copy of `snap` whose profile says `lang` (the snapshot is never mutated). */
function withLanguage(snap: CachedDash, lang: "en" | "es"): CachedDash {
  const user = snap.profile?.user;
  if (!user || user.language === lang) return snap;
  return {
    ...snap,
    profile: { ...snap.profile!, user: { ...user, language: lang } },
  };
}

/** REQ-592 (demo-loop cycle 4, m5): the page's explicit `?lang=`, or null.
 *  lib/lang.ts seeds the UI from it at load and the topbar toggle writes it
 *  back (writeLangToUrl), so it is the user's choice for this page. */
function urlLangChoice(): "en" | "es" | null {
  try {
    const search = (globalThis as { location?: { search?: string } })
      .location?.search;
    const v = search ? new URLSearchParams(search).get("lang") : null;
    return v === "en" || v === "es" ? v : null;
  } catch {
    return null;
  }
}

/** `choiceMarkAtStart` is `langChoiceMark()` when the read was issued. */
function writeCached(
  snap: CachedDash,
  choiceMarkAtStart: number,
): CachedDash {
  const plang = snap.profile?.user?.language;
  if (plang === "en" || plang === "es") {
    if (urlLangChoice()) {
      // REQ-592 (m5): a page opened with ?lang= keeps that language — the
      // profile's `user.language` (an es staff account on /admin?lang=en)
      // must not flip it on the mount read or a later PROFILE_UPDATED one.
    } else if (langChoiceMark() === choiceMarkAtStart) {
      // Seed the app's UI language from the server's source of truth so every
      // island reading langSignal renders in the contractor's chosen language.
      setLang(plang, { fromServer: true });
    } else {
      // REQ-422 (m48): the user picked a language while this read was in
      // flight — its `user.language` predates that pick (the PUT is still on
      // its way). Keep the local choice, and keep the cache saying it too.
      snap = withLanguage(snap, langSignal.value);
    }
  }
  cached = snap;
  persist(snap);
  for (const fn of listeners) {
    try {
      fn(snap);
    } catch { /* listener errors must not poison other listeners */ }
  }
  return snap;
}

export function refreshDash(): Promise<CachedDash> {
  if (inflight) return inflight;
  inflight = (async () => {
    const choiceMark = langChoiceMark();
    const [profile, stats] = await Promise.all([
      fetchers.profile(),
      fetchers.stats(),
    ]);
    return writeCached({ stats, profile }, choiceMark);
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

/** REQ-422 (m48): optimistic write for a local language toggle — the cached
 *  profile (and its sessionStorage copy) says the new language at once, before
 *  the best-effort `PUT /me` lands, so nothing reading the cache sees the old
 *  one. Listeners are not fired: the language signal already changed. */
export function patchCachedLanguage(lang: "en" | "es"): void {
  const snap = readCached();
  if (!snap) return;
  cached = withLanguage(snap, lang);
  persist(cached);
}

export function subscribeDash(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Test-only seam — clears module state and (optionally) replaces the
 *  underlying fetchers with stubs. Call with no args to reset to the real
 *  HTTP clients. Production code MUST NOT call this. */
export function _resetForTest(stub?: Partial<Fetchers>): void {
  cached = null;
  inflight = null;
  listeners.clear();
  try {
    globalThis.sessionStorage?.removeItem(STORAGE_KEY);
  } catch { /* */ }
  fetchers = stub
    ? {
      stats: stub.stats ?? DEFAULT_FETCHERS.stats,
      profile: stub.profile ?? DEFAULT_FETCHERS.profile,
    }
    : DEFAULT_FETCHERS;
}
