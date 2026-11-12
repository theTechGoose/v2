import { assert, assertEquals } from "@std/assert";
import { hiddenOnReloadIds } from "./thread-reload-prune.ts";

/**
 * REQ-318 (demo issue m50, cycle 1): after a reload the thread must look
 * the way it looked live. "Lock it in" drops the draft card locally and
 * answering "Business / Person" drops that CTA locally, but the server
 * keeps both messages, so a reload used to bring back a dimmed
 * "Superseded" draft card and the live Business/Person buttons.
 */

const draft = (id: string, quoteId: string) => ({
  id,
  kind: "action_card",
  payload: { actionType: "quote", status: "draft", quoteId },
});
const locked = (id: string, quoteId: string, status = "locked") => ({
  id,
  kind: "action_card",
  payload: { actionType: "quote", status, quoteId },
});
const termsCta = (id: string, quoteId: string) => ({
  id,
  kind: "continue_cta",
  payload: { toPhase: "terms", quoteId },
});
const sendCta = (id: string, quoteId: string) => ({
  id,
  kind: "continue_cta",
  payload: { toPhase: "send", quoteId },
});
const divider = (id: string, phase: number) => ({
  id,
  kind: "phase_divider",
  payload: { phase, label: `Phase ${phase}` },
});
const wizard = (id: string, stepId: string) => ({
  id,
  kind: "wizard",
  payload: { stepId },
});
const text = (id: string) => ({ id, kind: "text", payload: {} });

Deno.test("REQ-318 m50: a draft card followed by its locked card is hidden on reload (not dimmed)", () => {
  const ids = hiddenOnReloadIds([
    text("t1"),
    draft("d1", "q1"),
    text("t2"),
    locked("l1", "q1"),
    termsCta("c1", "q1"),
  ]);
  assert(ids.has("d1"), "the superseded draft card is hidden");
  assert(!ids.has("l1"), "the locked card stays");
  assert(!ids.has("c1"), "an unanswered terms CTA keeps its buttons");
});

Deno.test("REQ-318 m50: a draft card for another quote, or with no later lock, stays visible", () => {
  const ids = hiddenOnReloadIds([
    draft("d1", "q1"),
    locked("l2", "q2"),
    draft("d3", "q3"),
  ]);
  assertEquals([...ids], []);
});

Deno.test("REQ-318 m50: the answered Business/Person CTA is hidden once the terms phase was entered", () => {
  const ids = hiddenOnReloadIds([
    locked("l1", "q1"),
    termsCta("c1", "q1"),
    divider("p2", 2),
    wizard("w1", "customer"),
  ]);
  assert(ids.has("c1"), "answered terms CTA is hidden");
  assert(!ids.has("p2") && !ids.has("w1"), "the divider and wizard stay");
});

Deno.test("REQ-318 m50: a later wizard step alone (older thread without a divider) also counts as answered", () => {
  const ids = hiddenOnReloadIds([
    termsCta("c1", "q1"),
    wizard("w1", "customer"),
  ]);
  assertEquals([...ids], ["c1"]);
});

Deno.test("REQ-318 m50: a re-lock retires the earlier terms CTA; only the newest one is live", () => {
  const ids = hiddenOnReloadIds([
    locked("l1", "q1"),
    termsCta("c1", "q1"),
    locked("l2", "q1"),
    termsCta("c2", "q1"),
  ]);
  assertEquals([...ids], ["c1"]);
});

Deno.test("REQ-318 m50: send CTAs and dividers before the CTA are never affected", () => {
  const ids = hiddenOnReloadIds([
    divider("p2", 2),
    sendCta("s1", "q1"),
    divider("p3", 3),
    termsCta("c1", "q1"),
  ]);
  assertEquals([...ids], []);
});

Deno.test("REQ-318 m50: AsstChat applies the rule to the rendered thread", async () => {
  const src = await Deno.readTextFile(
    new URL("../islands/AsstChat.tsx", import.meta.url),
  );
  assert(
    src.includes('from "../lib/thread-reload-prune.ts"'),
    "AsstChat imports hiddenOnReloadIds",
  );
  assert(
    /const hiddenOnReload = hiddenOnReloadIds\(messages\)/.test(src) &&
      /if \(hiddenOnReload\.has\(m\.id\)\) return false;/.test(src),
    "the visible-messages filter drops the hidden ids",
  );
});
