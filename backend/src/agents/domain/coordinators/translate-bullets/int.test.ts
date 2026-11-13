import { assert, assertEquals } from "#std/assert";
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

/**
 * REQ-261 (demo M26): translated job-detail bullets land in the quote's
 * `descriptionByLang`. A translation that ADDS a money amount the source line
 * did not have (the model pulling a private cost into the customer copy) is
 * not trusted — the originals come back instead.
 */
Deno.test("REQ-261 M26 a translation that adds a money amount falls back to the originals", async () => {
  const llm = new StubLLMClient();
  llm.setHandler(() => ({
    text: JSON.stringify({
      texts: ["Instalación de plomería", "El plomero Ray cobra $2,800"],
    }),
  }));
  const coord = new TranslateBullets(llm);
  const texts = ["Plumbing rough-in", "Install shutoff valves"];
  const res = await coord.run({ userId: "u1", texts, to: "es" });
  assertEquals(res.texts, texts);
});

Deno.test("REQ-261 M26 a clean translation passes through", async () => {
  const llm = new StubLLMClient();
  llm.setHandler(() => ({
    text: JSON.stringify({
      texts: ["Instalación de plomería", "Instalar válvulas de cierre"],
    }),
  }));
  const coord = new TranslateBullets(llm);
  const res = await coord.run({
    userId: "u1",
    texts: ["Plumbing rough-in", "Install shutoff valves"],
    to: "es",
  });
  assertEquals(res.texts, [
    "Instalación de plomería",
    "Instalar válvulas de cierre",
  ]);
});

// REQ-350 (demo-loop cycle 1, m9): "Customer supplied vanity installation"
// came back as "Instalación de lavabo …" — a lavabo is a sink. The Spanish
// prompt carries a trade glossary so a vanity is a vanity.
Deno.test("REQ-350 translate-bullets: the Spanish prompt carries the trade glossary (vanity ≠ lavabo)", async () => {
  const llm = new StubLLMClient();
  let sys = "";
  llm.setHandler((req) => {
    sys = req.systemPrompt ?? "";
    return {
      text: JSON.stringify({ texts: ["Instalación del mueble de baño"] }),
    };
  });
  await new TranslateBullets(llm).run({
    userId: "u-1",
    texts: ["Customer supplied vanity installation"],
    to: "es",
  });
  assert(/vanity\W+mueble de baño/i.test(sys), sys);
  assert(/never\W+lavabo|not\W+lavabo/i.test(sys), sys);
});

/**
 * REQ-333 (demo-loop cycle 1, M24): the AI silently reworded line items —
 * English lines were sent through the model with to:'en' and came back
 * normalized. Same source and target language is not a translation: the
 * lines come back verbatim and the model is never called.
 */
Deno.test("REQ-333 M24 translate-bullets: same source and target language never calls the model", async () => {
  const llm = new StubLLMClient();
  let calls = 0;
  llm.setHandler(() => {
    calls++;
    return {
      text: JSON.stringify({
        texts: ["Demolition and removal", "Plumbing fixtures installation"],
      }),
    };
  });
  const res = await new TranslateBullets(llm).run({
    userId: "u-1",
    texts: ["Demo and haul-off", "Plumbing fixtures"],
    from: "en",
    to: "en",
  });
  assertEquals(calls, 0, "no model call for the base language");
  assertEquals(res.texts, ["Demo and haul-off", "Plumbing fixtures"]);
  assertEquals(res.translated, true);
});

/**
 * REQ-410 (demo-loop cycle 2, M24): the Spanish agreement dropped a contract
 * exclusion. "60in double vanity, quartz top, 2 undermount sinks (faucets
 * supplied by client / grifos los pone la clienta)" came back as "Mueble de
 * baño de 60in, encimera de cuarzo, 2 lavabos bajo encimera" — the prompt
 * asked for 3–8 words, and nothing checked that the clause survived.
 */
const FAUCET_LINE =
  "60in double vanity, quartz top, 2 undermount sinks (faucets supplied by client / grifos los pone la clienta)";
const FAUCET_SHORT =
  "Mueble de baño de 60in, encimera de cuarzo, 2 lavabos bajo encimera";
const FAUCET_FAITHFUL =
  "Mueble de baño doble de 60in, encimera de cuarzo, 2 lavabos bajo encimera (grifos los pone la clienta)";

Deno.test("REQ-410 M24 translate-bullets: the prompt asks for a faithful translation — no word budget, never drop exclusions", async () => {
  const llm = new StubLLMClient();
  let sys = "";
  llm.setHandler((req) => {
    sys = req.systemPrompt ?? "";
    return { text: JSON.stringify({ texts: ["Demoler el baño"] }) };
  });
  await new TranslateBullets(llm).run({
    userId: "u-1",
    texts: ["Demolish bathroom"],
    from: "en",
    to: "es",
  });
  assert(!/3.8 words|concise/i.test(sys), sys);
  assert(/never shorten/i.test(sys), sys);
  assert(/parenthetical/i.test(sys) && /exclusion/i.test(sys), sys);
  assert(/supplies|supplied/i.test(sys), sys);
});

Deno.test("REQ-410 M24 translate-bullets: a reply that drops the parenthetical exclusion is retried once, then not trusted", async () => {
  const llm = new StubLLMClient();
  let calls = 0;
  llm.setHandler(() => {
    calls++;
    return {
      text: JSON.stringify({ texts: ["Demoler el baño", FAUCET_SHORT] }),
    };
  });
  const texts = ["Demolish bathroom", FAUCET_LINE];
  const res = await new TranslateBullets(llm).run({
    userId: "u-1",
    texts,
    from: "en",
    to: "es",
  });
  assertEquals(calls, 2, "one retry");
  assertEquals(res.translated, false);
  assertEquals(res.texts, texts);
});

Deno.test("REQ-410 M24 translate-bullets: a faithful retry is used", async () => {
  const llm = new StubLLMClient();
  let calls = 0;
  llm.setHandler(() => {
    calls++;
    return {
      text: JSON.stringify({
        texts: [calls === 1 ? FAUCET_SHORT : FAUCET_FAITHFUL],
      }),
    };
  });
  const res = await new TranslateBullets(llm).run({
    userId: "u-1",
    texts: [FAUCET_LINE],
    from: "en",
    to: "es",
  });
  assertEquals(calls, 2);
  assertEquals(res.translated, true);
  assertEquals(res.texts, [FAUCET_FAITHFUL]);
});

Deno.test("REQ-410 M24 translate-bullets: an exclusion without parentheses that is cut short is not trusted", async () => {
  const llm = new StubLLMClient();
  llm.setHandler(() => ({
    text: JSON.stringify({ texts: ["Instalar inodoro"] }),
  }));
  const texts = ["Install toilet, supplied by owner, haul-off not included"];
  const res = await new TranslateBullets(llm).run({
    userId: "u-1",
    texts,
    from: "en",
    to: "es",
  });
  assertEquals(res.translated, false);
  assertEquals(res.texts, texts);
});

Deno.test("REQ-410 M24 translate-bullets: a plain line that translates shorter is still trusted (no false alarm)", async () => {
  const llm = new StubLLMClient();
  let calls = 0;
  llm.setHandler(() => {
    calls++;
    return { text: JSON.stringify({ texts: ["Pintar"] }) };
  });
  const res = await new TranslateBullets(llm).run({
    userId: "u-1",
    texts: ["Paint the walls and ceiling"],
    from: "en",
    to: "es",
  });
  assertEquals(calls, 1);
  assertEquals(res.translated, true);
  assertEquals(res.texts, ["Pintar"]);
});

/**
 * REQ-594 (demo-loop cycle 4, m40): "Keep trade terminology" let the model
 * leave "soffit" in English, and the glossary sent a kitchen sink to
 * "lavabo". The Spanish prompt for a kitchen-sink + soffit line must carry
 * fregadero, plafón del alero, and an explicit "translate trade nouns" rule.
 */
Deno.test("REQ-594 m40 translate-bullets: a kitchen sink + soffit line gets fregadero, plafón del alero and the translate-trade-nouns rule", async () => {
  const llm = new StubLLMClient();
  let sys = "";
  llm.setHandler((req) => {
    sys = req.systemPrompt ?? "";
    return {
      text: JSON.stringify({
        texts: [
          "Instalar fregadero de cocina nuevo",
          "Reparar plafón del alero (sofito) dañado",
        ],
      }),
    };
  });
  const res = await new TranslateBullets(llm).run({
    userId: "u-1",
    texts: ["Install new kitchen sink", "Repair damaged soffit"],
    to: "es",
    from: "en",
  });
  assertEquals(res.translated, true);
  assert(/kitchen sink → fregadero/.test(sys), sys);
  assert(/soffit → plafón del alero/.test(sys), sys);
  assert(/translate (every )?trade nouns? into/i.test(sys), sys);
  assert(!/(?<!bathroom )sink \/ basin → lavabo/.test(sys), sys);
});

Deno.test("REQ-594 m40 translate-bullets: the English target is also told to translate trade nouns", async () => {
  const llm = new StubLLMClient();
  let sys = "";
  llm.setHandler((req) => {
    sys = req.systemPrompt ?? "";
    return { text: JSON.stringify({ texts: ["Install new kitchen sink"] }) };
  });
  await new TranslateBullets(llm).run({
    userId: "u-1",
    texts: ["Instalar fregadero de cocina nuevo"],
    to: "en",
    from: "es",
  });
  assert(/translate (every )?trade nouns? into English/i.test(sys), sys);
  assert(
    !sys.includes("kitchen sink → fregadero"),
    "en target must not carry the es glossary",
  );
});

/**
 * REQ-669 (demo-loop cycle 5, m52): the demo's first Spanish preview carried
 * "Guttar" (not Spanish) and dropped "doble" from "double vanity". A reply
 * like that is re-asked once, naming the bad word and the lost quantity.
 */
Deno.test("REQ-669 m52 translate-bullets: a coined non-word / lost doble is re-asked once and the fixed reply is used", async () => {
  const llm = new StubLLMClient();
  const seen: LLMRequest[] = [];
  llm.setHandler((req) => {
    seen.push(req);
    return {
      text: JSON.stringify({
        texts: seen.length === 1
          ? [
            "Guttar baño principal 8x10",
            "Agregar mueble de baño con encimera de cuarzo",
          ]
          : [
            "Desmantelar baño principal 8x10",
            "Agregar mueble de baño doble con encimera de cuarzo",
          ],
      }),
    };
  });
  const res = await new TranslateBullets(llm).run({
    userId: "u-1",
    texts: ["Gut master bath 8x10", "Add double vanity w/ quartz top"],
    to: "es",
    from: "en",
  });
  assertEquals(seen.length, 2, "one re-ask");
  const retry = seen[1].systemPrompt ?? "";
  assert(retry.includes('"Guttar"'), "the re-ask names the coined word");
  assert(retry.includes('"double"'), "the re-ask names the lost quantity");
  assertEquals(res, {
    texts: [
      "Desmantelar baño principal 8x10",
      "Agregar mueble de baño doble con encimera de cuarzo",
    ],
    translated: true,
  });
});

Deno.test("REQ-669 m52 translate-bullets: a clean first reply is not re-asked", async () => {
  const llm = new StubLLMClient();
  let calls = 0;
  llm.setHandler(() => {
    calls++;
    return {
      text: JSON.stringify({
        texts: [
          "Desmantelar baño principal 8x10",
          "Agregar mueble de baño doble",
        ],
      }),
    };
  });
  await new TranslateBullets(llm).run({
    userId: "u-1",
    texts: ["Gut master bath 8x10", "Add double vanity"],
    to: "es",
    from: "en",
  });
  assertEquals(calls, 1);
});

Deno.test("REQ-669 m52 translate-bullets: a re-ask that still coins a word keeps the better-than-nothing translation", async () => {
  const llm = new StubLLMClient();
  let calls = 0;
  llm.setHandler(() => {
    calls++;
    return { text: JSON.stringify({ texts: ["Guttar baño principal 8x10"] }) };
  });
  const res = await new TranslateBullets(llm).run({
    userId: "u-1",
    texts: ["Gut master bath 8x10"],
    to: "es",
    from: "en",
  });
  assertEquals(calls, 2);
  // Not cached as a good translation, so the next preview asks again.
  assertEquals(res.translated, false);
});
