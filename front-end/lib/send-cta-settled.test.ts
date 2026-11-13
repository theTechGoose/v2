import { assertEquals } from "@std/assert";
import { settledSendCtaIds } from "./send-cta-settled.ts";

/**
 * REQ-244 (demo issue quote-invoice-money-m5): the assistant's "reviewed"
 * state for a send CTA must be rebuilt from the persisted thread, not live
 * only in memory. Otherwise every full page load re-opens the editable
 * quote review over an already-sent (or signed) quote and hides the
 * message box.
 */

const cta = (id: string, quoteId?: string, toPhase = "send") => ({
  id,
  kind: "continue_cta",
  payload: { toPhase, ...(quoteId ? { quoteId } : {}) },
});
const divider = (id: string, phase: number, quoteId?: string) => ({
  id,
  kind: "phase_divider",
  payload: { phase, ...(quoteId ? { quoteId } : {}) },
});
const text = (id: string) => ({ id, kind: "text", payload: {} });

Deno.test("REQ-244: a send CTA followed by the 'sent' divider (phase 3) is settled after a reload", () => {
  const ids = settledSendCtaIds([
    text("t1"),
    cta("c1", "q1"),
    divider("d1", 3, "q1"),
  ]);
  assertEquals([...ids], ["c1"]);
});

Deno.test("REQ-244: a send CTA followed by the 'accepted' divider (phase 4) is settled after signing", () => {
  const ids = settledSendCtaIds([cta("c1", "q1"), divider("d4", 4, "q1")]);
  assertEquals([...ids], ["c1"]);
});

Deno.test("REQ-244: a send CTA with no later dispatch divider is NOT settled — the review still auto-opens", () => {
  const ids = settledSendCtaIds([
    divider("d2", 2), // terms hand-off comes BEFORE the CTA
    cta("c1", "q1"),
  ]);
  assertEquals(ids.size, 0);
});

Deno.test("REQ-244: a terms divider (phase 2) after the CTA does not settle it", () => {
  const ids = settledSendCtaIds([cta("c1", "q1"), divider("d2", 2, "q1")]);
  assertEquals(ids.size, 0);
});

Deno.test("REQ-244: a divider for a different quote does not settle the CTA", () => {
  const ids = settledSendCtaIds([cta("c1", "q1"), divider("d3", 3, "q2")]);
  assertEquals(ids.size, 0);
});

Deno.test("REQ-244: a divider before the CTA does not settle a later CTA (rewind → new CTA re-opens)", () => {
  const ids = settledSendCtaIds([
    cta("c1", "q1"),
    divider("d3", 3, "q1"),
    cta("c2", "q1"),
  ]);
  assertEquals([...ids], ["c1"]);
});

Deno.test("REQ-244: missing quoteId on either side still matches (older threads)", () => {
  assertEquals([...settledSendCtaIds([cta("c1"), divider("d3", 3, "q1")])], [
    "c1",
  ]);
  assertEquals([...settledSendCtaIds([cta("c1", "q1"), divider("d3", 3)])], [
    "c1",
  ]);
});

Deno.test("REQ-244: an accepted quote settles its send CTAs even without a divider in the thread", () => {
  const ids = settledSendCtaIds([cta("c1", "q1")], {
    id: "q1",
    status: "accepted",
  });
  assertEquals([...ids], ["c1"]);
});

Deno.test("REQ-244: a merely 'sent' quote status does not settle the CTA (LockQuote stamps sent before the wizard)", () => {
  const ids = settledSendCtaIds([cta("c1", "q1")], {
    id: "q1",
    status: "sent",
  });
  assertEquals(ids.size, 0);
});

Deno.test("REQ-244: non-send CTAs are never reported", () => {
  const ids = settledSendCtaIds([
    cta("c1", "q1", "terms"),
    divider("d3", 3, "q1"),
  ]);
  assertEquals(ids.size, 0);
});

/**
 * REQ-339 (demo-loop cycle 1, issue p2 "Chat timestamps a minute early"):
 * the "Quote + Agreement sent — emailed to …" card is the send CTA
 * re-rendered in its sent state, so its time must be the dispatch time
 * (the phase-3 divider's createdAt), not the moment the wizard finished.
 */
import { sentCtaTimestamp } from "./send-cta-settled.ts";

const stamped = <T extends { id: string }>(m: T, createdAt: number) => ({
  ...m,
  createdAt,
});
const T_CTA = Date.UTC(2026, 10, 12, 5, 32, 10);
const T_SENT = Date.UTC(2026, 10, 12, 5, 33, 57);

Deno.test("REQ-339: a sent CTA stamps the phase-3 divider's time, not its own", () => {
  const c = stamped(cta("c1", "q1"), T_CTA);
  const t = sentCtaTimestamp(
    [
      stamped(text("t1"), T_CTA - 1),
      c,
      stamped(divider("d3", 3, "q1"), T_SENT),
    ],
    c,
  );
  assertEquals(t, T_SENT);
});

Deno.test("REQ-339: a CTA not yet sent keeps its own time", () => {
  const c = stamped(cta("c1", "q1"), T_CTA);
  assertEquals(sentCtaTimestamp([c], c), T_CTA);
  assertEquals(
    sentCtaTimestamp([c, stamped(divider("d2", 2, "q1"), T_SENT)], c),
    T_CTA,
  );
});

Deno.test("REQ-339: a divider for another quote, or one before the CTA, is not the send time", () => {
  const c = stamped(cta("c1", "q1"), T_CTA);
  assertEquals(
    sentCtaTimestamp([c, stamped(divider("d3", 3, "q2"), T_SENT)], c),
    T_CTA,
  );
  assertEquals(
    sentCtaTimestamp([stamped(divider("d3", 3, "q1"), T_CTA - 5000), c], c),
    T_CTA,
  );
});

Deno.test("REQ-339: a failed send then a successful retry stamps the retry (latest dispatch wins)", () => {
  const c = stamped(cta("c1", "q1"), T_CTA);
  const retry = T_SENT + 120_000;
  const t = sentCtaTimestamp(
    [
      c,
      stamped(divider("d3a", 3, "q1"), T_SENT),
      stamped(divider("d3b", 3, "q1"), retry),
    ],
    c,
  );
  assertEquals(t, retry);
});

Deno.test("REQ-339: an accepted quote with no divider in the thread falls back to the CTA's time", () => {
  const c = stamped(cta("c1", "q1"), T_CTA);
  assertEquals(
    sentCtaTimestamp([c], c, { id: "q1", status: "accepted" }),
    T_CTA,
  );
});

/**
 * REQ-668 (demo-loop cycle 5, issue m66 "A sent message's timestamp changed
 * from 7:21 to 7:23"): the sent card showed 7:21 when sent, then 7:23 once
 * the customer signed — sentCtaTimestamp took the LAST divider with
 * phase >= 3, and AcceptQuote appends a phase-4 acceptance divider. The send
 * time is only ever a send divider's (phase 3); the signing time is not.
 */
Deno.test("REQ-668: the customer's phase-4 acceptance divider does not restamp the sent card", () => {
  const c = stamped(cta("c1", "q1"), T_CTA);
  const T_SIGNED = T_SENT + 120_000;
  const t = sentCtaTimestamp(
    [
      c,
      stamped(divider("d3", 3, "q1"), T_SENT),
      stamped(text("t2"), T_SENT + 1000),
      stamped(divider("d4", 4, "q1"), T_SIGNED),
    ],
    c,
    { id: "q1", status: "accepted", acceptedAt: "2026-11-12T05:35:57Z" },
  );
  assertEquals(t, T_SENT);
});

Deno.test("REQ-668: an acceptance divider alone (no send divider) is not a send time", () => {
  const c = stamped(cta("c1", "q1"), T_CTA);
  assertEquals(
    sentCtaTimestamp([c, stamped(divider("d4", 4, "q1"), T_SENT)], c),
    T_CTA,
  );
});
