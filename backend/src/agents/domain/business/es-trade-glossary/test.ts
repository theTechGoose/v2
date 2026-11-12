/**
 * REQ-448 (demo-loop cycle 3, m47): every model path that writes Spanish job
 * copy carries the same trade glossary. The demo's Spanish read "trinchado"
 * (trench), "un corte para la cocina" (cooktop cutout), "gabinetes de shaker"
 * and "sq ft" — the picker bullets (GenerateJobOptions) and the chat model's
 * update_job_details rewrite had no glossary at all; only TranslateBullets did,
 * and its list had none of these terms.
 */
import { assert, assertStringIncludes } from "#std/assert";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type { LLMRequest } from "@agents/domain/business/llm/base/mod.ts";
import { TOOL_DEFS } from "@agents/domain/business/openai-tools/mod.ts";
import { stepContextLine } from "@agents/domain/business/chat-step/mod.ts";
import { GenerateJobOptions } from "@agents/domain/coordinators/generate-job-options/mod.ts";
import { TranslateBullets } from "@agents/domain/coordinators/translate-bullets/mod.ts";
import { PolishJobDetails } from "@agents/domain/coordinators/polish-job-details/mod.ts";

/** The terms the demo got wrong, plus the REQ-350 vanity rule. */
const MUST_CARRY = [
  "zanja", // trench — never "trinchado"
  "corte para la estufa", // cooktop cutout — never "corte para la cocina"
  "gabinetes estilo shaker", // never "gabinetes de shaker"
  "pies cuadrados", // sq ft
  "pies lineales", // lf
  "mueble de baño", // vanity (REQ-350)
];

function assertGlossary(prompt: string | undefined, where: string) {
  assert(prompt, `${where}: no prompt captured`);
  for (const term of MUST_CARRY) {
    assertStringIncludes(prompt, term, `${where} lacks "${term}"`);
  }
}

/** Every text the model reads on one request. */
function promptText(req: LLMRequest | undefined): string | undefined {
  if (!req) return undefined;
  return [
    req.systemPrompt ?? "",
    ...req.messages.map((m) =>
      typeof m.content === "string" ? m.content : JSON.stringify(m.content)
    ),
  ].join("\n");
}

function capture(
  reply: string,
): { llm: StubLLMClient; seen: () => LLMRequest | undefined } {
  const llm = new StubLLMClient();
  let seen: LLMRequest | undefined;
  llm.setHandler((req) => {
    seen = req;
    return { text: reply };
  });
  return { llm, seen: () => seen };
}

Deno.test("REQ-448 m47 the glossary maps trench, cooktop cutout, shaker, sq ft, lf", async () => {
  const { ES_TRADE_GLOSSARY } = await import("./mod.ts");
  for (const term of ["trench", "cooktop cutout", "shaker", "sq ft", "lf"]) {
    assertStringIncludes(ES_TRADE_GLOSSARY, term);
  }
  assertGlossary(ES_TRADE_GLOSSARY, "ES_TRADE_GLOSSARY");
});

Deno.test("REQ-448 m47 GenerateJobOptions: a Spanish picker run carries the glossary", async () => {
  const { llm, seen } = capture(JSON.stringify({ options: [] }));
  await new GenerateJobOptions(llm).run({
    userId: "u-1",
    raw:
      "Dig a trench for the gas line, cooktop cutout, shaker cabinets, 120 sq ft tile",
    langs: ["en", "es"],
  });
  assertGlossary(promptText(seen()), "generate-job-options (en+es)");
});

Deno.test("REQ-448 m47 GenerateJobOptions: an English-only run does not carry it", async () => {
  const { llm, seen } = capture(JSON.stringify({ options: [] }));
  await new GenerateJobOptions(llm).run({
    userId: "u-1",
    raw: "Dig a trench for the gas line",
    langs: ["en"],
  });
  const p = promptText(seen()) ?? "";
  assert(
    !p.includes("zanja"),
    "an English-only prompt should not carry the Spanish glossary",
  );
});

Deno.test("REQ-448 m47 update_job_details: the es field the chat model fills carries the glossary", () => {
  const def = TOOL_DEFS.find((d) => d.function.name === "update_job_details");
  assert(def, "update_job_details tool missing");
  // deno-lint-ignore no-explicit-any
  const es = (def.function.parameters as any).properties.descriptionByLang
    .properties.es.description as string;
  assertGlossary(es, "update_job_details.es");
});

Deno.test("REQ-448 m47 the Ready-to-send review hint (where update_job_details runs) carries the glossary", () => {
  assertGlossary(stepContextLine({ id: "review" } as never), "chatStep.review");
});

Deno.test("REQ-448 m47 TranslateBullets to es carries the glossary", async () => {
  const { llm, seen } = capture(
    JSON.stringify({ texts: ["Excavar una zanja"] }),
  );
  await new TranslateBullets(llm).run({
    userId: "u-1",
    texts: ["Dig a trench"],
    to: "es",
    from: "en",
  });
  assertGlossary(promptText(seen()), "translate-bullets");
});

Deno.test("REQ-448 m47 PolishJobDetails in Spanish carries the glossary", async () => {
  const { llm, seen } = capture(
    JSON.stringify({ summary: "x", jobName: "x", description: "x" }),
  );
  await new PolishJobDetails(llm).run({
    userId: "u-1",
    raw: "Dig a trench, 40 lf",
    commsLanguage: "es",
  });
  assertGlossary(promptText(seen()), "polish-job-details (es)");
});
