import { assert, assertEquals } from "#std/assert";
import { ProfessionalizeBullet } from "./mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type { LLMRequest } from "@agents/domain/business/llm/base/mod.ts";

/**
 * REQ-332 (demo cycle 1, m30): "Professionalize" changed the meaning — the
 * bullet "4 recesed lights + City of Austin permit" came back as "Install 4
 * recessed lights with permit", re-scoping a job-wide permit onto one item.
 * The one-line pass saw the bullet alone. Now it sees the job (the original
 * message + the sibling bullets), is told never to merge or re-scope, and an
 * "A + B" bullet comes back as two lines.
 */

function fresh() {
  const llm = new StubLLMClient();
  return { llm, flow: new ProfessionalizeBullet(llm) };
}

const RAW =
  "Kitchen refresh for the Nguyens: 4 recesed lights + City of Austin permit, repaint the ceiling, " +
  "swap the faucet. They're buying the vanity themselves.";
const SIBLINGS = ["Repaint kitchen ceiling", "Replace kitchen faucet"];

Deno.test("REQ-332 professionalize: the model sees the original message and the sibling bullets, and is told not to merge or re-scope", async () => {
  const { llm, flow } = fresh();
  let seen: LLMRequest | undefined;
  llm.setHandler((req) => {
    seen = req;
    return {
      text: JSON.stringify({
        lines: ["Install 4 recessed lights", "City of Austin permit"],
      }),
    };
  });
  await flow.run({
    userId: "u-1",
    text: "4 recesed lights + City of Austin permit",
    context: { raw: RAW, siblings: SIBLINGS },
  });
  assert(seen, "llm was called");
  const user = seen!.messages.find((m) => m.role === "user")?.content ?? "";
  assert(
    user.includes("Kitchen refresh for the Nguyens"),
    `the original message reaches the model: ${user}`,
  );
  assert(
    user.includes("Replace kitchen faucet"),
    `the sibling bullets reach the model: ${user}`,
  );
  assert(
    /do not merge/i.test(seen!.systemPrompt),
    "system prompt forbids merging",
  );
  assert(
    /re-?scope/i.test(seen!.systemPrompt),
    "system prompt forbids re-scoping",
  );
  assert(
    /two lines|separate lines/i.test(seen!.systemPrompt),
    "system prompt asks for 'A + B' as separate lines",
  );
});

Deno.test("REQ-332 professionalize: an 'A + B' bullet comes back as two lines (text = the first)", async () => {
  const { llm, flow } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      lines: ["Install 4 recessed lights", "City of Austin permit"],
    }),
  }));
  const res = await flow.run({
    userId: "u-1",
    text: "4 recesed lights + City of Austin permit",
  });
  assertEquals(res.lines, [
    "Install 4 recessed lights",
    "City of Austin permit",
  ]);
  assertEquals(res.text, "Install 4 recessed lights");
});

Deno.test("REQ-332 professionalize: a model that folds 'A + B' into one line is overruled — the items are split deterministically", async () => {
  const { llm, flow } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({ text: "Install 4 recessed lights with permit" }),
  }));
  const res = await flow.run({
    userId: "u-1",
    text: "4 recesed lights + City of Austin permit",
  });
  assertEquals(res.lines.length, 2, `two items stay two lines: ${res.lines}`);
  assert(
    /recesed lights/i.test(res.lines[0]) && !/permit/i.test(res.lines[0]),
    res.lines[0],
  );
  assert(/City of Austin permit/i.test(res.lines[1]), res.lines[1]);
});

Deno.test("REQ-332 professionalize: the stub / offline fallback splits 'A + B' too", async () => {
  const { flow } = fresh();
  const res = await flow.run({
    userId: "u-1",
    text: "install 4 recesed lights + City of Austin permit",
  });
  assertEquals(res.lines, [
    "Installation of 4 recesed lights",
    "City of Austin permit",
  ]);
  assertEquals(res.text, "Installation of 4 recesed lights");
});

Deno.test("REQ-332 professionalize: a single-item bullet is still one line, legacy {text} replies still parse", async () => {
  const { llm, flow } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({ text: "Repaint kitchen ceiling" }),
  }));
  const res = await flow.run({
    userId: "u-1",
    text: "repaint the kitchen ceiling",
  });
  assertEquals(res.lines, ["Repaint kitchen ceiling"]);
  assertEquals(res.text, "Repaint kitchen ceiling");
});

Deno.test("REQ-332 professionalize: a returned line that is about something else is discarded for the fallback", async () => {
  const { llm, flow } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      lines: ["Install 4 recessed lights", "Replace kitchen faucet"],
    }),
  }));
  const res = await flow.run({
    userId: "u-1",
    text: "4 recesed lights + City of Austin permit",
  });
  assertEquals(res.lines, ["4 recesed lights", "City of Austin permit"]);
});
