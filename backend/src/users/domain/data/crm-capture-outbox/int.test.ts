/**
 * REQ-113 — found under the gate's load (REQ-111's story: "the exact stage reached — expected
 * '4 of 9 answered — next the state', got '1 of 9 answered — next the name'", 65 of 66 stories
 * green, no sweep warning in the server's log): the wizard's saves re-mark the account's sync
 * record while a sweep carries it (REQ-099 — a new enqueuedAt, the lease kept so the carrying
 * sweep's done() sees the change). done() wrote with a version check and returned silently when a
 * save landed between its read and its write — leaving the record re-marked AND leased for 90 s,
 * and nobody clears a lease but done(). defer() wrote blindly, so a save landing between its read
 * and its write was overwritten with the older mark. Both now read again and write again until
 * the write lands or the record is gone. KV in memory.
 */
import { assert, assertEquals } from "#std/assert";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { isDue } from "@users/domain/business/lead-capture-retry/mod.ts";
import { CrmCaptureOutbox } from "./mod.ts";

const t0 = Date.parse("2026-10-21T18:00:00.000Z");
const at = (ms: number) => new Date(t0 + ms).toISOString();

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  return new CrmCaptureOutbox();
}

/** the next atomic write this process makes loses its version check: `land` runs first — a save
 *  re-marking the record — and only then the stale write is committed, as it is under the gate's
 *  load when a sweep's write and a wizard's save cross */
async function crossed(kv: Deno.Kv, land: () => Promise<void>): Promise<() => void> {
  const atomic = kv.atomic.bind(kv);
  let once = false;
  kv.atomic = () => {
    const op = atomic();
    if (!once) {
      once = true;
      const commit = op.commit.bind(op);
      op.commit = async () => {
        await land();
        return await commit();
      };
    }
    return op;
  };
  return () => {
    kv.atomic = atomic;
  };
}

Deno.test("REQ-113 outbox — done() lands even when a save re-marks the record between its read and its write: the record stays for the next sweep, the lease cleared, the newer mark on it", async () => {
  const outbox = await fresh();
  await outbox.addSync("u-1", t0);
  const [rec] = await outbox.list();
  assert(await outbox.claim(rec, t0 + 1), "the sweep holds it");
  const kv = await getKv();
  const restore = await crossed(kv, () => outbox.addSync("u-1", t0 + 500));
  try {
    await outbox.done(rec);
  } finally {
    restore();
  }
  const [after] = await outbox.list();
  assertEquals(after.enqueuedAt, at(500), "the re-mark stands");
  assertEquals(after.leaseUntil, undefined, "the lease is cleared — the next sweep carries it");
  assert(isDue(after, t0 + 600), "due for the next sweep, not in 90 s");
});

Deno.test("REQ-113 outbox — done() for a record re-marked before its read clears the lease too, and a record nobody re-marked is gone", async () => {
  const outbox = await fresh();
  await outbox.addSync("u-2", t0);
  const [rec] = await outbox.list();
  assert(await outbox.claim(rec, t0 + 1));
  await outbox.addSync("u-2", t0 + 100); // the save lands before done() reads
  await outbox.done(rec);
  const [again] = await outbox.list();
  assertEquals([again.enqueuedAt, again.leaseUntil], [at(100), undefined]);
  await outbox.done(again);
  assertEquals(await outbox.list(), [], "carried as marked: gone");
});

Deno.test("REQ-113 outbox — defer() keeps a save that re-marks the record between its read and its write: the newer mark, one more attempt, the lease released", async () => {
  const outbox = await fresh();
  await outbox.addSync("u-3", t0);
  const [rec] = await outbox.list();
  assert(await outbox.claim(rec, t0 + 1));
  const kv = await getKv();
  const restore = await crossed(kv, () => outbox.addSync("u-3", t0 + 500));
  try {
    await outbox.defer(rec, t0 + 2, "the CRM did not answer");
  } finally {
    restore();
  }
  const [after] = await outbox.list();
  assertEquals([after.enqueuedAt, after.attempts, after.lastError], [at(500), 1, "the CRM did not answer"], "the newer mark, counted once");
  assertEquals(after.leaseUntil, undefined, "the lease is released with the deferral");
});

// ---- REQ-131 — the settle watch: a record of its own, carrying the pick the due was minted for ----
Deno.test("REQ-131 outbox — addSettleWatch is a record keyed apart from the pay link, carrying the due, the pick and a 48 h window; a re-mark restarts its clock and keeps a held lease; defer keeps the pick", async () => {
  const outbox = await fresh();
  const pick = { userId: "u-131", planId: "monster" as const, status: "pending" as const, chosenAt: at(0), updatedAt: at(0), merchant: "primary", customerId: "c-1", dueId: "d-99", payUrl: "http://crm/pay?due=d-99" };
  await outbox.addPayLink("u-131", "/settings", t0);
  await outbox.addSettleWatch("u-131", pick, t0);
  const recs = await outbox.list();
  assertEquals(recs.map((r) => r.kind), ["pay-link", "settle-watch"], "apart from the pay link, same account");
  const watch = recs.find((r) => r.kind === "settle-watch")!;
  assertEquals([watch.userId, watch.dueId, watch.pick?.planId, watch.attempts, watch.nextAt, watch.watchUntil], ["u-131", "d-99", "monster", 0, at(0), at(48 * 3_600_000)]);
  assert(isDue(watch, t0), "due at once");
  // held by a sweep, then re-marked (the person came back to /plan/return): the clock restarts, the lease stays
  assert(await outbox.claim(watch, t0));
  await outbox.addSettleWatch("u-131", pick, t0 + 60_000);
  const marked = (await outbox.list()).find((r) => r.kind === "settle-watch")!;
  assertEquals([marked.enqueuedAt, marked.attempts, marked.watchUntil, Boolean(marked.leaseUntil)], [at(60_000), 0, at(60_000 + 48 * 3_600_000), true]);
  // deferred (the due still open): the pick and the window ride along
  const deferred = await outbox.defer(marked, t0 + 61_000, "due still open");
  assertEquals([deferred.kind, deferred.dueId, deferred.pick?.dueId, deferred.watchUntil, deferred.attempts], ["settle-watch", "d-99", "d-99", marked.watchUntil, 1]);
  await outbox.done(deferred);
  assertEquals((await outbox.list()).map((r) => r.kind), ["pay-link"], "cleared on its own, the pay link untouched");
  await resetKv();
});

Deno.test("REQ-133 outbox — later() sets the watch's next look and drops the lease without counting an attempt; watchByDue finds the account's watch by the due it names", async () => {
  const outbox = await fresh();
  const pick = { userId: "u-133", planId: "monster" as const, status: "pending" as const, chosenAt: at(0), updatedAt: at(0), merchant: "primary", customerId: "c-1", dueId: "d-133", payUrl: "http://crm/pay?due=d-133" };
  await outbox.addSettleWatch("u-133", pick, t0);
  assertEquals(await outbox.watchByDue("d-nobody"), null);
  const found = await outbox.watchByDue("d-133");
  assertEquals([found?.userId, found?.kind, found?.dueId], ["u-133", "settle-watch", "d-133"]);
  assert(await outbox.claim(found!, t0));
  const held = await outbox.watchByDue("d-133");
  assert(held?.leaseUntil, "held");
  const next = await outbox.later(held!, t0 + 60_000);
  assertEquals([next.attempts, next.lastError, next.leaseUntil, next.nextAt, next.pick?.dueId], [0, undefined, undefined, at(60_000), "d-133"]);
  assertEquals((await outbox.watchByDue("d-133"))?.nextAt, at(60_000), "written");
  // a newer pick's watch re-points the due index; the old due finds nothing
  await outbox.addSettleWatch("u-133", { ...pick, dueId: "d-134", chosenAt: at(1) }, t0 + 1);
  assertEquals((await outbox.watchByDue("d-134"))?.dueId, "d-134");
  assertEquals(await outbox.watchByDue("d-133"), null, "the old due's watch is gone with the re-mark");
  await resetKv();
});
