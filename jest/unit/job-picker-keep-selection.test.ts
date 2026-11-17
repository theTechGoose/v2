/**
 * REQ-446 — demo-loop cycle 3, issue m13 (pairs 1, 3, 7): "The job-description
 * picker confuses — three near-identical options; the pencil re-opens the
 * whole picker and rewords the options; a refinement resets her chosen card
 * to card 1."
 *
 * (1) A refinement typed in "Tell the assistant…" (REQ-392) rewrote the
 *     versions and applyStepAnswer selected `drafts[0]` unconditionally — the
 *     pick moves with the rewrite now: the same version (concise / standard /
 *     detailed), else the closest bullets, else the same place.
 * (2) The review card's pencil (REQ-330) regenerated three new alternatives
 *     beside the current card — it now opens the current card alone, to be
 *     edited in place.
 * (3) The prompt asked for versions that "differ only in wording and
 *     grouping" — now three roles (concise / standard / detailed), each
 *     labelled on its card.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  carryPickedOptionId,
  labelVersionStyles,
} from "../../shared/quote-flow/option-bullets";
import { versionStyleLabel } from "../../shared/quote-flow/version-titles";

const ROOT = resolve(__dirname, "../..");
const island = () =>
  readFileSync(resolve(ROOT, "front-end/islands/AsstChat.tsx"), "utf8");

/** fleet-6 (Mia, kitchen): she picked card 2 "Complete Kitchen Renovation",
 *  sent a fix, and the rewrite came back with card 1 selected. */
const BEFORE = [
  {
    id: "opt1",
    style: "concise" as const,
    bullets: ["Kitchen demolition and haul away", "Cabinets and quartz tops"],
  },
  {
    id: "opt2",
    style: "standard" as const,
    bullets: [
      "Kitchen demolition",
      "Haul away debris",
      "Install new cabinets",
      "Quartz countertops",
    ],
  },
  {
    id: "opt3",
    style: "detailed" as const,
    bullets: [
      "Full kitchen demolition",
      "Haul away all debris",
      "Install 22 lf of new cabinets",
      "48 sqft quartz countertops",
      "Jobsite cleanup",
    ],
  },
];
const AFTER = [
  {
    id: "opt1",
    style: "concise" as const,
    bullets: ["Kitchen gut and haul away", "Cabinets, quartz, slab drain"],
  },
  {
    id: "opt2",
    style: "standard" as const,
    bullets: [
      "Kitchen gut",
      "Haul away debris",
      "New cabinets",
      "Quartz countertops",
      "New drain line through slab",
    ],
  },
  {
    id: "opt3",
    style: "detailed" as const,
    bullets: [
      "Full kitchen gut",
      "Haul away all debris",
      "Install 22 lf of new cabinets",
      "48 sqft quartz countertops",
      "New drain line through slab",
      "Jobsite cleanup",
    ],
  },
];

describe("REQ-446 (cycle 3, m13) a refinement keeps the contractor's pick", () => {
  it("REQ-446 the demo's path: card 2 picked, the rewrite keeps card 2 — never resets to card 1", () => {
    expect(carryPickedOptionId(BEFORE, "opt2", AFTER)).toBe("opt2");
    expect(carryPickedOptionId(BEFORE, "opt3", AFTER)).toBe("opt3");
  });

  it("REQ-446 the same version (concise / standard / detailed) wins even when the rewrite reorders the cards", () => {
    const reordered = [AFTER[2], AFTER[0], AFTER[1]].map((o, i) => ({
      ...o,
      id: `opt${i + 1}`,
    }));
    // standard was opt2; in the reordered list standard is opt3.
    expect(carryPickedOptionId(BEFORE, "opt2", reordered)).toBe("opt3");
  });

  it("REQ-446 with no version labels the closest bullets win", () => {
    const strip = <T extends { style?: unknown }>(o: T) => ({
      ...o,
      style: undefined,
    });
    const before = BEFORE.map(strip);
    const after = [AFTER[2], AFTER[0], AFTER[1]].map(strip).map((o, i) => ({
      ...o,
      id: `opt${i + 1}`,
    }));
    // the picked detailed card (opt3 before) is opt1 after the reorder
    expect(carryPickedOptionId(before, "opt3", after)).toBe("opt1");
  });

  it("REQ-446 the seeded current card (no label) carries to the rewrite with the closest bullets", () => {
    const current = {
      id: "current",
      bullets: [
        "Install 22 lf of new cabinets",
        "48 sqft quartz countertops",
        "Full kitchen demolition",
        "Jobsite cleanup",
      ],
    };
    expect(carryPickedOptionId([current], "current", AFTER)).toBe("opt3");
  });

  it("REQ-446 a tie keeps the same place", () => {
    const same = ["Paint living room"];
    const before = [
      { id: "opt1", bullets: same },
      { id: "opt2", bullets: same },
    ];
    const after = [
      { id: "opt1", bullets: ["Repaint walls"] },
      { id: "opt2", bullets: ["Repaint walls"] },
    ];
    expect(carryPickedOptionId(before, "opt2", after)).toBe("opt2");
  });

  it("REQ-446 nothing picked (or the write-it-myself tile, or an empty rewrite) falls back to the first card / null", () => {
    expect(carryPickedOptionId(BEFORE, null, AFTER)).toBe("opt1");
    expect(carryPickedOptionId(BEFORE, "__custom__", AFTER)).toBe("opt1");
    expect(carryPickedOptionId(null, "opt2", AFTER)).toBe("opt2");
    expect(carryPickedOptionId(BEFORE, "opt2", [])).toBeNull();
  });

  it("REQ-446 deleted bullets do not count toward the match", () => {
    const before = [
      {
        id: "opt1",
        bullets: [
          { text: "Kitchen gut", deleted: false },
          { text: "Haul away debris", deleted: false },
        ],
      },
      {
        id: "opt2",
        bullets: [
          { text: "Install 22 lf of new cabinets", deleted: false },
          { text: "Kitchen gut", deleted: true },
        ],
      },
    ];
    const after = [
      { id: "opt1", bullets: ["Kitchen gut", "Haul away debris"] },
      { id: "opt2", bullets: ["Install 22 lf of new cabinets"] },
    ];
    expect(carryPickedOptionId(before, "opt2", after)).toBe("opt2");
  });

  it("REQ-446 the island's applyStepAnswer carries the pick, never `drafts[0]`", () => {
    const src = island();
    const start = src.indexOf("function applyStepAnswer(");
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf("\n  }\n", start));
    expect(body).not.toMatch(/setSelectedOptionId\(\s*drafts\[0\]/);
    expect(body).toMatch(/carryPickedOptionId\(/);
  });
});

describe("REQ-446 (cycle 3, m13) the pencil edits the current card in place", () => {
  it("REQ-446 openJobPicker with the current details settles on them without generating alternatives", () => {
    const src = island();
    const start = src.indexOf("async function openJobPicker(");
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf("\n  }\n", start));
    const gen = body.indexOf("generateJobOptions(");
    const seeded = body.search(/if \(seed && seed\.lines\.length > 0\)/);
    expect(seeded).toBeGreaterThan(0);
    expect(seeded).toBeLessThan(gen);
    const branch = body.slice(seeded, gen);
    expect(branch).toMatch(/settleJobOptions\(raw, null, seed\)/);
    expect(branch).toMatch(/return;/);
  });
});

describe("REQ-446 (cycle 3, m13) the versions are concise / standard / detailed, labelled", () => {
  it("REQ-446 labels by detail, in place — no reordering", () => {
    const out = labelVersionStyles([
      { id: "opt1", bullets: ["A b c", "D e f", "G h i"] },
      { id: "opt2", bullets: ["A b c; d e f", "G h i"] },
      { id: "opt3", bullets: ["A b c", "D e f", "G h i", "Jobsite cleanup"] },
    ]);
    expect(out.map((o) => o.id)).toEqual(["opt1", "opt2", "opt3"]);
    expect(out.map((o) => o.style)).toEqual([
      "standard",
      "concise",
      "detailed",
    ]);
  });

  it("REQ-446 two versions are concise and detailed; one version has no label", () => {
    expect(
      labelVersionStyles([
        { id: "opt1", bullets: ["Paint walls", "Paint trim and doors"] },
        { id: "opt2", bullets: ["Paint walls and trim"] },
      ]).map((o) => o.style),
    ).toEqual(["detailed", "concise"]);
    expect(
      labelVersionStyles([{ id: "opt1", bullets: ["Paint walls"] }])[0].style,
    ).toBeUndefined();
  });

  it("REQ-446 equal detail keeps the model's order (concise first)", () => {
    expect(
      labelVersionStyles([
        { id: "opt1", bullets: ["Paint walls"] },
        { id: "opt2", bullets: ["Paint trims"] },
        { id: "opt3", bullets: ["Paint doors"] },
      ]).map((o) => o.style),
    ).toEqual(["concise", "standard", "detailed"]);
  });

  it("REQ-446 the labels exist in English and Spanish", () => {
    expect(versionStyleLabel("concise", "en")).toBe("Concise");
    expect(versionStyleLabel("standard", "en")).toBe("Standard");
    expect(versionStyleLabel("detailed", "en")).toBe("Detailed");
    expect(versionStyleLabel("concise", "es")).toBe("Breve");
    expect(versionStyleLabel("standard", "es")).toBe("Estándar");
    expect(versionStyleLabel("detailed", "es")).toBe("Detallada");
  });

  it("REQ-446 the picker card shows the version label", () => {
    const src = island();
    expect(src).toMatch(/data-cy="jobopt-style"/);
    expect(src).toMatch(/versionStyleLabel\(/);
  });

  it("REQ-446 the prompt, in both dictionaries, asks for concise / standard / detailed — not wording-only twins", () => {
    for (const f of ["lang/en.json", "lang/es.json"]) {
      const p = JSON.parse(readFileSync(resolve(ROOT, f), "utf8"))[
        "prompts.generateJobOptions"
      ] as string;
      expect(p).not.toMatch(/differ only in wording and grouping/i);
      expect(p).toMatch(/CONCISE/);
      expect(p).toMatch(/STANDARD/);
      expect(p).toMatch(/DETAILED/);
      // REQ-400 still holds: every version is the whole job.
      expect(p).toMatch(/EVERY option covers the WHOLE job/);
    }
  });
});
