/**
 * REQ-685 — demo-loop cycle 5, issue m42: "Change order Version 2 doesn't
 * say what changed."
 *
 * Editing a change order publishes Version 2 (REQ-201/462), but /co never
 * said what Version 2 changed — REQ-304 built that line for quotes only.
 * `changeOrderChanges` compares the filed version against the live one
 * (description + signed delta); `changeOrderChangeLine` renders it in the
 * page's language, and /co shows it under the headline as
 * public.doc.whatChanged ("What changed in Version {n}: …").
 */
import * as fs from "fs";
import * as path from "path";
import {
  changeOrderChangeLine,
  changeOrderChanges,
} from "../../shared/quote-flow/change-order-view";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

describe("REQ-685 m42: what a change order's new version changed", () => {
  test("REQ-685 an amount edit is reported before → after", () => {
    expect(
      changeOrderChanges(
        { description: "Add pantry shelving", deltaAmountCents: 160_000 },
        { description: "Add pantry shelving", deltaAmountCents: 180_000 },
      ),
    ).toEqual({ deltaAmountCents: { from: 160_000, to: 180_000 } });
  });

  test("REQ-685 a description edit is reported before → after (trimmed)", () => {
    expect(
      changeOrderChanges(
        { description: "Add shelving ", deltaAmountCents: 85_000 },
        { description: "Add pantry shelving", deltaAmountCents: 85_000 },
      ),
    ).toEqual({
      description: { from: "Add shelving", to: "Add pantry shelving" },
    });
  });

  test("REQ-685 nothing changed (or no previous version) → undefined", () => {
    expect(
      changeOrderChanges(
        { description: "A", deltaAmountCents: 1 },
        { description: "A", deltaAmountCents: 1 },
      ),
    ).toBeUndefined();
    expect(
      changeOrderChanges(undefined, { description: "A", deltaAmountCents: 1 }),
    ).toBeUndefined();
  });

  test("REQ-685 the line reads signed amounts, and the description, in EN and ES", () => {
    const c = {
      deltaAmountCents: { from: 160_000, to: 180_000 },
      description: { from: "Add shelving", to: "Add pantry shelving" },
    };
    expect(changeOrderChangeLine(c, "en")).toBe(
      "Amount +$1,600.00 → +$1,800.00 · Description: “Add shelving” → “Add pantry shelving”",
    );
    expect(changeOrderChangeLine(c, "es")).toBe(
      "Monto +$1,600.00 → +$1,800.00 · Descripción: “Add shelving” → “Add pantry shelving”",
    );
    expect(
      changeOrderChangeLine({ deltaAmountCents: { from: 5_000, to: -2_500 } }),
    ).toBe("Amount +$50.00 → −$25.00");
    expect(changeOrderChangeLine({})).toBe("");
  });

  test("REQ-685 a long description is clipped to one short phrase", () => {
    const long = "x".repeat(120);
    const line = changeOrderChangeLine({
      description: { from: "Short", to: long },
    });
    expect(line.length).toBeLessThan(110);
    expect(line).toContain("…");
  });

  test("REQ-685 /co renders the line with public.doc.whatChanged", () => {
    const route = read("front-end/routes/co/[id].tsx");
    expect(route).toMatch(/changesFromPrevious/);
    expect(route).toMatch(/changeOrderChangeLine/);
    expect(route).toMatch(/"public\.doc\.whatChanged"/);
    expect(route).toMatch(/data-cy="co-changes"/);
  });
});
