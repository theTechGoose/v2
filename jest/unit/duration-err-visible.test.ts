/**
 * REQ-677 (demo-loop cycle 5, demo issue c4-m45) — "fix every issue the demo
 * found, loop until there are none". A custom job length of 0 days or 9999
 * months greyed out "Lock it in" with no message the testers could find:
 * "Agreement reads: — and Lock it in greyed out, but NO message telling me
 * why". REQ-390's reason rendered as a small line between the inputs and the
 * preset chips, away from the button.
 *
 * Now: the preview reads "Enter 1–99" instead of "—" for a bad number, and the
 * reason sits right above the disabled Lock it in, which points at it with
 * aria-describedby.
 *
 * Pure rule: shared/quote-flow/duration-input.ts (durationPreviewHint). The
 * source checks pin CustomDurationPickerForm in front-end/islands/AsstChat.tsx;
 * the browser walk is e2e/custom-duration-input/custom-duration-input.e2e.test.ts.
 */
import * as fs from "fs";
import * as path from "path";
import { durationPreviewHint } from "../../shared/quote-flow/duration-input.ts";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-677 c4-m45: a bad custom duration says 'Enter 1–99' in the preview", () => {
  test.each(["0", "9999", "-3", "2.5", "100", "abc"])(
    "REQ-677: %s → the 'Enter 1–99' hint, not '—'",
    (raw) => {
      expect(durationPreviewHint(raw)).toBe("asstChat.duration.previewInvalid");
    },
  );
  test("REQ-677: a good number gets no hint; empty keeps REQ-458's", () => {
    expect(durationPreviewHint("4")).toBeNull();
    expect(durationPreviewHint(" 99 ")).toBeNull();
    expect(durationPreviewHint("")).toBe("asstChat.duration.previewEmpty");
  });
  test("REQ-677: en and es carry the hint", () => {
    expect(en["asstChat.duration.previewInvalid"]).toBe("Enter 1–99");
    expect(es["asstChat.duration.previewInvalid"]).toBe("Escribe de 1 a 99");
  });
});

describe("REQ-677 c4-m45: the reason sits next to the disabled Lock it in", () => {
  const chat = read("front-end/islands/AsstChat.tsx");
  const start = chat.indexOf("function CustomDurationPickerForm(");
  const end = chat.indexOf("\nfunction ", start + 10);
  const picker = chat.slice(start, end);
  // The verify phase is the last return of the picker.
  const verify = picker.slice(picker.lastIndexOf('class="dur dur--verify"'));

  test("REQ-677: the preview shows the hint for a bad number (no bare '—')", () => {
    expect(start).toBeGreaterThan(0);
    expect(picker).toMatch(/durationPreviewHint\(n\)/);
    expect(picker).not.toMatch(/:\s*"—"/);
  });
  test("REQ-677: dur-num-err renders after the preview and right before the Lock it in row", () => {
    const err = verify.indexOf('id="dur-num-err"');
    const presets = verify.indexOf('class="dur__presets"');
    const preview = verify.indexOf('class="dur__preview-val"');
    const actions = verify.indexOf('class="cust-create__actions"');
    const lock = verify.indexOf('"asstChat.lockIn"');
    expect(err).toBeGreaterThan(presets);
    expect(err).toBeGreaterThan(preview);
    expect(err).toBeLessThan(actions);
    expect(actions).toBeLessThan(lock);
  });
  test("REQ-677: Lock it in points at the reason with aria-describedby", () => {
    const lockBtn = verify.slice(
      verify.lastIndexOf("<button", verify.indexOf('"asstChat.lockIn"')),
      verify.indexOf('"asstChat.lockIn"'),
    );
    expect(lockBtn).toMatch(
      /aria-describedby=\{parsedNum\.error \? "dur-num-err" : undefined\}/,
    );
  });
  test("REQ-677: the reason is announced when it appears", () => {
    const errTag = verify.slice(
      verify.indexOf('id="dur-num-err"') - 200,
      verify.indexOf('id="dur-num-err"') + 200,
    );
    expect(errTag).toMatch(/role="alert"/);
  });
});
