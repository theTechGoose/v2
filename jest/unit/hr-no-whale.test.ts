/**
 * REQ-1158 (LOOP-007 cycle 3, q3-90; REVISION of REQ-884 b) — the new-hire text, the /sign
 * greeting and the /sign brand slot carry no emoji. The whale came over from the "Monster
 * Onboarding" prototype's in-house branding; every business now texts it to its hires in its
 * own name. The owner's preview (front-end/lib/hr.ts inviteText) renders the same dictionary
 * key the backend sends (hr.sms.invite), in the language asked for, so it cannot drift.
 */
import * as fs from "fs";
import * as path from "path";
import { inviteText } from "../../front-end/lib/hr";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const dict = (lang: "en" | "es") =>
  JSON.parse(read(`lang/${lang}.json`)) as Record<string, string>;
const fill = (s: string, v: Record<string, string>) =>
  s.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m));
const PICTO = /\p{Extended_Pictographic}/u;

const VARS = {
  first: "Rosa",
  company: "Reyes Lawn & Pool",
  url: "https://documonster.com/sign/abc",
};

describe("REQ-1158 (q3-90) HR new-hire copy carries no whale emoji", () => {
  for (const lang of ["en", "es"] as const) {
    test(`REQ-1158 no hr.* key in lang/${lang}.json contains an emoji`, () => {
      const d = dict(lang);
      const bad = Object.entries(d)
        .filter(([k, v]) => k.startsWith("hr.") && PICTO.test(v))
        .map(([k, v]) => `${k}: ${v}`);
      expect(bad).toEqual([]);
    });

    test(`REQ-1158 hr.sms.invite (${lang}) reads "${
      lang === "en" ? "Hey Rosa! Welcome to" : "¡Hola Rosa! Bienvenido a"
    } …" with no emoji`, () => {
      const sms = fill(dict(lang)["hr.sms.invite"], VARS);
      expect(sms).not.toMatch(PICTO);
      expect(sms.startsWith(
        lang === "en" ? "Hey Rosa! Welcome to" : "¡Hola Rosa! Bienvenido a",
      )).toBe(true);
    });

    test(`REQ-1158 inviteText(..., "${lang}") — the owner's preview — equals the ${lang} hr.sms.invite the hire is sent, with no emoji`, () => {
      // the preview takes the language as its 4th argument (it ignored the language before)
      const preview = (inviteText as unknown as (
        first: string,
        company: string,
        url: string,
        lang: "en" | "es",
      ) => string)(VARS.first, VARS.company, VARS.url, lang);
      expect(preview).not.toMatch(PICTO);
      expect(preview).toBe(fill(dict(lang)["hr.sms.invite"], VARS));
    });
  }

  test("REQ-1158 front-end/lib/hr.ts keeps no hardcoded copy of the whale text", () => {
    expect(read("front-end/lib/hr.ts")).not.toMatch(PICTO);
  });

  test("REQ-1158 the /sign brand slot does not fall back to an emoji when no company name is set", () => {
    const src = read("front-end/islands/HrSignPacket.tsx");
    const brand = src.match(/class="hrs__brand"[^>]*>([\s\S]*?)<\/span>/);
    expect(brand).not.toBeNull();
    expect(brand![1]).not.toMatch(PICTO);
  });
});
