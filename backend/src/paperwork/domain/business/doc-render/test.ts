/**
 * REQ-949 (LOOP-007 q1, q1-25) — a change order names its invoice only when
 * that invoice has been issued. A draft or scheduled balance invoice is one
 * the customer never received, so "CO-001 on INV-002" points them at a
 * document they have never seen.
 */
import { assert, assertEquals } from "#std/assert";
import { applyRevision } from "#documents/versions.ts";
import { changeOrderRef, isIssued } from "./mod.ts";

const co = { id: "co-1", number: "CO-001" };

Deno.test("REQ-949 changeOrderRef: a SENT invoice is named — 'CO-001 on INV-002' (REQ-204 kept)", () => {
  const sent = {
    id: "inv-2",
    number: "INV-002",
    status: "sent",
    sentAt: "2026-11-01T12:00:00Z",
  };
  assertEquals(changeOrderRef(co, sent, "en"), "CO-001 on INV-002");
});

for (const status of ["scheduled", "draft"]) {
  Deno.test(`REQ-949 changeOrderRef: a ${status.toUpperCase()} invoice never sent is not named`, () => {
    const unsent = { id: "inv-2", number: "INV-002", status };
    for (const lang of ["en", "es"] as const) {
      const ref = changeOrderRef(co, unsent, lang);
      assert(
        !ref.includes("INV-002"),
        `${lang}: an unsent ${status} invoice must not be cited, got "${ref}"`,
      );
      assert(
        ref.includes("CO-001"),
        `${lang}: still names CO-001, got "${ref}"`,
      );
    }
  });
}

// REQ-1100 (LOOP-007 q3, q3-25): the customer's approval of a change order on
// the SCHEDULED balance INV-002 lands through `publishRevision` →
// `applyRevision`, which stamps publishedAt + version 2 and leaves the status
// "scheduled". That revision did not send the invoice: it is still an unsent
// final-balance bill the customer never received, so it is not "issued" and
// the change order must not name it.
const scheduledBalance: {
  id: string;
  userId: string;
  number: string;
  status: string;
  amount: number;
  publishedAt?: string;
  version?: number;
} = {
  id: "inv-2",
  userId: "u-1",
  number: "INV-002",
  status: "scheduled",
  amount: 451_535,
};
const revised = applyRevision(
  scheduledBalance,
  { amount: 566_535 },
  { customer: true, name: "Maria Lopez" } as never,
  "2026-11-19T15:00:00Z",
).next;

Deno.test("REQ-1100 isIssued: a SCHEDULED balance invoice revised by a change-order approval (publishedAt set, version 2) is still not issued", () => {
  assertEquals(revised.status, "scheduled", "the revision keeps it scheduled");
  assert(revised.publishedAt, "applyRevision stamped publishedAt");
  assertEquals(
    isIssued(revised),
    false,
    `a scheduled invoice the customer never received reads as issued: ${
      JSON.stringify({
        status: revised.status,
        version: revised.version,
        publishedAt: revised.publishedAt,
      })
    }`,
  );
  for (const status of ["scheduled", "draft"]) {
    assertEquals(
      isIssued({ status, publishedAt: "2026-11-19T15:00:00Z" }),
      false,
      `status ${status} with publishedAt must not count as issued`,
    );
  }
});

Deno.test("REQ-1100 changeOrderRef: after the approval revision, the scheduled INV-002 is still not named — the job Q-001 is", () => {
  const job = { id: "q-1", number: "Q-001" };
  for (const lang of ["en", "es"] as const) {
    const ref = changeOrderRef(co, revised, lang, job);
    assert(
      !ref.includes("INV-002"),
      `${lang}: the receipt names the unsent scheduled INV-002, got "${ref}"`,
    );
    assert(ref.includes("Q-001"), `${lang}: names the job Q-001, got "${ref}"`);
  }
});
