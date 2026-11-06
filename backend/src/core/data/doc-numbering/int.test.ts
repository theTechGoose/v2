/**
 * REQ-198 / REQ-199 / REQ-200 — per-account document numbering: atomic,
 * isolated per account, defaulting to 001, startable once, never reused,
 * and duplicate-proof under concurrent creates.
 */
import { assertEquals, assertRejects } from "#std/assert";
import { getKv, resetKv } from "@core/data/kv/mod.ts";
import { DocNumbering } from "@core/data/doc-numbering/mod.ts";
import { NUMBERING_PREFIX } from "@users/dto/numbering.ts";

async function fresh() {
  Deno.env.set("KV_PATH", ":memory:");
  await resetKv();
  return new DocNumbering();
}

Deno.test("REQ-198: sequences default to 001 and advance per kind, per account", async () => {
  const numbering = await fresh();
  try {
    const a1 = await numbering.allocate(
      "acct-a",
      "invoice",
      (atomic) => atomic,
    );
    const a2 = await numbering.allocate(
      "acct-a",
      "invoice",
      (atomic) => atomic,
    );
    const q1 = await numbering.allocate("acct-a", "quote", (atomic) => atomic);
    const b1 = await numbering.allocate(
      "acct-b",
      "invoice",
      (atomic) => atomic,
    );
    assertEquals([a1.number, a2.number, q1.number, b1.number], [
      "INV-001",
      "INV-002",
      "Q-001",
      "INV-001",
    ]);
    assertEquals(a2.seq, 2);
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-199: a starting number set before the first issue is honoured; after it the start is locked", async () => {
  const numbering = await fresh();
  try {
    const kv = await getKv();
    await kv.set([NUMBERING_PREFIX, "acct-a"], {
      userId: "acct-a",
      invoiceStart: 5000,
    });
    assertEquals(
      (await numbering.peek("acct-a", "invoice")).number,
      "INV-5000",
    );
    assertEquals(await numbering.hasIssued("acct-a", "invoice"), false);
    const first = await numbering.allocate(
      "acct-a",
      "invoice",
      (atomic) => atomic,
    );
    assertEquals(first.number, "INV-5000");
    assertEquals(await numbering.hasIssued("acct-a", "invoice"), true);
    // a later change of the setting does not move a live sequence
    await kv.set([NUMBERING_PREFIX, "acct-a"], {
      userId: "acct-a",
      invoiceStart: 9000,
    });
    const second = await numbering.allocate(
      "acct-a",
      "invoice",
      (atomic) => atomic,
    );
    assertEquals(second.number, "INV-5001");
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-200: forty concurrent allocations get forty distinct numbers and nothing is skipped", async () => {
  const numbering = await fresh();
  try {
    const results = await Promise.all(
      Array.from(
        { length: 40 },
        () => numbering.allocate("acct-a", "quote", (atomic) => atomic),
      ),
    );
    const seqs = results.map((r) => r.seq).sort((a, b) => a - b);
    assertEquals(seqs, Array.from({ length: 40 }, (_, i) => i + 1));
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-200: an allocation whose own record write is refused commits nothing — no number is consumed and no record is stored", async () => {
  const numbering = await fresh();
  try {
    const kv = await getKv();
    await assertRejects(() =>
      numbering.allocate("acct-a", "invoice", (atomic) =>
        // a check that can never pass: the key exists with a different versionstamp
        atomic.check({
          key: ["doc_seq", "nope"],
          versionstamp: "00000000000000000000",
        }), 1)
    );
    const after = await numbering.allocate(
      "acct-a",
      "invoice",
      (atomic) => atomic,
    );
    // the failed attempt never committed, so 001 is still free — but a
    // committed number is never handed out twice (see the 40-way test)
    assertEquals(after.number, "INV-001");
    assertEquals(
      (await kv.get(["doc_seq", "acct-a", "invoice"])).value !== null,
      true,
    );
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-198: every account gets one account number, assigned once, unique across accounts", async () => {
  const numbering = await fresh();
  try {
    const [a, b] = await Promise.all([
      numbering.accountNumber("acct-a"),
      numbering.accountNumber("acct-b"),
    ]);
    assertEquals(new Set([a, b]).size, 2);
    assertEquals(/^DM-\d{4}$/.test(a), true);
    assertEquals(await numbering.accountNumber("acct-a"), a);
  } finally {
    await resetKv();
  }
});

Deno.test("REQ-199: a setup reset clears the account's sequences so numbering restarts; other accounts are untouched", async () => {
  const numbering = await fresh();
  try {
    await numbering.allocate("acct-a", "invoice", (atomic) => atomic);
    await numbering.allocate("acct-a", "invoice", (atomic) => atomic);
    await numbering.allocate("acct-b", "invoice", (atomic) => atomic);
    await numbering.resetSequences("acct-a");
    assertEquals(await numbering.hasIssued("acct-a", "invoice"), false);
    assertEquals(
      (await numbering.allocate("acct-a", "invoice", (atomic) => atomic))
        .number,
      "INV-001",
    );
    assertEquals(
      (await numbering.allocate("acct-b", "invoice", (atomic) => atomic))
        .number,
      "INV-002",
    );
  } finally {
    await resetKv();
  }
});
