/**
 * REQ-1026 (LOOP-007 cycle 2, q2-5) — publishing a revision of a DECLINED
 * quote reopens it. Raphael: "test every single aspect of this application …
 * one Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green."
 *
 * The decline alert (REQ-948) tells the contractor "revise the quote and send
 * it again". In the demo, Q-002 was declined, Version 2 was published and the
 * customer was texted "Q-002 · Versión 2 está lista" — but /q read "Versión 2 ·
 * Rechazada" with nowhere to sign: applyRevision spreads the old record, so
 * status "lost", lostAt and the decline reason carried into Version 2.
 *
 * The store's publishRevision is the one write both publish paths use
 * (POST /quotes/:id/publish and the send path's publishPendingQuote), so it
 * is the unit under test.
 */
import { assert, assertEquals } from "#std/assert";
import { QuoteStore } from "./mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { publishPendingQuote } from "@paperwork/domain/business/publish-pending/mod.ts";
import { quoteState } from "#documents/versions.ts";
import { deriveQuoteView } from "#quote-flow/public-doc-state.ts";

const LINES = [
  { description: "Roof tear-off", quantity: 1, unit: "job", price: 900_000 },
];
const REVISED = [
  ...LINES,
  { description: "Gutter guards", quantity: 1, unit: "job", price: 120_000 },
];

/** a sent quote the customer declined, with a revision waiting to publish */
async function declinedWithPending(store: QuoteStore) {
  const q = await store.create("u-1", {
    summary: "Roof replacement",
    lineItems: LINES,
    estimatedTotal: 900_000,
  });
  await store.update(q.id, "u-1", {
    status: "sent",
    sentAt: "2026-11-19T09:00:00.000Z",
  });
  await store.update(q.id, "u-1", {
    status: "lost",
    lostAt: "2026-11-19T10:00:00.000Z",
    declineReason: "price",
    declineNote: "Too expensive",
    declinedName: "Jorge Ruiz",
  });
  await store.setPending(q.id, "u-1", {
    lineItems: REVISED,
    estimatedTotal: 1_020_000,
  });
  const before = await store.getOwned(q.id, "u-1");
  assertEquals(before.status, "lost", "setup: Version 1 is declined");
  assert(before.pendingRevision, "setup: a revision is pending");
  return before;
}

function assertReopened(v2: Record<string, unknown>) {
  assertEquals(v2.version, 2, "Version 2 is the live one");
  assertEquals(
    v2.status,
    "sent",
    "a published revision of a declined quote is open again, not still 'lost'",
  );
  assertEquals(v2.lostAt, undefined, "Version 2 carries no lostAt");
  assertEquals(v2.declineReason, undefined, "nor Version 1's decline reason");
  assertEquals(v2.declineNote, undefined, "nor Version 1's decline note");
  assertEquals(v2.declinedName, undefined, "nor who declined Version 1");
  assertEquals(
    quoteState(v2 as never),
    "revised",
    "the headline reads 'Versión 2 · Revisada', not 'Rechazada'",
  );
  const view = deriveQuoteView({
    ...(v2 as object),
    customer: { name: "Jorge Ruiz" },
  } as never);
  assertEquals(view.mode, "open", "/q offers Version 2 for signing");
  assertEquals(view.pendingSignature, true, "FIRMA AQUÍ is shown");
}

Deno.test("REQ-1026 (LOOP-007 q2-5) quote-store: publishing a revision of a declined quote reopens it — Version 2 is 'sent', no lostAt/decline fields, state 'revised', /q view 'open'", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new QuoteStore();
  const q = await declinedWithPending(store);
  const v2 = await store.publishRevision(q.id, "u-1", q.pendingRevision!, {
    userId: "u-1",
  });
  assertReopened(v2 as unknown as Record<string, unknown>);
  // the stored row agrees with the returned one
  assertReopened(
    (await store.getOwned(q.id, "u-1")) as unknown as Record<string, unknown>,
  );
  // history keeps the declined Version 1
  const filed = await store.listVersions(q.id, "u-1");
  assertEquals(filed.length, 1);
  assertEquals(filed[0].version, 1);
  assertEquals((filed[0].content as { status?: string }).status, "lost");
});

Deno.test("REQ-1026 (LOOP-007 q2-5) publish-pending: the send path (publishPendingQuote) reopens a declined quote the same way", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  const store = new QuoteStore();
  const q = await declinedWithPending(store);
  const v2 = await publishPendingQuote(store, q.id, "u-1");
  assertReopened(v2 as unknown as Record<string, unknown>);
});
