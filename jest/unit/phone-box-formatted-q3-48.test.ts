/**
 * REQ-1120 (LOOP-007 cycle 3, q3-48 + q3-49) — the New-worker Phone box (/field/workers,
 * data-cy=wk-phone) and the editor-invite Phone box (/admins, data-cy=adm-phone) show the
 * placeholder "(555) 123-4567" but carry maxlength={10}. The browser cuts a fill or paste to
 * 10 raw characters BEFORE the island's onInput strips non-digits, so "843-555-0123" lands as
 * "84355501" and "(843) 555-0123" as "843555". This suite models that browser order (cut to the
 * input's maxlength, then the island's digit strip) on the real input's attributes, so it fails
 * while the box is too short for its own placeholder's format.
 */
import * as fs from "fs";
import * as path from "path";
import { PHONE_PLACEHOLDER } from "../../front-end/lib/field";

const ROOT = path.resolve(__dirname, "../..");

/** the JSX of the <input …/> that carries data-cy={cy} */
function inputTag(file: string, cy: string): string {
  const src = fs.readFileSync(path.join(ROOT, file), "utf8");
  const at = src.indexOf(`data-cy="${cy}"`);
  if (at < 0) throw new Error(`${cy} not found in ${file}`);
  const start = src.lastIndexOf("<input", at);
  const end = src.indexOf("/>", at);
  return src.slice(start, end);
}

/** the browser's maxlength cut (Infinity when the input has none) */
function maxLen(tag: string): number {
  const m = tag.match(/maxlength=\{?"?(\d+)/i);
  return m ? Number(m[1]) : Infinity;
}

/** what the box holds after a fill/paste: the browser cut first, then the island's digit strip */
function held(tag: string, typed: string): string {
  const cut = typed.slice(0, maxLen(tag));
  return cut.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "").slice(0, 10);
}

const BOXES: Array<[string, string, string]> = [
  ["q3-48 New worker", "front-end/islands/FieldWorkersPage.tsx", "wk-phone"],
  ["q3-49 Invite an editor", "front-end/islands/AdminsPage.tsx", "adm-phone"],
];

describe.each(BOXES)(
  "REQ-1120 (LOOP-007 q3, %s): the Phone box takes a number typed the way its placeholder shows",
  (_label, file, cy) => {
    const tag = inputTag(file, cy);

    it(`REQ-1120: ${cy} is long enough for its own placeholder "${PHONE_PLACEHOLDER}" and for "+1 (843) 555-0123"`, () => {
      expect(maxLen(tag)).toBeGreaterThanOrEqual(PHONE_PLACEHOLDER.length);
      expect(maxLen(tag)).toBeGreaterThanOrEqual("+1 (843) 555-0123".length);
    });

    it(`REQ-1120: ${cy} has no digits-only pattern that refuses the formatted placeholder`, () => {
      const m = tag.match(/pattern="([^"]*)"/);
      if (m) {
        expect(new RegExp(`^(?:${m[1]})$`).test(PHONE_PLACEHOLDER)).toBe(true);
      }
    });

    it.each([
      ["843-555-0123", "8435550123"],
      ["(843) 555-0123", "8435550123"],
      ["+1 (843) 555-0123", "8435550123"],
      ["8435550123", "8435550123"],
    ])(`REQ-1120: ${cy} filled with %p holds the 10 digits %p`, (typed, digits) => {
      expect(held(tag, typed)).toBe(digits);
    });
  },
);
