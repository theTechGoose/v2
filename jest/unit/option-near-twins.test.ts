/**
 * REQ-584 (demo-loop cycle 4, issue p4-p1d) — "Job Details options differ
 * only by a word."
 *
 * Pair 1's one-scope interior paint job showed three cards (Concise /
 * Standard / Detailed) that read the same. The only dedupe,
 * dedupeOptionsByBullets → sameBullets, collapsed EXACT twins (same lines,
 * same order) only, so a card that differs by one word — or that holds the
 * same words regrouped into fewer lines — survived. Options are now twins
 * when the word sets of all their bullets overlap by a Jaccard of 0.85 or
 * more; the first one is kept.
 */
import {
  bulletTokenOverlap,
  dedupeOptionsByBullets,
  groupedBullets,
  NEAR_TWIN_OVERLAP,
  nearTwinBullets,
  seedPickerOptions,
} from "../../shared/quote-flow/option-bullets";

const PAINT = [
  "Prep walls: patch nail holes and sand",
  "Paint walls in 3 bedrooms, two coats",
  "Materials included",
];

describe("REQ-584 (cycle 4, p4-p1d) near-twin job options collapse", () => {
  it("REQ-584 the threshold is a token-set Jaccard of about 0.85", () => {
    expect(NEAR_TWIN_OVERLAP).toBeGreaterThanOrEqual(0.8);
    expect(NEAR_TWIN_OVERLAP).toBeLessThanOrEqual(0.9);
    expect(bulletTokenOverlap(PAINT, PAINT)).toBe(1);
    expect(bulletTokenOverlap(["a b"], ["c d"])).toBe(0);
  });

  it("REQ-584 options that differ by one word are twins", () => {
    const oneWord = [
      "Prep walls: patch nail holes and sand",
      "Paint walls in 3 bedrooms, two full coats",
      "Materials included",
    ];
    expect(nearTwinBullets(PAINT, oneWord)).toBe(true);
  });

  it("REQ-584 case, accents, plurals and punctuation are not differences", () => {
    expect(
      nearTwinBullets(
        ["Paint the bedroom walls", "Two coats"],
        ["paint the bedrooms' walls.", "two coat"],
      ),
    ).toBe(true);
    expect(nearTwinBullets(["Pintar la habitación"], ["pintar la habitacion"]))
      .toBe(true);
  });

  it("REQ-584 the same words regrouped into fewer lines are twins", () => {
    expect(nearTwinBullets(PAINT, groupedBullets(PAINT))).toBe(true);
  });

  it("REQ-584 versions that really say more are not twins", () => {
    const concise = [
      "Kitchen demolition and haul away",
      "New cabinets and quartz countertops",
    ];
    const detailed = [
      "Full kitchen demolition to the studs",
      "Haul away all demolition debris",
      "Install 22 lf of new cabinets",
      "48 sqft quartz countertops",
    ];
    expect(nearTwinBullets(concise, detailed)).toBe(false);
    expect(nearTwinBullets(["Paint walls"], ["Paint ceilings"])).toBe(false);
  });

  it("REQ-584 pair 1: three cards differing by a word collapse to the first", () => {
    const out = dedupeOptionsByBullets([
      { id: "opt1", bullets: PAINT },
      {
        id: "opt2",
        bullets: [
          "Prep walls: patch nail holes and sand",
          "Paint walls in all 3 bedrooms, two coats",
          "Materials included",
        ],
      },
      {
        id: "opt3",
        bullets: [
          "Prep walls: patch nail holes and sand",
          "Paint walls in 3 bedrooms, two coats",
          "All materials included",
        ],
      },
    ]);
    expect(out.map((o) => o.id)).toEqual(["opt1"]);
  });

  it("REQ-584 a distinct version between twins survives, order kept", () => {
    const out = dedupeOptionsByBullets([
      { id: "a", bullets: PAINT },
      {
        id: "b",
        bullets: [
          ...PAINT,
          "Paint ceilings and trim in every bedroom",
          "Caulk baseboards and door casings",
        ],
      },
      { id: "c", bullets: groupedBullets(PAINT) },
    ]);
    expect(out.map((o) => o.id)).toEqual(["a", "b"]);
  });

  it("REQ-584 the edit-reopen seed drops a regenerated near-twin of the current details", () => {
    const current = {
      id: "current",
      jobName: "Paint",
      summary: "",
      bullets: PAINT,
    };
    const out = seedPickerOptions(current, [
      {
        id: "opt1",
        jobName: "Paint",
        summary: "",
        bullets: groupedBullets(PAINT),
      },
    ]);
    expect(out.map((o) => o.id)).toEqual(["current"]);
  });

  it("REQ-584 exact mode keeps the degraded fallback's titled versions (equal bullets only)", () => {
    const out = dedupeOptionsByBullets(
      [
        { id: "full", bullets: PAINT },
        { id: "short", bullets: groupedBullets(PAINT) },
        { id: "same", bullets: [...PAINT] },
      ],
      { exact: true },
    );
    expect(out.map((o) => o.id)).toEqual(["full", "short"]);
  });
});
