/**
 * REQ-458 (demo-loop cycle 3, demo M38) — "fix every issue the demo found,
 * loop until there are none". The demo saw the "Custom" job length as a dead
 * end: "Agreement reads: —", "NO input box", Lock it in disabled. The number
 * box was there (REQ-343 opens it empty on purpose) but it had no visible
 * label, no placeholder and no focus ring, and the preview showed a bare dash.
 *
 * Pure rule: shared/quote-flow/duration-input.ts (durationPreviewHint).
 * The source checks pin that CustomDurationPickerForm in
 * front-end/islands/AsstChat.tsx uses it and labels its fields; the browser
 * walk is e2e/custom-duration-input/custom-duration-input.e2e.test.ts.
 */
import * as fs from "fs";
import * as path from "path";
import { durationPreviewHint } from "../../shared/quote-flow/duration-input.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-458 M38: an empty custom duration says what to do", () => {
  test("REQ-458: empty (or blank) → the 'Type a number' hint, not a dash", () => {
    expect(durationPreviewHint("")).toBe("asstChat.duration.previewEmpty");
    expect(durationPreviewHint("  ")).toBe("asstChat.duration.previewEmpty");
    expect(durationPreviewHint(null)).toBe("asstChat.duration.previewEmpty");
  });
  test("REQ-458: a good typed number gets no hint — the preview speaks (REQ-677: a bad one reads 'Enter 1–99')", () => {
    expect(durationPreviewHint("4")).toBeNull();
    expect(durationPreviewHint("-3")).toBe("asstChat.duration.previewInvalid");
  });
  test("REQ-458: en and es carry the hint, the placeholder and the visible labels", () => {
    expect(en["asstChat.duration.previewEmpty"]).toBe("Type a number");
    expect(es["asstChat.duration.previewEmpty"]).toBe("Escribe un número");
    expect(en["asstChat.duration.numberPlaceholder"]).toBe("e.g. 3");
    expect(es["asstChat.duration.numberPlaceholder"]).toBe("p. ej. 3");
    expect(en["asstChat.duration.numberLabel"]).toBeTruthy();
    expect(es["asstChat.duration.numberLabel"]).toBeTruthy();
    expect(en["asstChat.duration.unitLabel"]).toBeTruthy();
    expect(es["asstChat.duration.unitLabel"]).toBeTruthy();
  });
});

describe("REQ-458 M38: the picker's number box is findable", () => {
  const chat = read("front-end/islands/AsstChat.tsx");
  const start = chat.indexOf("function CustomDurationPickerForm(");
  const end = chat.indexOf("\nfunction ", start + 10);
  const picker = chat.slice(start, end);

  test("REQ-458: the preview reads the hint when empty, not '—'", () => {
    expect(start).toBeGreaterThan(0);
    expect(picker).toMatch(/durationPreviewHint\(n\)/);
    // empty → the hint; REQ-677: a bad number reads "Enter 1–99", never "—"
    expect(picker).toMatch(/previewHint\s*\?\s*tFor\(lang, previewHint\)/);
  });
  test("REQ-458: the number has a visible <label for>, a placeholder, and the unit is labelled too", () => {
    expect(picker).toMatch(/<label[^>]*for="dur-num"/);
    expect(picker).toMatch(/id="dur-num"/);
    expect(picker).toMatch(
      /placeholder=\{tFor\(lang, "asstChat\.duration\.numberPlaceholder"\)\}/,
    );
    expect(picker).toMatch(/<label[^>]*for="dur-unit"/);
    expect(picker).toMatch(/id="dur-unit"/);
  });
  test("REQ-458: the unit is pre-selected (days unless the job named one)", () => {
    expect(picker).toMatch(/props\.initial\?\.unit \?\? "days"/);
  });
  test("REQ-458: the number box shows a focus ring", () => {
    const css = read("front-end/static/assistant-page.css");
    expect(css).toMatch(
      /\.dur__num:focus(-visible)?\s*\{[^}]*box-shadow:[^}]*\}/,
    );
    expect(css).toMatch(/\.dur__label\s*\{/);
  });
});
