import { assertEquals } from "@std/assert";
import { orderSendOutcomes } from "./send-cta-settled.ts";

/**
 * REQ-452 (demo-loop cycle 3, issue p8-pair7-b — "'Couldn't send' card
 * renders above a later message"): the send outcome is the send CTA
 * re-rendered ("Sent ✓" / "Couldn't send"), so it sat where the CTA was
 * created — above anything typed on the review step after it. A reviewed
 * CTA whose dispatch divider is in the thread is drawn at that divider,
 * i.e. by the send's own time.
 */

const cta = (id: string, toPhase = "send", quoteId = "q1") => ({
  id,
  kind: "continue_cta",
  payload: { toPhase, quoteId },
});
const text = (id: string, role = "user") => ({
  id,
  kind: "text",
  role,
  payload: {},
});
const divider = (id: string, payload: Record<string, unknown>) => ({
  id,
  kind: "phase_divider",
  payload: { phase: 3, quoteId: "q1", ...payload },
});
const ids = (xs: readonly { id: string }[]) => xs.map((x) => x.id);
const all = () => true;

Deno.test("REQ-452 p8-pair7-b: a failed send's card is drawn after the message typed on the review step, next to its divider", () => {
  const thread = [
    text("wiz-answer"),
    cta("cta"),
    text("fix-typed-12:12:36"),
    text("assistant-reply", "assistant"),
    divider("send-12:12:57", { emailFailureReason: "no email on file" }),
  ];
  assertEquals(ids(orderSendOutcomes(thread, all)), [
    "wiz-answer",
    "fix-typed-12:12:36",
    "assistant-reply",
    "cta",
    "send-12:12:57",
  ]);
});

Deno.test("REQ-452 p8-pair7-b: a successful send is ordered the same way", () => {
  const thread = [
    cta("cta"),
    text("t1"),
    divider("d", { emailedTo: "a@b.co" }),
  ];
  assertEquals(ids(orderSendOutcomes(thread, all)), ["t1", "cta", "d"]);
});

Deno.test("REQ-452 p8-pair7-b: a failed send then a later retry — the card sits at the LATEST outcome", () => {
  const thread = [
    cta("cta"),
    divider("d1", { emailFailureReason: "x" }),
    text("t1"),
    divider("d2", { emailedTo: "a@b.co" }),
    text("t2"),
  ];
  assertEquals(ids(orderSendOutcomes(thread, all)), [
    "d1",
    "t1",
    "cta",
    "d2",
    "t2",
  ]);
});

Deno.test("REQ-452 p8-pair7-b: an unreviewed CTA, or one with no outcome divider yet, keeps its place", () => {
  const thread = [
    cta("cta"),
    text("t1"),
    divider("d", { emailedTo: "a@b.co" }),
  ];
  assertEquals(ids(orderSendOutcomes(thread, () => false)), ["cta", "t1", "d"]);
  const noOutcome = [cta("cta"), text("t1"), divider("d2", { phase: 2 })];
  assertEquals(ids(orderSendOutcomes(noOutcome, all)), ["cta", "t1", "d2"]);
});

Deno.test("REQ-452 p8-pair7-b: a terms CTA is never moved; an invoice CTA follows its own outcome", () => {
  const thread = [
    cta("terms", "terms"),
    text("t1"),
    divider("d", { emailedTo: "a@b.co" }),
  ];
  assertEquals(ids(orderSendOutcomes(thread, all)), ["terms", "t1", "d"]);
  const inv = [
    cta("inv", "invoice"),
    text("t1"),
    divider("d", { textedTo: "+1" }),
  ];
  assertEquals(ids(orderSendOutcomes(inv, all)), ["t1", "inv", "d"]);
});

Deno.test("REQ-452 p8-pair7-b: a divider for another quote does not pull the card", () => {
  const thread = [
    cta("cta"),
    text("t1"),
    divider("other", { quoteId: "q2", emailedTo: "a@b.co" }),
  ];
  assertEquals(ids(orderSendOutcomes(thread, all)), ["cta", "t1", "other"]);
});

Deno.test("REQ-452 p8-pair7-b: an in-order thread is returned unchanged (same array)", () => {
  const thread = [
    text("t1"),
    cta("cta"),
    divider("d", { emailedTo: "a@b.co" }),
  ];
  assertEquals(orderSendOutcomes(thread, all), thread);
});
