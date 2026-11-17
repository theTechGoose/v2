/**
 * REQ-330 (demo cycle 1 — M21, M23, p15-7).
 *
 * M23: the review card's "Edit job details" pencil reopened the picker on the
 * CURRENT lines but POSTed them for three brand-new model options; the pick
 * the contractor had already edited (13 lines, "Master Bath Remodel") was
 * replaced, its added bullet cut by the 12-bullet cap, its title renamed.
 * The picker is now seeded with the current details as a pre-selected,
 * editable option — bullets verbatim, title kept — with the regenerated
 * alternatives beside it.
 *
 * M21 / p15-7: no path caps an option's bullets any more, and two options
 * with the same bullet set collapse into one.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  currentDetailsOption,
  dedupeOptionsByBullets,
  sameBullets,
  seedPickerOptions,
} from "../../shared/quote-flow/option-bullets";

const ROOT = resolve(__dirname, "../..");
const island = () =>
  readFileSync(resolve(ROOT, "front-end/islands/AsstChat.tsx"), "utf8");

const THIRTEEN = [
  "Gutted old fixtures and tile",
  "Curbless shower",
  "Slab cut for linear drain",
  "Frameless glass enclosure",
  "72 inch double vanity",
  "Hex mosaic shower floor",
  "Two widespread faucets",
  "Exhaust fan",
  "Recessed lights",
  "Pull the permit",
  "Customer-supplied vanity",
  "Paint walls and ceiling",
  "Install 4 recessed lights with permit",
];

describe("REQ-330 M23 the current details seed the picker", () => {
  it("REQ-330 the current option keeps every line verbatim and the title", () => {
    const cur = currentDetailsOption({
      lines: THIRTEEN,
      jobName: "Master Bath Remodel",
      summary: "Master bath gut remodel",
    });
    expect(cur.id).toBe("current");
    expect(cur.jobName).toBe("Master Bath Remodel");
    expect(cur.summary).toBe("Master bath gut remodel");
    expect(cur.bullets).toEqual(THIRTEEN);
    expect(cur.bullets.length).toBe(13);
  });

  it("REQ-330 the seeded picker lists the current option first, then alternatives that differ", () => {
    const cur = currentDetailsOption({
      lines: THIRTEEN,
      jobName: "Master Bath Remodel",
      summary: "s",
    });
    const generated = [
      {
        id: "opt1",
        jobName: "Bathroom Remodel",
        summary: "s",
        // REQ-584 AMENDMENT: twelve of the thirteen lines is a near-twin of
        // the current option (the last line repeats words already there);
        // ten lines really differs.
        bullets: THIRTEEN.slice(0, 10),
        byLang: {},
      },
      {
        id: "opt2",
        jobName: "Bath Gut",
        summary: "s",
        bullets: [...THIRTEEN],
        byLang: {},
      },
      {
        id: "opt3",
        jobName: "Bath Rebuild",
        summary: "s",
        bullets: THIRTEEN.slice(0, 4),
        byLang: {},
      },
    ];
    const out = seedPickerOptions(cur, generated);
    expect(out[0]).toBe(cur);
    expect(out.map((o) => o.id)).toEqual(["current", "opt1", "opt3"]);
  });

  it("REQ-330 the seeded picker still works with no generated alternatives", () => {
    const cur = currentDetailsOption({
      lines: ["Replace the toilet"],
      jobName: "Toilet",
      summary: "s",
    });
    expect(seedPickerOptions(cur, null)).toEqual([cur]);
    expect(seedPickerOptions(cur, [])).toEqual([cur]);
  });

  it("REQ-330 the island's edit pencil seeds the picker with the current details and pre-selects them", () => {
    const src = island();
    const start = src.indexOf("const editJobDetails = () => {");
    expect(start).toBeGreaterThan(0);
    const body = src.slice(start, src.indexOf("};", start));
    // The current lines go in as a SEED option, not only as the raw text.
    expect(body).toMatch(/openJobPicker\(\s*\{/);
    expect(body).toMatch(/lines/);
    expect(body).toMatch(/jobName/);
    // settleJobOptions puts the seed first and selects it.
    const settle = src.slice(src.indexOf("function settleJobOptions("));
    const settleBody = settle.slice(0, settle.indexOf("\n  }\n"));
    expect(settleBody).toMatch(/seedPickerOptions\(/);
    expect(settleBody).toMatch(/currentDetailsOption\(/);
  });
});

describe("REQ-330 M21 / p15-7 no cap, no twin options", () => {
  it("REQ-330 sameBullets ignores case, spacing and trailing punctuation", () => {
    expect(
      sameBullets(["Replace 10 squares of shingles"], [
        "replace 10  squares of shingles.",
      ]),
    ).toBe(true);
    expect(sameBullets(["A", "B"], ["A"])).toBe(false);
  });

  it("REQ-330 options with equal bullet sets collapse to the first", () => {
    const out = dedupeOptionsByBullets([
      { id: "opt1", bullets: ["Replace 10 squares of shingles"] },
      { id: "opt2", bullets: ["Replace 10 squares of shingles."] },
      {
        id: "opt3",
        bullets: ["Replace 10 squares of shingles", "Jobsite cleanup"],
      },
    ]);
    expect(out.map((o) => o.id)).toEqual(["opt1", "opt3"]);
  });

  it("REQ-330 no options path slices bullets to a cap", () => {
    const srcs = [
      island(),
      readFileSync(
        resolve(
          ROOT,
          "backend/src/agents/domain/coordinators/generate-job-options/mod.ts",
        ),
        "utf8",
      ),
    ];
    for (const src of srcs) {
      expect(src).not.toMatch(/\.slice\(0,\s*MAX_(?:OPTION_)?BULLETS\)/);
    }
    const shared = readFileSync(
      resolve(ROOT, "shared/quote-flow/option-bullets.ts"),
      "utf8",
    );
    expect(shared).not.toMatch(/export const MAX_OPTION_BULLETS/);
  });

  it("REQ-330 the island's last-resort fallback never paints two cards with the same bullets", () => {
    const src = island();
    const start = src.indexOf("function localFallbackOptions(");
    const body = src.slice(start, src.indexOf("\n}\n", start));
    expect(body).toMatch(/dedupeOptionsByBullets\(/);
  });

  it("REQ-330 the prompt, in both dictionaries, groups past 12 and allows fewer options for a one-item job", () => {
    for (const f of ["lang/en.json", "lang/es.json"]) {
      const p = JSON.parse(
        readFileSync(resolve(ROOT, f), "utf8"),
      )["prompts.generateJobOptions"];
      expect(p).not.toMatch(/at most 12/i);
      expect(p).toMatch(/more than 12/i);
      expect(p).not.toMatch(/Return exactly 3 options\./);
      expect(p).toMatch(/same bullets/i);
    }
  });
});
