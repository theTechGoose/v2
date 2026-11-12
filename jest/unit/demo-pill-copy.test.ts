/**
 * REQ-373 — Raphael: "fix every issue the demo found, loop until there are none."
 * Demo-loop cycle 2 (run r561db6d4), issues m2 + p13-h: the customer's collapsed pill said only
 * "Connected" (the guide's name lived in the button's aria-label/title only); the expanded pill
 * said "Alex from DocuMonster is guiding you" and then a chip "Alex from DocuMonster" (the name
 * twice); and a screen reader heard the name in the sentence, the chip and the button's
 * aria-label (which was that same sentence).
 *
 * The words are one pure helper, `pillCopy` (shared/demo-mode/pill-copy.ts), checked against the
 * real dictionaries; the island's use of it is pinned on its source, the way REQ-294 pins it.
 */
import * as fs from "fs";
import * as path from "path";
import en from "../../lang/en.json";
import es from "../../lang/es.json";
import { guideFirstName, pillCopy } from "../../shared/demo-mode/pill-copy.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

const tr =
  (dict: Record<string, string>) =>
  (key: string, vars?: Record<string, string | number>) => {
    let s = dict[key];
    if (s === undefined) throw new Error(`missing key ${key}`);
    for (const [k, v] of Object.entries(vars ?? {})) {
      s = s.split(`{${k}}`).join(String(v));
    }
    return s;
  };
const tEn = tr(en as Record<string, string>);
const tEs = tr(es as Record<string, string>);

const alex = [{ userId: "a", name: "Alex from DocuMonster", color: "#2f6d29" }];
const two = [
  { userId: "h", name: "Hans Weber", color: "#2f6d29" },
  { userId: "l", name: "Lia", color: "#7a3fb0" },
];

describe("REQ-373 (demo m2) the collapsed pill names the guide", () => {
  test("the guide's first name is the first word of their name", () => {
    expect(guideFirstName("Alex from DocuMonster")).toBe("Alex");
    expect(guideFirstName("  Lia  ")).toBe("Lia");
    expect(guideFirstName("")).toBe("");
  });

  test("one presenter: the short name is their first name; several: each first name", () => {
    const one = pillCopy({
      presenters: alex,
      status: "Connected",
      compact: true,
      open: false,
      t: tEn,
    });
    expect(one.shortName).toBe("Alex");
    const many = pillCopy({
      presenters: two,
      status: "Connected",
      compact: true,
      open: false,
      t: tEn,
    });
    expect(many.shortName).toBe("Hans, Lia");
  });

  test("the short name shows only while the details are hidden (compact and closed)", () => {
    expect(
      pillCopy({
        presenters: alex,
        status: "Connected",
        compact: true,
        open: false,
        t: tEn,
      }).showShort,
    ).toBe(true);
    expect(
      pillCopy({
        presenters: alex,
        status: "Connected",
        compact: true,
        open: true,
        t: tEn,
      }).showShort,
    ).toBe(false);
    expect(
      pillCopy({
        presenters: alex,
        status: "Connected",
        compact: false,
        open: false,
        t: tEn,
      }).showShort,
    ).toBe(false);
  });
});

describe("REQ-373 (demo m2, p13-h) the name is said once", () => {
  test("one presenter: no chips next to the sentence; two or more: chips", () => {
    expect(
      pillCopy({
        presenters: alex,
        status: "Connected",
        compact: false,
        open: false,
        t: tEn,
      }).showChips,
    ).toBe(false);
    expect(
      pillCopy({
        presenters: two,
        status: "Connected",
        compact: false,
        open: false,
        t: tEn,
      }).showChips,
    ).toBe(true);
  });

  test("the details button's label is the status, never the guiding sentence", () => {
    const closed = pillCopy({
      presenters: alex,
      status: "Connected",
      compact: true,
      open: false,
      t: tEn,
    });
    expect(closed.moreLabel).toBe("Connected, show details");
    const opened = pillCopy({
      presenters: alex,
      status: "Connected",
      compact: true,
      open: true,
      t: tEn,
    });
    expect(opened.moreLabel).toBe("Connected, hide details");
    const full = pillCopy({
      presenters: alex,
      status: "Connected",
      compact: false,
      open: false,
      t: tEn,
    });
    expect(full.moreLabel).toBe("Connected");
    for (const c of [closed, opened, full]) {
      expect(c.moreLabel).not.toContain("Alex");
    }
  });

  test("Spanish says the same", () => {
    const c = pillCopy({
      presenters: alex,
      status: "Conectado",
      compact: true,
      open: false,
      t: tEs,
    });
    expect(c.moreLabel).toBe("Conectado, ver detalles");
    expect(
      pillCopy({
        presenters: alex,
        status: "Conectado",
        compact: true,
        open: true,
        t: tEs,
      }).moreLabel,
    )
      .toBe("Conectado, ocultar detalles");
  });
});

describe("REQ-373 the customer's pill uses pillCopy", () => {
  const o = read("front-end/islands/DemoModeOverlay.tsx");
  const from = o.indexOf('data-cy="demo-pill"\n        data-restarted');
  const pill = o.slice(from, o.indexOf("<EndDemo", from));

  test("the island imports pillCopy", () => {
    expect(o).toMatch(
      /pillCopy,?[\s\S]*?from "\.\.\/\.\.\/shared\/demo-mode\/pill-copy\.ts"/,
    );
  });

  test("the chips render only when there are several presenters", () => {
    expect(pill).toMatch(/\{copy\.showChips && \(?\s*<PresenterChips/);
  });

  test("the guide's first name is drawn in the compact pill, outside the details button", () => {
    const guide = pill.indexOf('data-cy="demo-guide"');
    expect(guide).toBeGreaterThan(-1);
    expect(guide).toBeLessThan(pill.indexOf('data-cy="demo-more"'));
    expect(pill).toContain("{copy.shortName}");
  });

  test("the details button's aria-label is copy.moreLabel; it carries no title or label of the sentence", () => {
    const more = pill.slice(pill.indexOf('data-cy="demo-more"'));
    expect(more).toContain("aria-label={copy.moreLabel}");
    expect(more).not.toMatch(/aria-label=\{line\}/);
    expect(more.slice(0, more.indexOf("onClick"))).not.toMatch(
      /title=\{line\}/,
    );
  });

  test("one live region: the customer's pill is the only role=status", () => {
    const live = o.slice(
      o.indexOf("{presenters.map((p) => (\n        <PeerPointer"),
    );
    expect(live.match(/role="status"/g) ?? []).toHaveLength(1);
  });
});
