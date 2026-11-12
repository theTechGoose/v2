/**
 * REQ-585 (demo-loop cycle 4, M4) — on the start-date card pair 7 typed "we
 * start monday nov 23. and I want a 50% deposit upfront… is 50% normal in
 * texas?" and got an answer to the Pick-a-price request she had made two
 * steps earlier: "The job details already say that — nothing changed. I
 * couldn't find a line called "Floor stays (LVP is new)" …" (fleet-6
 * stdout:226). Every earlier step turn rode along in the chat model's history
 * and gpt-4o-mini re-issued the old, already-applied request.
 *
 * appliedStepTurnIds: the earlier step-tagged turns whose request was applied
 * (a reply carried the step, or a quote / change-order / revision / terms
 * outcome) and those replies — left out of the history the model reads.
 */
import { assertEquals } from "#std/assert";
import { appliedStepTurnIds } from "./mod.ts";

type M = {
  id: string;
  role: "user" | "assistant" | "system";
  kind: string;
  content?: string;
  payload?: Record<string, unknown>;
};

const PAIR7: M[] = [
  { id: "u1", role: "user", kind: "text", content: "Henderson kitchen gut…" },
  {
    id: "u2",
    role: "user",
    kind: "text",
    content:
      "these seem low?? … take out the floor stays line … ¿y el depósito del 50% está bien?",
    payload: { step: "price" },
  },
  {
    id: "a2",
    role: "assistant",
    kind: "text",
    content:
      "Updated the job details: removed Floor stays (LVP is new). Re-priced — …",
    payload: { step: "price", scope: "Demo…" },
  },
  { id: "pd", role: "system", kind: "phase_divider" },
  {
    id: "w1",
    role: "assistant",
    kind: "wizard",
    payload: { stepId: "customer" },
  },
  {
    id: "p1",
    role: "user",
    kind: "text",
    content: "Customer: Carol Henderson",
    payload: { wizardStepId: "customer" },
  },
  {
    id: "w2",
    role: "assistant",
    kind: "wizard",
    payload: { stepId: "start_date" },
  },
  {
    id: "u3",
    role: "user",
    kind: "text",
    content: "we start monday nov 23. and I want a 50% deposit upfront…",
    payload: { step: "wizard", stepQuestion: "start_date" },
  },
];

Deno.test("REQ-585 M4 appliedStepTurnIds: pair 7's Pick-a-price request and its reply are left out on the start-date card; the job, the picks and the message itself stay", () => {
  assertEquals(appliedStepTurnIds(PAIR7, "u3"), new Set(["u2", "a2"]));
});

Deno.test("REQ-585 appliedStepTurnIds: a review-step change that landed (quote / change order / revision / terms outcome) is left out; one answered with a question stays", () => {
  const history: M[] = [
    { id: "u1", role: "user", kind: "text", content: "Kitchen gut" },
    {
      id: "r1",
      role: "user",
      kind: "text",
      content: "change the cabinet line to white shaker",
      payload: { step: "review" },
    },
    {
      id: "a1",
      role: "assistant",
      kind: "text",
      content: "Updated the job details …",
      payload: { quoteUpdated: "q-1" },
    },
    {
      id: "r2",
      role: "user",
      kind: "text",
      content: "add a permit $450",
      payload: { step: "review" },
    },
    {
      id: "a2",
      role: "assistant",
      kind: "text",
      content: "Added Plumbing permit ($450.00) …",
      payload: { changeOrder: { kind: "draft_updated" } },
    },
    {
      id: "r3",
      role: "user",
      kind: "text",
      content: "change the line price",
      payload: { step: "review" },
    },
    {
      id: "a3",
      role: "assistant",
      kind: "text",
      content: "Which line do you mean?",
    },
    {
      id: "r4",
      role: "user",
      kind: "text",
      content: "the cabinets, $9,000",
      payload: { step: "review" },
    },
  ];
  assertEquals(
    appliedStepTurnIds(history, "r4"),
    new Set(["r1", "a1", "r2", "a2"]),
  );
});

Deno.test("REQ-585 appliedStepTurnIds: untagged turns, cards and the message being answered are never left out", () => {
  const history: M[] = [
    { id: "u1", role: "user", kind: "text", content: "Fence repair $1,200" },
    {
      id: "c1",
      role: "assistant",
      kind: "action_card",
      content: "Fence repair",
      payload: { quoteId: "q-1" },
    },
    { id: "u2", role: "user", kind: "text", content: "add a gate $300" },
    {
      id: "a2",
      role: "assistant",
      kind: "text",
      content: "Added Gate ($300.00)…",
      payload: { changeOrder: { kind: "draft_updated" }, quoteUpdated: "q-1" },
    },
    {
      id: "u3",
      role: "user",
      kind: "text",
      content: "and a latch",
      payload: { step: "review" },
    },
  ];
  assertEquals(appliedStepTurnIds(history, "u3"), new Set());
});
