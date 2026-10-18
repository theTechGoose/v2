/**
 * REQ-081 — Raphael, 2026-10-16: "take this mock … make it real at /landing2 and make sure all
 * aspects of the page are working."
 *
 * "Real" means the page reads the site's one sources instead of carrying copies the mock had
 * inline: the plans and their prices (shared/quote-flow/pricing-plans.ts, P-08), the support
 * phone and the address (shared/legal/contact.ts, REQ-044), the four policy links
 * (shared/legal/terms.ts, REQ-076), both languages from the dictionaries (lang/*.json), the
 * Meta Pixel on it as on the other two websites (REQ-080), and no link into a hard-coded host —
 * the mock's "https://documonster.com/login" is the app's own /login. The image the mock shipped
 * is a tracked PNG under front-end/static (REQ-075).
 */
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { isPixelPage } from "../../shared/meta-pixel/pixel";
import { PUBLIC_PLANS } from "../../shared/quote-flow/pricing-plans";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

const PAGE = "front-end/routes/landing2.tsx";
const ISLANDS = [
  "front-end/islands/Landing2Signup.tsx",
  "front-end/islands/Landing2Demo.tsx",
];
const SOURCES = [PAGE, ...ISLANDS];

describe("REQ-081 /landing2 is wired to the site's one sources", () => {
  test("the route, its islands, its stylesheet and its image exist", () => {
    for (const f of SOURCES) expect(exists(f)).toBe(true);
    expect(exists("front-end/static/landing2.css")).toBe(true);
    expect(exists("front-end/static/monster-paper.png")).toBe(true);
    // REQ-075: a PNG a page references is a tracked file
    const tracked = execSync("git ls-files front-end/static/monster-paper.png", { cwd: ROOT }).toString().trim();
    expect(tracked).toBe("front-end/static/monster-paper.png");
    expect(read(PAGE)).toMatch(/\/monster-paper\.png/);
    expect(read(PAGE)).toMatch(/\/landing2\.css/);
  });

  test("the plans are the one plan list — PUBLIC_PLANS — never a copy of names, prices or features", () => {
    const src = read(PAGE);
    expect(src).toMatch(/PUBLIC_PLANS/);
    expect(src).toMatch(/pricing-plans\.ts/);
    // no price typed by hand on the page
    for (const p of PUBLIC_PLANS) {
      if (!p.custom) expect(src).not.toMatch(new RegExp(`"\\$${Math.round(p.priceCents / 100)}"`));
    }
    for (const src2 of SOURCES.map(read)) {
      expect(src2).not.toMatch(/Facturas ilimitadas|Unlimited invoices/);
    }
  });

  test("the phone, the address and the policy links come from their shared modules; no hard-coded host", () => {
    const src = read(PAGE);
    expect(src).toMatch(/SUPPORT_PHONE_HREF/);
    expect(src).toMatch(/SUPPORT_PHONE_DISPLAY/);
    expect(src).toMatch(/SUPPORT_PHONE_E164/); // the WhatsApp link is the same line
    expect(src).toMatch(/BUSINESS_ADDRESS/);
    expect(src).toMatch(/LEGAL_LINKS/);
    expect(src).toMatch(/data-legal-link/);
    for (const s of SOURCES.map(read)) {
      expect(s).not.toMatch(/855-362-8666|18553628666/);
      expect(s).not.toMatch(/https?:\/\/(www\.)?documonster\.com\//);
      expect(s).not.toMatch(/4505 Socastee/);
    }
  });

  test("every dictionary key the page and its islands read exists in BOTH languages, the two languages differ, and no landing2 key goes unread", () => {
    const page = read(PAGE);
    const keys = new Set<string>();
    // t("key") on the page — `t` prefixes "landing2."
    for (const m of page.matchAll(/\bt\("([A-Za-z0-9_.]+)"\)/g)) keys.add(`landing2.${m[1]}`);
    // the label lists handed to the islands: pick([ "a", "b", … ] as const)
    for (const block of page.matchAll(/pick\(\s*\[([\s\S]*?)\]\s*as const/g)) {
      for (const m of block[1].matchAll(/"([A-Za-z0-9_.]+)"/g)) keys.add(`landing2.${m[1]}`);
    }
    // the families the page enumerates by number or id
    for (const n of [1, 2, 3]) for (const part of ["title", "body"]) keys.add(`landing2.outcome.${n}.${part}`);
    for (const n of [1, 2]) for (const part of ["name", "role", "line", "photo"]) keys.add(`landing2.team.${n}.${part}`);
    for (const n of [1, 2, 3]) keys.add(`landing2.point.${n}`);
    for (const n of [1, 2, 3, 4]) for (const part of ["q", "a"]) keys.add(`landing2.faq.${n}.${part}`);
    for (const p of PUBLIC_PLANS) for (const part of ["sub", "cta"]) keys.add(`landing2.plan.${p.id}.${part}`);
    for (const id of ["terms", "refunds", "privacy", "sms"]) keys.add(`landing2.footer.${id}`);
    expect(keys.size).toBeGreaterThan(80);
    const missing = [...keys].filter((k) => !(k in en) || !(k in es));
    expect(missing).toEqual([]);
    // the two languages are two languages (a few labels are the same on purpose: "WhatsApp", "ES", names)
    const same = [...keys].filter((k) => en[k] === es[k] && /[a-z]{4}/.test(en[k]));
    expect(same.length).toBeLessThan(keys.size / 10);
    // no landing2 key sits in a dictionary unread
    const unread = Object.keys(en).filter((k) => k.startsWith("landing2.") && !keys.has(k));
    expect(unread).toEqual([]);
    expect(Object.keys(es).filter((k) => k.startsWith("landing2."))).toEqual(Object.keys(en).filter((k) => k.startsWith("landing2.")));
  });

  test("the pixel loads on /landing2 as on the other two websites, and the app shell treats it as Spanish-first", () => {
    expect(isPixelPage("/landing2")).toBe(true);
    expect(isPixelPage("/landing2/")).toBe(true);
    expect(read("front-end/routes/_app.tsx")).toMatch(/"\/landing2"/);
  });

  test("the signup island sends the code, confirms it against the real verify endpoint and fires the Lead once; the demo island posts the booking", () => {
    const signup = read(ISLANDS[0]);
    expect(signup).toMatch(/landingClient\.sendOtp/);
    expect(signup).toMatch(/verifyClient\.verifyOtp/);
    expect(signup).toMatch(/leadEvent/);
    expect(signup).toMatch(/firePixelEvent/);
    const demo = read(ISLANDS[1]);
    expect(demo).toMatch(/landingClient\.requestDemo/);
    expect(read("front-end/clients/landing.ts")).toMatch(/"\/demo-request"/);
  });

  test("the sitemap lists /landing2 next to the other websites", () => {
    expect(read("front-end/static/sitemap.xml")).toContain("<loc>https://paperworkmonster.com/landing2</loc>");
  });
});
