import { assertEquals } from "#std/assert";
import { TranslateBullets } from "./mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type { LLMRequest } from "@agents/domain/business/llm/base/mod.ts";

// REQ-260 (demo M24 side finding): a one-shot JSON call must ask for JSON
// mode — without it the OpenAI client attaches the chat tools with
// tool_choice:auto, and a create_quote tool call leaves no text to parse.
Deno.test("REQ-260 M24 translate-bullets: one-shot JSON call — responseFormat 'json'", async () => {
  const llm = new StubLLMClient();
  let seen: LLMRequest | undefined;
  llm.setHandler((req) => {
    seen = req;
    return {
      text: JSON.stringify({ texts: ["Demoler el baño hasta los montantes"] }),
    };
  });
  const res = await new TranslateBullets(llm).run({
    userId: "u-1",
    texts: ["Demolish bathroom to studs"],
    to: "es",
  });
  assertEquals(seen?.responseFormat, "json");
  assertEquals(res.texts, ["Demoler el baño hasta los montantes"]);
});
