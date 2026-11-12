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
