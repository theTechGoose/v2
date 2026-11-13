/**
 * REQ-788 — the subscription form's upper-right "Overhead" toggle, styled as a weekday chip, adds
 * the overhead cost set in Settings to every visit.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-788 overhead toggle", () => {
  test("the subscription form has the toggle in the modal head, as a weekday chip", () => {
    const src = read("front-end/islands/FieldSubscriptionsPage.tsx");
    expect(src).toMatch(/data-cy="subs-overhead"/);
    // the chip sits in the modal's head row, next to the title
    expect(src).toMatch(/class="modal__head"/);
    // same style as the weekday chips: the .day class inside a .days wrapper, "on" when toggled
    expect(src).toMatch(
      /class=\{`day day--wide\$\{form\.overhead \? " on" : ""\}`\}/,
    );
    expect(src).toMatch(/fieldOverheadCents/);
    // off on a new subscription, remembered on an edit, sent on save
    expect(src).toMatch(/overhead: false/);
    expect(src).toMatch(/overhead: s\.overhead === true/);
    expect(src).toMatch(/overhead: f\.overhead/);
  });
  test("the chip's row is styled: the head is a flex row and the wide chip is sized by its text", () => {
    const css = read("front-end/static/field.css");
    expect(css).toMatch(/\.modal__head\s*\{[^}]*display:\s*flex/);
    expect(css).toMatch(/\.days \.day\.day--wide\s*\{[^}]*width:\s*auto/);
  });
  test("Settings collects the overhead cost as dollars and saves it as cents", () => {
    const src = read("front-end/islands/SettingsPage.tsx");
    expect(src).toMatch(/data-cy="settings-overhead"/);
    expect(src).toMatch(/saveIdentity\(\{ fieldOverheadCents/);
  });
  test("the clients carry the fields", () => {
    expect(read("front-end/clients/profile.ts")).toMatch(
      /fieldOverheadCents\?: number/,
    );
    const field = read("front-end/clients/field.ts");
    expect(field).toMatch(/overhead\?: boolean/);
  });
  test("labels in both languages", () => {
    for (const d of [en, es]) {
      for (
        const k of [
          "field.subs.overhead",
          "field.subs.overheadHint",
          "field.subs.overheadLabel",
          "settings.overhead",
          "settings.overheadHint",
        ]
      ) {
        expect(d[k]).toBeTruthy();
      }
      expect(d["field.subs.overhead"]).toMatch(/\{amount\}/);
    }
  });
});
