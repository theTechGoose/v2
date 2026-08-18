import { ProfessionalizeBullet } from "@agents/domain/coordinators/professionalize-bullet/mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type { LLMClient, LLMRequest, LLMResponse } from "@agents/domain/business/llm/base/mod.ts";

function fixed(text: string): LLMClient {
  return { respond: (_r: LLMRequest): Promise<LLMResponse> => Promise.resolve({ text }) };
}

const cases: [string, LLMClient][] = [
  ["STUB (what this container runs)", new StubLLMClient()],
  ['REAL-shaped JSON reply {"text":"Repair gate hinges & latch"}', fixed('{"text":"Repair gate hinges & latch"}')],
  ["REAL-shaped bare line 'Repair gate hinges & latch'", fixed("Repair gate hinges & latch")],
];

for (const [label, llm] of cases) {
  const c = new ProfessionalizeBullet(llm);
  const out = await c.run({ userId: "u1", text: "fix the gate" });
  const ok = /gate|hinge|latch|hardware|fence/i.test(out.text);
  console.log(`${label}\n   -> ${JSON.stringify(out.text)}   matches /gate|hinge|latch|hardware|fence/i = ${ok}\n`);
}

// Show the exact stub payload the coordinator receives.
const stub = new StubLLMClient();
const raw = await stub.respond({
  systemPrompt: "irrelevant",
  messages: [{ role: "user", content: "Rough bullet:\nfix the gate" }],
  userId: "u1",
});
console.log("stub raw LLM text =", JSON.stringify(raw.text));
console.log("first non-empty line (what stripLine() returns) =", JSON.stringify(raw.text.split("\n").map((l)=>l.trim()).find((l)=>l.length>0)));
