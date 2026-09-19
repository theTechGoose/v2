import { assert, assertEquals } from "#std/assert";
import { PolishJobDetails } from "./mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";

/**
 * REQ-026 — 5.1 NW-05: the polish fallback never returns the raw sentence
 * as the description.
 *
 * Under the dev stub (or a failed call) `polish-job-details` used to answer
 * `description: raw` — "I need to replace a toile for $500" landed on the
 * quote verbatim. The fallback description is now the honest scope bullets
 * joined by newlines, and the result says `degraded: true`.
 */

const RAW = "I need to replace a toile for $500";

Deno.test("REQ-026 NW-05 polish fallback: description is the scope, not the raw sentence", async () => {
  const llm = new StubLLMClient();
  const coord = new PolishJobDetails(llm);
  const res = await coord.run({ userId: "u1", raw: RAW });
  assertEquals(res.degraded, true);
  assert(res.description !== RAW, `description echoes raw: ${res.description}`);
  assertEquals(res.description, "Replace a toile");
  assert(!res.description.includes("$500"));
  assert(!/^I Need To/.test(res.jobName), `jobName: ${res.jobName}`);
});

Deno.test("REQ-026 NW-05 polish fallback: multi-line raw → one bullet per line", async () => {
  const llm = new StubLLMClient();
  llm.setHandler(() => {
    throw new Error("boom");
  });
  const coord = new PolishJobDetails(llm);
  const res = await coord.run({
    userId: "u1",
    raw: "Necesito pintar la sala por $1,200\nquitar el papel tapiz",
    commsLanguage: "es",
  });
  assertEquals(res.degraded, true);
  assertEquals(res.description, "Pintar la sala\nQuitar el papel tapiz");
});

Deno.test("REQ-026 NW-05 polish: a valid model reply passes through, degraded false", async () => {
  const llm = new StubLLMClient();
  let seenFormat: string | undefined;
  // REQ-028: JSON mode requested, same as generate-job-options.
  llm.setHandler((req) => {
    seenFormat = req.responseFormat;
    return {
      text: JSON.stringify({
        summary: "Toilet replacement",
        jobName: "Toilet replacement",
        description: "We will remove the old toilet and install a new one.",
      }),
    };
  });
  const coord = new PolishJobDetails(llm);
  const res = await coord.run({ userId: "u1", raw: RAW });
  assertEquals(seenFormat, "json");
  assertEquals(res.degraded, false);
  assertEquals(
    res.description,
    "We will remove the old toilet and install a new one.",
  );
});
