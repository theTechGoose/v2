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
  "fregadero", // kitchen sink — never lavabo (REQ-594, cycle 4 m40)
  "plafón del alero", // soffit (REQ-594, cycle 4 m40)
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

/**
 * REQ-594 (demo-loop cycle 4, m40): the demo's Spanish left "soffit" in
 * English and turned a kitchen sink into "lavabo" (a bathroom basin) — the
 * glossary itself said "sink / basin → lavabo" with no kitchen exception and
 * had no soffit entry.
 */
Deno.test("REQ-594 m40 the glossary maps kitchen sink → fregadero and soffit → plafón del alero", async () => {
  const { ES_TRADE_GLOSSARY } = await import("./mod.ts");
  assert(
    /kitchen sink → fregadero/.test(ES_TRADE_GLOSSARY),
    "kitchen sink must map to fregadero",
  );
  assert(
    /soffit → plafón del alero/.test(ES_TRADE_GLOSSARY),
    "soffit must map to plafón del alero",
  );
});

Deno.test("REQ-594 m40 the glossary never maps a bare / kitchen sink to lavabo", async () => {
  const { ES_TRADE_GLOSSARY } = await import("./mod.ts");
  // Every "… → lavabo" mapping must be qualified as a BATHROOM sink.
  for (const m of ES_TRADE_GLOSSARY.matchAll(/([^;:]*?)→\s*lavabo/g)) {
    assert(
      /bathroom/.test(m[1]),
      `unqualified sink → lavabo mapping: "${m[0].trim()}"`,
    );
  }
  assert(
    !/kitchen sink[^;]*→\s*lavabo/.test(ES_TRADE_GLOSSARY),
    "kitchen sink must not map to lavabo",
  );
});

/**
 * REQ-669 (demo-loop cycle 5, m52): the first Spanish preview read "Guttar
 * baño principal 8x10" — the glossary had no entry for "gut", so the model
 * coined a non-word — and "double vanity" lost its "doble".
 */
Deno.test("REQ-669 m52 the glossary maps gut/gutted to a real Spanish verb and keeps double vanity's doble", async () => {
  const { ES_TRADE_GLOSSARY } = await import("./mod.ts");
  assert(
    /gut[^;]*→[^;]*desmantelar/.test(ES_TRADE_GLOSSARY),
    "gut / gutted must map to desmantelar",
  );
  assertStringIncludes(ES_TRADE_GLOSSARY, "Guttar");
  assert(
    /double vanity → mueble de baño doble/.test(ES_TRADE_GLOSSARY),
    "double vanity must map to mueble de baño doble",
  );
  // Quantity words are carried, not dropped.
  assertStringIncludes(ES_TRADE_GLOSSARY, "double → doble");
});
