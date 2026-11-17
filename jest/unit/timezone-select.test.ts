/**
 * REQ-346 (demo-loop cycle 1, demo issue p8) — the Settings time-zone select
 * rendered with the browser's default look (no `inputStyle`, unlike the App
 * language select beside it) and listed raw IANA ids ("America/New_York").
 * Every zone the picker offers now has a human label in English and Spanish,
 * the option text is that label (the value stays the IANA id), and the select
 * carries the same `inputStyle` as the other Settings selects.
 * Target: shared/quote-flow/business-timezone.ts (PICKER_TIMEZONES,
 * timezoneLabelKey) + lang/{en,es}.json + front-end/islands/SettingsPage.tsx.
 */
import * as fs from "fs";
import * as path from "path";
import {
  PICKER_TIMEZONES,
  timezoneLabelKey,
} from "../../shared/quote-flow/business-timezone";

const ROOT = path.join(__dirname, "..", "..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;

describe("REQ-346 the Settings time-zone select is styled and reads in words", () => {
  it("REQ-346 offers the US zones, each a valid IANA id", () => {
    expect(PICKER_TIMEZONES).toEqual(
      expect.arrayContaining(["America/New_York", "America/Chicago"]),
    );
    for (const z of PICKER_TIMEZONES) {
      expect(() => new Intl.DateTimeFormat("en-US", { timeZone: z })).not
        .toThrow();
    }
  });

  it("REQ-346 every picker zone has a label in en and es that is not the raw id", () => {
    for (const z of PICKER_TIMEZONES) {
      const key = timezoneLabelKey(z);
      expect(key).toBe(`settings.tz.${z}`);
      expect(typeof en[key]).toBe("string");
      expect(typeof es[key]).toBe("string");
      expect(en[key]).not.toContain("/");
      expect(es[key]).not.toContain("/");
      expect(es[key]).not.toBe(en[key]);
    }
    expect(en[timezoneLabelKey("America/New_York")]).toBe(
      "Eastern (New York)",
    );
    expect(es[timezoneLabelKey("America/New_York")]).toBe(
      "Hora del Este (Nueva York)",
    );
  });

  it("REQ-346 the select carries inputStyle and renders the label, not the id", () => {
    const src = read("front-end/islands/SettingsPage.tsx");
    const start = src.indexOf('data-cy="settings-timezone"');
    expect(start).toBeGreaterThan(-1);
    const open = src.lastIndexOf("<select", start);
    const close = src.indexOf("</select>", start);
    const block = src.slice(open, close);
    expect(block).toMatch(/style=\{inputStyle\}/);
    expect(block).toMatch(/PICKER_TIMEZONES/);
    expect(block).toMatch(/timezoneLabel\(/);
    expect(block).not.toMatch(/>\{z\}<\/option>/);
    // no private, unlabelled copy of the list left in the island
    expect(src).not.toMatch(/const TIMEZONES\s*=/);
  });
});
