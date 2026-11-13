/**
 * REQ-710 (demo-loop cycle 5, M4, pair 7): after "add a Spanish version for
 * the homeowner's mom", the rewritten ENGLISH version read "Install kitchen
 * backsplash 30 pies cuadrados subway tile" — the model applied the Spanish
 * glossary ("sq ft → pies cuadrados") to the English line, and nothing
 * checked a line's language against its slot. A generated line written in
 * the wrong language for its slot is now translated into the slot's
 * language (one TranslateBullets call per language) before the picker shows
 * it; a failed fix keeps the line rather than dropping scope.
 */
import { assert, assertEquals } from "#std/assert";
import { GenerateJobOptions } from "./mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";
import type { LLMRequest } from "@agents/domain/business/llm/base/mod.ts";

const TYPED =
  "gut master bath 8x10, plus kitchen backsplash 30sqft subway tile";

const MIXED_EN = "Install kitchen backsplash 30 pies cuadrados subway tile";
const FIXED_EN = "Install kitchen backsplash, 30 sq ft subway tile";
const ES_LINE =
  "Instalar salpicadero de cocina de 30 pies cuadrados de azulejo subway";

function option(en: string[], es: string[]) {
  return {
    en: {
      jobName: "Master Bath & Kitchen",
      summary: "Master bath gut and kitchen backsplash",
      bullets: en,
    },
    es: {
      jobName: "Baño y cocina",
      summary: "Remodelación del baño principal y salpicadero de la cocina",
      bullets: es,
    },
  };
}

function scripted(
  reply: unknown,
  translate: (texts: string[], toEn: boolean) => string[] | null,
) {
  const llm = new StubLLMClient();
  const generation: LLMRequest[] = [];
  const translation: LLMRequest[] = [];
  llm.setHandler((req) => {
    if (
      /You translate construction scope-of-work/.test(req.systemPrompt ?? "")
    ) {
      translation.push(req);
      const { texts } = JSON.parse(req.messages[0].content as string) as {
        texts: string[];
      };
      const out = translate(
        texts,
        /bullet lines into English/.test(req.systemPrompt ?? ""),
      );
      if (!out) throw new Error("provider down");
      return { text: JSON.stringify({ texts: out }) };
    }
    generation.push(req);
    return { text: JSON.stringify(reply) };
  });
  return { coord: new GenerateJobOptions(llm), generation, translation };
}

const allLines = (
  options: Array<{ byLang: Record<string, { bullets: string[] }> }>,
  lang: string,
) => options.flatMap((o) => o.byLang[lang]?.bullets ?? []);

Deno.test("REQ-710 (cycle 5, M4) an English line carrying Spanish ('30 pies cuadrados') is translated into English before the picker shows it (pair 7)", async () => {
  const { coord, generation, translation } = scripted(
    {
      options: [
        option(
          ["Gut master bath 8x10", MIXED_EN],
          ["Desmantelar baño principal 8x10", ES_LINE],
        ),
      ],
    },
    (texts, toEn) => texts.map((t) => toEn && t === MIXED_EN ? FIXED_EN : t),
  );

  const res = await coord.run({
    userId: "u-1",
    raw: TYPED,
    langs: ["en", "es"],
  });

  assertEquals(res.degraded, false);
  assertEquals(generation.length, 1);
  assertEquals(translation.length, 1, "one fix call, for English");
  assert(/bullet lines into English/.test(translation[0].systemPrompt ?? ""));
  assertEquals(
    JSON.parse(translation[0].messages[0].content as string).texts,
    [MIXED_EN],
    "only the mixed line is sent",
  );
  assertEquals(res.options[0].byLang.en.bullets, [
    "Gut master bath 8x10",
    FIXED_EN,
  ]);
  // the picker's flat (primary-language) bullets are the fixed ones too
  assertEquals(res.options[0].bullets, res.options[0].byLang.en.bullets);
  for (const line of allLines(res.options, "en")) {
    assert(
      !/pies cuadrados/i.test(line),
      `Spanish in an English line: ${line}`,
    );
  }
  // the Spanish version is untouched
  assertEquals(res.options[0].byLang.es.bullets, [
    "Desmantelar baño principal 8x10",
    ES_LINE,
  ]);
});

Deno.test("REQ-710 (cycle 5, M4) a Spanish line left with 'sq ft' is put into Spanish (REQ-448: never sq ft in Spanish text)", async () => {
  const { coord, translation } = scripted(
    {
      options: [
        option(
          ["Gut master bath 8x10", FIXED_EN],
          [
            "Desmantelar baño principal 8x10",
            "Instalar salpicadero de cocina de 30 sq ft",
          ],
        ),
      ],
    },
    (texts, toEn) =>
      texts.map((t) =>
        !toEn && t === "Instalar salpicadero de cocina de 30 sq ft"
          ? "Instalar salpicadero de cocina de 30 pies cuadrados"
          : t
      ),
  );

  const res = await coord.run({
    userId: "u-1",
    raw: TYPED,
    langs: ["en", "es"],
  });

  assertEquals(translation.length, 1);
  assert(
    /bullet lines into neutral Latin-American Spanish/.test(
      translation[0].systemPrompt ?? "",
    ),
  );
  assertEquals(res.options[0].byLang.es.bullets, [
    "Desmantelar baño principal 8x10",
    "Instalar salpicadero de cocina de 30 pies cuadrados",
  ]);
  assertEquals(res.options[0].byLang.en.bullets, [
    "Gut master bath 8x10",
    FIXED_EN,
  ]);
});

Deno.test("REQ-710 (cycle 5, M4) lines already in their slot's language cost no extra model call", async () => {
  const { coord, generation, translation } = scripted(
    {
      options: [
        option(
          ["Gut master bath 8x10", FIXED_EN],
          ["Desmantelar baño principal 8x10", ES_LINE],
        ),
      ],
    },
    (texts) => texts,
  );

  await coord.run({ userId: "u-1", raw: TYPED, langs: ["en", "es"] });

  assertEquals(generation.length, 1);
  assertEquals(translation.length, 0);
});

Deno.test("REQ-710 (cycle 5, M4) a fix the model fails keeps the line — scope is never dropped", async () => {
  const { coord, translation } = scripted(
    {
      options: [
        option(
          ["Gut master bath 8x10", MIXED_EN],
          ["Desmantelar baño principal 8x10", ES_LINE],
        ),
      ],
    },
    () => null,
  );

  const res = await coord.run({
    userId: "u-1",
    raw: TYPED,
    langs: ["en", "es"],
  });

  assert(translation.length >= 1, "the fix was attempted");
  assertEquals(res.degraded, false);
  assertEquals(res.options[0].byLang.en.bullets, [
    "Gut master bath 8x10",
    MIXED_EN,
  ]);
});
