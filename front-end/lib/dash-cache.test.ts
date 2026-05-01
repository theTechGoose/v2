import { assert, assertEquals } from "@std/assert";
import {
  type CachedDash,
  _resetForTest,
  readCached,
  refreshDash,
  subscribeDash,
} from "./dash-cache.ts";
import type { DashboardStats } from "../clients/dashboard.ts";
import type { ProfileSnapshot } from "../clients/profile.ts";

/**
 * Pins the cache primitive that powers the sidebar's no-flicker badges
 * (audit1 #20) and the assistant's overdue-chip gating (audit1 #27).
 * The behaviour the rest of the app relies on:
 *
 *   - readCached() returns the last-resolved snapshot synchronously
 *   - refreshDash() dedupes concurrent calls (single-flight) — every page
 *     mounting its own DashSidebar must NOT trigger N parallel fetches
 *   - subscribeDash() fires for every refresh resolution so a late-mounting
 *     island that called readCached() before the first refresh got an
 *     update once data lands
 *   - sessionStorage hydrates a fresh module load (full-page navigation in
 *     the same tab keeps badges populated)
 */

// --- Stub storage so the JSDOM-less Deno test runner has a place to write.
function installStubStorage() {
  const store = new Map<string, string>();
  // deno-lint-ignore no-explicit-any
  (globalThis as any).sessionStorage = {
    getItem:    (k: string) => store.get(k) ?? null,
    setItem:    (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
    clear:      () => { store.clear(); },
    get length() { return store.size; },
    key:        (i: number) => Array.from(store.keys())[i] ?? null,
  };
}
function uninstallStubStorage() {
  // deno-lint-ignore no-explicit-any
  delete (globalThis as any).sessionStorage;
}

// --- Fixtures
const SAMPLE_STATS: DashboardStats = {
  customers: 1,
  quotes:    { total: 0, draft: 0, sent: 0, accepted: 0 },
  contracts: { total: 0, draft: 0, signed: 0 },
  invoices:  { total: 0, pending: 0, paid: 0, overdue: 0,
                agingBuckets: { current: 0, aging1_14d: 0, overdue15_30d: 0, overdue30plus: 0 } },
  quotedValueCents: 0,
  awaitingResponse: 0,
  revenue:  { ytdCents: 0, lastMonthCents: 0, monthOverMonthPct: 0, sparkline12mo: [] },
  payments: { receivedYtdCents: 0, methodMixCents: {}, topPayors: [] },
};

const SAMPLE_PROFILE = {
  user: { id: "u-1", phoneNumber: "+15125550000", name: "Diego", createdAt: 0, updatedAt: 0 },
  identity: null, address: null, insurance: null, tax: null, contractDefaults: null,
  references: [], initials: "DI",
} as unknown as ProfileSnapshot;

Deno.test("dash-cache: readCached returns null before any refresh", () => {
  installStubStorage();
  try {
    _resetForTest({ stats: () => Promise.resolve(null), profile: () => Promise.resolve(null) });
    assertEquals(readCached(), null);
  } finally {
    uninstallStubStorage();
  }
});

Deno.test("dash-cache: refreshDash resolves and readCached returns the snapshot", async () => {
  installStubStorage();
  try {
    _resetForTest({
      stats:   () => Promise.resolve(SAMPLE_STATS),
      profile: () => Promise.resolve(SAMPLE_PROFILE),
    });
    const snap = await refreshDash();
    assertEquals(snap.stats, SAMPLE_STATS);
    assertEquals(snap.profile, SAMPLE_PROFILE);
    assertEquals(readCached(), snap);
  } finally {
    uninstallStubStorage();
  }
});

Deno.test("dash-cache: refreshDash dedupes concurrent callers (single-flight)", async () => {
  installStubStorage();
  try {
    let statsCalls = 0;
    let profileCalls = 0;
    _resetForTest({
      stats:   async () => { statsCalls++;   await Promise.resolve(); return SAMPLE_STATS; },
      profile: async () => { profileCalls++; await Promise.resolve(); return SAMPLE_PROFILE; },
    });
    // Three concurrent callers (sidebar mount, asst-chat mount, late island)
    const [a, b, c] = await Promise.all([refreshDash(), refreshDash(), refreshDash()]);
    // All three resolve to the SAME object reference (proves the inflight
    // Promise was reused, not just that values matched).
    assert(a === b);
    assert(b === c);
    assertEquals(statsCalls, 1);
    assertEquals(profileCalls, 1);
  } finally {
    uninstallStubStorage();
  }
});

Deno.test("dash-cache: subsequent refreshDash after resolution does fetch again", async () => {
  installStubStorage();
  try {
    let statsCalls = 0;
    _resetForTest({
      stats:   async () => { statsCalls++; await Promise.resolve(); return SAMPLE_STATS; },
      profile: () => Promise.resolve(SAMPLE_PROFILE),
    });
    await refreshDash();
    await refreshDash();    // not deduped because the first inflight settled
    assertEquals(statsCalls, 2);
  } finally {
    uninstallStubStorage();
  }
});

Deno.test("dash-cache: subscribeDash fires once per resolution with the fresh snapshot", async () => {
  installStubStorage();
  try {
    _resetForTest({
      stats:   () => Promise.resolve(SAMPLE_STATS),
      profile: () => Promise.resolve(SAMPLE_PROFILE),
    });
    const seen: CachedDash[] = [];
    const unsub = subscribeDash((s) => { seen.push(s); });
    await refreshDash();
    await refreshDash();
    assertEquals(seen.length, 2);
    assertEquals(seen[0].stats, SAMPLE_STATS);
    assertEquals(seen[1].profile, SAMPLE_PROFILE);
    unsub();
    await refreshDash();
    assertEquals(seen.length, 2);  // unsubscribed listener no longer fires
  } finally {
    uninstallStubStorage();
  }
});

Deno.test("dash-cache: a throwing listener does NOT poison the others", async () => {
  installStubStorage();
  try {
    _resetForTest({
      stats:   () => Promise.resolve(SAMPLE_STATS),
      profile: () => Promise.resolve(SAMPLE_PROFILE),
    });
    let healthyFired = 0;
    subscribeDash(() => { throw new Error("boom"); });
    subscribeDash(() => { healthyFired++; });
    await refreshDash();
    assertEquals(healthyFired, 1);
  } finally {
    uninstallStubStorage();
  }
});

Deno.test("dash-cache: writes to sessionStorage so a fresh module load gets a warm start", async () => {
  installStubStorage();
  try {
    _resetForTest({
      stats:   () => Promise.resolve(SAMPLE_STATS),
      profile: () => Promise.resolve(SAMPLE_PROFILE),
    });
    await refreshDash();
    // After resolution, sessionStorage holds the serialized snapshot under
    // the versioned key.
    const raw = globalThis.sessionStorage.getItem("pm:dash-cache:v1");
    assert(raw !== null, "expected sessionStorage to hold the snapshot");
    const parsed = JSON.parse(raw!);
    assertEquals(parsed.stats.customers, 1);
    assertEquals(parsed.profile.initials, "DI");
  } finally {
    uninstallStubStorage();
  }
});

Deno.test("dash-cache: readCached hydrates from sessionStorage on a cold module", () => {
  installStubStorage();
  try {
    // Pre-seed sessionStorage as if a previous tab had written it, then
    // reset the in-memory cache so readCached must reach into storage.
    const seeded: CachedDash = { stats: SAMPLE_STATS, profile: SAMPLE_PROFILE };
    globalThis.sessionStorage.setItem("pm:dash-cache:v1", JSON.stringify(seeded));
    // _resetForTest clears the storage too, so reset FIRST then seed.
    _resetForTest();
    globalThis.sessionStorage.setItem("pm:dash-cache:v1", JSON.stringify(seeded));
    const snap = readCached();
    assert(snap !== null);
    assertEquals(snap.stats?.customers, 1);
    assertEquals(snap.profile?.initials, "DI");
  } finally {
    uninstallStubStorage();
  }
});

Deno.test("dash-cache: readCached on garbage sessionStorage returns null (does not throw)", () => {
  installStubStorage();
  try {
    _resetForTest();
    globalThis.sessionStorage.setItem("pm:dash-cache:v1", "{ not valid json");
    assertEquals(readCached(), null);
  } finally {
    uninstallStubStorage();
  }
});

Deno.test("dash-cache: works with sessionStorage missing entirely (SSR / private mode)", async () => {
  // No installStubStorage() here — sessionStorage is undefined, mirroring
  // SSR or a private-mode browser. Cache must still function in-memory.
  uninstallStubStorage();
  _resetForTest({
    stats:   () => Promise.resolve(SAMPLE_STATS),
    profile: () => Promise.resolve(SAMPLE_PROFILE),
  });
  const snap = await refreshDash();
  assertEquals(snap.stats?.customers, 1);
  assertEquals(readCached(), snap);
});
