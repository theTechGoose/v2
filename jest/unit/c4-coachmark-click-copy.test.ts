/**
 * REQ-616 — demo cycle 4, issue p4-p8e: the dashboard coachmark said "Tap here to talk
 * to your assistant" / "Tap anywhere to dismiss" on desktop, where a mouse clicks. The island only
 * shows when the sidebar's /assistant pill is on screen (desktop/tablet), so the copy must follow
 * the primary pointer: click wording for a fine pointer (mouse), tap wording for a coarse one.
 */
import * as fs from "fs";
import * as path from "path";
import {
  COACHMARK_COARSE_QUERY,
  coachmarkCopyKeys,
} from "../../front-end/lib/coachmark-copy";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const en = JSON.parse(read("lang/en.json")) as Record<string, string>;
const es = JSON.parse(read("lang/es.json")) as Record<string, string>;
const SLOTS = ["ariaLabel", "body", "dismissHint", "heading"] as const;

describe("REQ-616 coachmark copy follows the primary pointer (p4-p8e)", () => {
  test("the media query asks about the primary pointer being coarse", () => {
    expect(COACHMARK_COARSE_QUERY).toBe("(pointer: coarse)");
  });

  test("a fine pointer (mouse) gets click wording in en, with no 'tap'", () => {
    const keys = coachmarkCopyKeys(false);
    for (const slot of SLOTS) {
      const s = en[keys[slot]];
      expect(typeof s).toBe("string");
      expect(s).not.toMatch(/\btap/i);
    }
    expect(en[keys.heading]).toBe("Click here to talk to your assistant");
    expect(en[keys.dismissHint]).toBe("Click anywhere to dismiss");
    expect(en[keys.body]).toMatch(/Click to start\.$/);
    expect(en[keys.ariaLabel]).toMatch(/click anywhere to dismiss$/);
  });

  test("a fine pointer gets click wording in es, with no 'toca'", () => {
    const keys = coachmarkCopyKeys(false);
    for (const slot of SLOTS) {
      const s = es[keys[slot]];
      expect(typeof s).toBe("string");
      expect(s).not.toMatch(/\btoca/i);
    }
    expect(es[keys.heading]).toBe("Haz clic aquí para hablar con tu asistente");
    expect(es[keys.dismissHint]).toBe(
      "Haz clic en cualquier lugar para cerrar",
    );
  });

  test("a coarse pointer (touch) keeps the tap wording", () => {
    const keys = coachmarkCopyKeys(true);
    expect(en[keys.heading]).toBe("Tap here to talk to your assistant");
    expect(en[keys.dismissHint]).toBe("Tap anywhere to dismiss");
    expect(es[keys.heading]).toBe("Toca aquí para hablar con tu asistente");
  });

  test("the island picks its keys through coachmarkCopyKeys + matchMedia, not hard-coded tap keys", () => {
    const src = read("front-end/islands/AssistantCoachmark.tsx");
    expect(src).toMatch(/coachmarkCopyKeys\(/);
    expect(src).toMatch(/matchMedia\(\s*COACHMARK_COARSE_QUERY/);
    expect(src).not.toMatch(/tFor\(lang,\s*"assistantCoachmark\./);
  });

  test("en and es carry the same coachmark keys", () => {
    const keys = (d: Record<string, string>) =>
      Object.keys(d).filter((k) => k.startsWith("assistantCoachmark.")).sort();
    expect(keys(es)).toEqual(keys(en));
  });
});
