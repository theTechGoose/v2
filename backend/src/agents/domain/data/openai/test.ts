/**
 * REQ-444 (demo-loop cycle 3, M21) — OpenAILLMClient.respond honoured only
 * the FIRST tool call of a turn ("the rest are dropped"). A Ready-to-send
 * message that fixed the Spanish job details AND added a $450 permit needs
 * update_job_details and change_order; the second vanished silently and the
 * contractor was told "Done". Now every valid call comes back, in the model's
 * order, and a call whose arguments don't parse is named so the reply can say
 * it wasn't made. A tool the turn did not offer stays ignored (REQ-368).
 *
 * The SDK gets a fetch that answers with a canned chat completion — no
 * network, no key (unit lane; the wire-shape smoke tests are smk.test.ts).
 */
import { assertEquals } from "#std/assert";
import { OpenAILLMClient } from "./mod.ts";

function completion(
  content: string | null,
  calls: { name: string; arguments: string }[],
): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-req444",
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: "gpt-4o-mini",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content,
          tool_calls: calls.map((c, i) => ({
            id: `call_${i}`,
            type: "function",
            function: { name: c.name, arguments: c.arguments },
          })),
        },
        finish_reason: "tool_calls",
      }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function client(res: () => Response): OpenAILLMClient {
  return new OpenAILLMClient({
    apiKey: "sk-test-444",
    fetch: (() => Promise.resolve(res())) as typeof fetch,
  });
}

const DETAILS = {
  name: "update_job_details",
  arguments: JSON.stringify({
    descriptionByLang: {
      en:
        "New drain line thru slab to island (trench + patch)\nPlumbing permit",
      es:
        "Nueva línea de drenaje por la losa hasta la isla (zanja + parche)\nPermiso de plomería",
    },
  }),
};
const PERMIT = {
  name: "change_order",
  arguments: JSON.stringify({
    description: "Plumbing permit",
    deltaAmountCents: 45_000,
  }),
};
const REVIEW_TOOLS = [
  "revise_quote",
  "change_order",
  "update_job_details",
] as const;

Deno.test("REQ-444 OpenAILLMClient: every tool call the model made comes back, in its order — the first is still `action`", async () => {
  const out = await client(() => completion(null, [DETAILS, PERMIT])).respond({
    systemPrompt: "p",
    messages: [{
      role: "user",
      content: "fix the Spanish and add a plumbing permit line $450",
    }],
    userId: "u-1",
    tools: REVIEW_TOOLS,
  });
  assertEquals(out.actions?.map((a) => a.type), [
    "update_job_details",
    "change_order",
  ]);
  assertEquals(out.action, out.actions?.[0]);
  const permit = out.actions?.[1];
  assertEquals(
    permit?.type === "change_order" ? permit.payload.deltaAmountCents : 0,
    45_000,
  );
  assertEquals(out.dropped, undefined);
});

Deno.test("REQ-444 OpenAILLMClient: a call whose arguments don't parse is named in `dropped`; the valid ones still come back", async () => {
  const broken = { name: "change_order", arguments: "{ not json" };
  const out = await client(() => completion(null, [broken, DETAILS])).respond({
    systemPrompt: "p",
    messages: [{ role: "user", content: "x" }],
    userId: "u-1",
    tools: REVIEW_TOOLS,
  });
  assertEquals(out.actions?.map((a) => a.type), ["update_job_details"]);
  assertEquals(out.action?.type, "update_job_details");
  assertEquals(out.dropped, ["change_order"]);
});

Deno.test("REQ-444 OpenAILLMClient: only broken calls → no action, the text kept, the calls named", async () => {
  const out = await client(() =>
    completion("Added the permit.", [{
      name: "change_order",
      arguments: JSON.stringify({ description: "Plumbing permit" }),
    }])
  ).respond({
    systemPrompt: "p",
    messages: [{ role: "user", content: "x" }],
    userId: "u-1",
    tools: REVIEW_TOOLS,
  });
  assertEquals(out.action, undefined);
  assertEquals(out.actions, undefined);
  assertEquals(out.text, "Added the permit.");
  assertEquals(out.dropped, ["change_order"]);
});

Deno.test("REQ-444 OpenAILLMClient: a tool the turn did not offer is neither acted on nor reported (REQ-368)", async () => {
  const lock = {
    name: "lock_quote",
    arguments: JSON.stringify({ quoteId: "q-1" }),
  };
  const out = await client(() => completion(null, [lock, PERMIT])).respond({
    systemPrompt: "p",
    messages: [{ role: "user", content: "x" }],
    userId: "u-1",
    tools: REVIEW_TOOLS,
  });
  assertEquals(out.actions?.map((a) => a.type), ["change_order"]);
  assertEquals(out.action?.type, "change_order");
  assertEquals(out.dropped, undefined);
});
