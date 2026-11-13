/**
 * REQ-734 — demo-loop cycle 5, issue m69: at 1280x800 the "Nueva suscripción" modal's
 * Cancelar / Agregar buttons sat below the fold of the modal's own scroller (the footer
 * was the last child of a scrolling column and was not sticky), and the field modal's
 * backdrop left no room for the demo pill's band (REQ-618 fixed that only for the New
 * invoice sheet). Its address placeholder was DocuMonster's own office address.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const css = read("front-end/static/field.css");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

/** the declarations of the first top-level rule whose selector is exactly `sel` */
const rule = (sel: string): string => {
  const esc = sel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = css.match(new RegExp(`(^|\\n)${esc}\\s*\\{([^}]*)\\}`));
  return (m?.[2] ?? "").replace(/\s+/g, " ").trim();
};

describe("REQ-734 (demo-loop cycle 5, m69) — the field modal's buttons stay in view", () => {
  test("REQ-734: .modal__foot sticks to the bottom of the modal's scroller, on an opaque ground", () => {
    const foot = rule(".modal__foot");
    expect(foot).toMatch(/position:\s*sticky/);
    // pinned to the box's bottom edge: minus .modal's bottom padding (24px), since a
    // sticky box stops at the scroller's content edge
    expect(rule(".modal")).toMatch(/padding:\s*24px 26px/);
    expect(foot).toMatch(/bottom:\s*-24px/);
    expect(foot).toMatch(/margin:\s*6px -26px -24px/);
    expect(foot).toMatch(/background:\s*#fff/);
    expect(foot).toMatch(/box-shadow:/);
  });

  test("REQ-734: the field modal's backdrop keeps the modal clear of the demo pill's band (as REQ-618)", () => {
    const bg = rule(".modal-bg");
    expect(bg).toMatch(/inset:\s*0/);
    expect(bg).toContain(
      "padding-bottom: calc(20px + var(--demo-pill-h, 0px))",
    );
    const modal = rule(".modal");
    expect(modal).toContain(
      "max-height: calc(100vh - 40px - var(--demo-pill-h, 0px))",
    );
  });

  for (const [lang, dict] of [["en", en], ["es", es]] as const) {
    test(`REQ-734: ${lang} address placeholder is a neutral example, not DocuMonster's office`, () => {
      const ph = dict["field.subs.addressPh"];
      expect(ph).toBeTruthy();
      expect(ph).not.toMatch(/Socastee|Myrtle Beach|4505/i);
      expect(ph).toContain("123 Main St, Springfield");
    });
  }
});
