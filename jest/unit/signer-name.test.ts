/**
 * REQ-470 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3, issue m61 ("One-letter legal name ('x') signs a
 * binding agreement").
 *
 * RCA: PublicSignQuote enabled "Sign the agreement" whenever `name.trim()`
 * was non-empty, and the accept DTO took any string (or none). One shared
 * rule now: a legal name is two words that each carry a letter, or at least
 * three letters. The pad gates the button on it and says why inline.
 */
import * as fs from "fs";
import * as path from "path";
import {
  isValidSignerName,
  normalizeSignerName,
} from "../../shared/quote-flow/signer-name";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8");

describe("REQ-470 (demo cycle 3, m61): the signer's legal name rule", () => {
  it.each(["x", "X", " x ", "", "   ", "ab", "1", "12345", "x.", "--", "A1"])(
    "refuses %p",
    (raw) => {
      expect(isValidSignerName(raw)).toBe(false);
    },
  );

  it.each([
    "Ann",
    "Ana Pérez",
    "Tom K.",
    "J K",
    "María Nguyen",
    "Tom & Linda K.",
    "Zoë",
    "Lý Lan",
  ])("accepts %p", (raw) => {
    expect(isValidSignerName(raw)).toBe(true);
  });

  it("refuses a non-string", () => {
    expect(isValidSignerName(undefined)).toBe(false);
    expect(isValidSignerName(42 as unknown as string)).toBe(false);
  });

  it("normalizes whitespace (trim + collapse inner runs)", () => {
    expect(normalizeSignerName("  Ana   Pérez \n")).toBe("Ana Pérez");
  });
});

describe("REQ-470 (demo cycle 3, m61): the signing pad uses the rule", () => {
  const island = read("front-end/islands/PublicSignQuote.tsx");

  it("imports the shared rule", () => {
    expect(island).toMatch(
      /import \{[^}]*isValidSignerName[^}]*\} from "\.\.\/\.\.\/shared\/quote-flow\/signer-name\.ts"/,
    );
  });

  it("no longer gates signing on a bare non-empty name", () => {
    expect(island).not.toMatch(/if \(!trimmed\) return;/);
    expect(island).not.toMatch(/submitting \|\| !name\.trim\(\)/);
  });

  it("shows the inline hint for a typed but too-short name", () => {
    expect(island).toMatch(/publicSign\.nameInvalid/);
    expect(island).toMatch(/data-cy="sign-name-invalid"/);
  });

  it("en + es carry the inline hint", () => {
    const en = JSON.parse(read("lang/en.json"));
    const es = JSON.parse(read("lang/es.json"));
    expect(typeof en["publicSign.nameInvalid"]).toBe("string");
    expect(typeof es["publicSign.nameInvalid"]).toBe("string");
    expect(en["publicSign.nameInvalid"]).not.toBe(es["publicSign.nameInvalid"]);
  });
});
