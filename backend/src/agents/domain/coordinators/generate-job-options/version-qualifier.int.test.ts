import { assert, assertEquals } from "#std/assert";
import { GenerateJobOptions } from "./mod.ts";
import { StubLLMClient } from "@agents/domain/business/llm/implementations/stub/mod.ts";

/**
 * REQ-759 (demo-loop cycle 5v2, m49 re-open) — the internal version label
 * never reaches the client.
 *
 * The verifier, on the merged demo-fixes (after REQ-667): "Construir una
 * terraza de madera de 12x16 para Marta Silva…" gave the picker cards
 * "Terraza de madera [Breve]" and "Terraza de madera · Versión breve
 * [Detallada]"; choosing the second, the customer page /q/… read "Terraza de
 * madera · versión breve". REQ-667 only stripped ROLE words from the model's
 * own summary/jobName — the qualifier was added by OUR code: normalizeOptions
 * "disambiguated" two equal model jobNames with disambiguateTitle (and
 * padToThree / the degraded fallback title their extra card with
 * versionTitle). The jobName is the quote's title, so the card label went to
 * the customer. The cards are told apart by their `style` label instead.
 */

const MARTA_RAW =
  "Construir una terraza de madera de 12x16 para Marta Silva, con barandal, escalones y sellador";

const QUALIFIER =
  /versi[oó]n breve|short version|alcance ampliado|wider scope/i;

function fresh() {
  const llm = new StubLLMClient();
  return { llm, coord: new GenerateJobOptions(llm) };
}

type Opt = {
  jobName: string;
  summary: string;
  style?: string;
  byLang: Record<string, { jobName: string; summary: string }>;
};

function assertNoQualifier(options: Opt[]) {
  for (const o of options) {
    for (
      const text of [
        o.jobName,
        o.summary,
        ...Object.values(o.byLang).flatMap((l) => [l.jobName, l.summary]),
      ]
    ) {
      assert(
        !QUALIFIER.test(text),
        `internal version label reaches the client: "${text}"`,
      );
    }
  }
}

const CONCISE_ES = [
  "Construcción de terraza de madera de 12x16",
  "Barandal, escalones y sellador",
];
const DETAILED_ES = [
  "Construir estructura de terraza de madera de 12x16 con vigas y postes",
  "Instalar piso de tablas de madera tratada",
  "Instalar barandal perimetral de madera",
  "Construir escalones de acceso con pasamanos",
  "Aplicar sellador protector a toda la terraza",
];

Deno.test("REQ-759 (cycle 5v2, m49) two model versions with the same jobName: neither card's title carries 'Versión breve' (the verifier's terraza)", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [
        {
          es: {
            jobName: "Terraza de madera",
            summary: "Terraza de madera de 12x16",
            bullets: CONCISE_ES,
          },
        },
        {
          es: {
            jobName: "Terraza de madera",
            summary: "Terraza de madera de 12x16",
            bullets: DETAILED_ES,
          },
        },
      ],
    }),
  }));
  const res = await coord.run({ userId: "u1", raw: MARTA_RAW, langs: ["es"] });
  assertEquals(res.degraded, false);
  assertEquals(res.options.length, 2);
  assertNoQualifier(res.options as Opt[]);
  // The second card is the one the verifier picked: its title is the job.
  assertEquals(res.options[1].jobName, "Terraza de madera");
  assertEquals(res.options[1].byLang.es.jobName, "Terraza de madera");
  // The cards are told apart by the style label, not the title.
  assertEquals(res.options.map((o) => o.style), ["concise", "detailed"]);
});

Deno.test("REQ-759 (cycle 5v2, m49) three equal model jobNames in two languages: no title gets a version qualifier", async () => {
  const { llm, coord } = fresh();
  const en = [
    ["Build a 12x16 wood deck", "Railing, stairs and sealer"],
    [
      "Build a 12x16 wood deck frame",
      "Install treated deck boards",
      "Install perimeter railing",
      "Build stairs",
      "Seal the deck",
    ],
    [
      "Build a 12x16 wood deck frame with beams and posts",
      "Install treated wood deck boards",
      "Install a wood perimeter railing with balusters",
      "Build access stairs with a handrail",
      "Apply protective sealer to the whole deck",
      "Haul away construction debris",
    ],
  ];
  const es = [
    CONCISE_ES,
    [
      "Construir estructura de terraza de 12x16",
      "Instalar tablas tratadas",
      "Instalar barandal perimetral",
      "Construir escalones",
      "Sellar la terraza",
    ],
    [...DETAILED_ES, "Retirar escombros de construcción"],
  ];
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [0, 1, 2].map((i) => ({
        es: {
          jobName: "Terraza de madera",
          summary: "Terraza de madera de 12x16",
          bullets: es[i],
        },
        en: {
          jobName: "Wood Deck",
          summary: "12x16 wood deck",
          bullets: en[i],
        },
      })),
    }),
  }));
  const res = await coord.run({
    userId: "u1",
    raw: MARTA_RAW,
    langs: ["es", "en"],
  });
  assertEquals(res.degraded, false);
  assertEquals(res.options.length, 3);
  assertNoQualifier(res.options as Opt[]);
  for (const o of res.options) {
    assertEquals(o.byLang.es.jobName, "Terraza de madera");
    assertEquals(o.byLang.en.jobName, "Wood Deck");
  }
  assertEquals(res.options.map((o) => o.style), [
    "concise",
    "standard",
    "detailed",
  ]);
});

Deno.test("REQ-759 (cycle 5v2, m49) a padded version keeps the job's title, in every language", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => ({
    text: JSON.stringify({
      options: [
        {
          es: {
            jobName: "Terraza de madera",
            summary: "Terraza de madera de 12x16",
            bullets: DETAILED_ES,
          },
        },
      ],
    }),
  }));
  const res = await coord.run({
    userId: "u1",
    raw: MARTA_RAW,
    langs: ["es", "en"],
  });
  assertNoQualifier(res.options as Opt[]);
  for (const o of res.options) {
    assertEquals(o.byLang.es.jobName, "Terraza de madera");
  }
});

Deno.test("REQ-759 (cycle 5v2, m49) the degraded fallback's versions keep the job's title and are told apart by style", async () => {
  const { llm, coord } = fresh();
  llm.setHandler(() => {
    throw new Error("model down");
  });
  const res = await coord.run({
    userId: "u1",
    raw:
      "Construir terraza de madera de 12x16\nInstalar barandal\nConstruir escalones\nAplicar sellador",
    langs: ["es", "en"],
  });
  assertEquals(res.degraded, true);
  assert(
    res.options.length >= 2,
    `expected two versions, got ${res.options.length}`,
  );
  assertNoQualifier(res.options as Opt[]);
  assertEquals(
    res.options[1].byLang.es.jobName,
    res.options[0].byLang.es.jobName,
  );
  assertEquals(res.options.map((o) => o.style), ["detailed", "concise"]);
});
