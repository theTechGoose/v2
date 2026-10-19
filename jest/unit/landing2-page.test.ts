/**
 * REQ-081 — Raphael, 2026-10-16: "take this mock … make it real at /landing2 and make sure all
 * aspects of the page are working." REQ-088/089/090 — Raphael, 2026-10-18: "this is the newest
 * itteration of landing2 can you update it?" — the v3 mock (documonster-landing, approved Oct 18).
 * REQ-092/093 — Raphael, 2026-10-19, on the shipped page: "the call us button on the bottom is
 * broken it should scroll us to call us, the 1-855 button to call does not pick up the phone app
 * or facetime etc..." and "big jobs plan or bids needs 10px of padding." REQ-094 — Raphael,
 * 2026-10-19, on that worktree: "go through this with a fine tooth comb." — the audit of the whole
 * page, and what it found.
 *
 * "Real" means the page reads the site's one sources instead of carrying copies the mock had
 * inline: the plans and their prices (shared/quote-flow/pricing-plans.ts, P-08), the support
 * phone and the address (shared/legal/contact.ts, REQ-044), the four policy links
 * (shared/legal/terms.ts, REQ-076), both languages from the dictionaries (lang/*.json), the
 * Meta Pixel on it as on the other two websites (REQ-080), and no link into a hard-coded host —
 * the mock's "https://documonster.com/login" is the app's own /login. The images the mock ships
 * are tracked files under front-end/static (REQ-075): the monster, and now Art and Ben.
 */
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { isPixelPage } from "../../shared/meta-pixel/pixel";
import { PUBLIC_PLANS } from "../../shared/quote-flow/pricing-plans";
import { DEMO_DAY_COUNT, DEMO_SLOTS } from "../../shared/demo-booking/mod";
import { OG_IMAGE } from "../../shared/quote-flow/site-meta";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));
const tracked = (rel: string) =>
  execSync(`git ls-files ${rel}`, { cwd: ROOT }).toString().trim() === rel;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

const PAGE = "front-end/routes/landing2.tsx";
const CSS = "front-end/static/landing2.css";
const ISLANDS = [
  "front-end/islands/Landing2Signup.tsx",
  "front-end/islands/Landing2Demo.tsx",
];
const SOURCES = [PAGE, ...ISLANDS];
const CARD_PLANS = PUBLIC_PLANS.filter((p) => !p.custom);
const LINE_PLANS = PUBLIC_PLANS.filter((p) => p.custom);

describe("REQ-081 /landing2 is wired to the site's one sources", () => {
  test("the route, its islands, its stylesheet and its images exist and are tracked", () => {
    for (const f of SOURCES) expect(exists(f)).toBe(true);
    expect(exists(CSS)).toBe(true);
    // REQ-075: an image a page references is a tracked file — the monster, Art and Ben (REQ-088)
    for (const img of ["monster-paper.png", "team-art.jpg", "team-ben.jpg"]) {
      expect([img, tracked(`front-end/static/${img}`)]).toEqual([img, true]);
      expect(read(PAGE)).toMatch(new RegExp(`/${img.replace(".", "\\.")}`));
    }
    expect(read(PAGE)).toMatch(/\/landing2\.css/);
  });

  test("the plans are the one plan list — PUBLIC_PLANS — never a copy of names, prices or features; the custom plan is the call-us line", () => {
    const src = read(PAGE);
    expect(src).toMatch(/PUBLIC_PLANS/);
    expect(src).toMatch(/pricing-plans\.ts/);
    // no price typed by hand on the page
    for (const p of PUBLIC_PLANS) {
      if (!p.custom) {
        expect(src).not.toMatch(
          new RegExp(`"\\$${Math.round(p.priceCents / 100)}"`),
        );
      }
    }
    for (const src2 of SOURCES.map(read)) {
      expect(src2).not.toMatch(/Facturas ilimitadas|Unlimited invoices/);
    }
    // REQ-088: three cards and a line — the line names the custom plan from the list, not by hand
    expect(src).toMatch(/data-cy="l2-projects"/);
    expect(src).not.toMatch(/Monster Projects/);
    expect(CARD_PLANS.map((p) => p.id)).toEqual(["free", "monster", "assist"]);
    expect(LINE_PLANS.map((p) => p.id)).toEqual(["projects"]);
  });

  test("the phone, the address and the policy links come from their shared modules; no hard-coded host", () => {
    const src = read(PAGE);
    expect(src).toMatch(/SUPPORT_PHONE_HREF/);
    expect(src).toMatch(/SUPPORT_PHONE_DISPLAY/);
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
    for (const m of page.matchAll(/\bt\("([A-Za-z0-9_.]+)"\)/g)) {
      keys.add(`landing2.${m[1]}`);
    }
    // the label lists handed to the islands: pick([ "a", "b", … ] as const)
    for (const block of page.matchAll(/pick\(\s*\[([\s\S]*?)\]\s*as const/g)) {
      for (const m of block[1].matchAll(/"([A-Za-z0-9_.]+)"/g)) {
        keys.add(`landing2.${m[1]}`);
      }
    }
    // the families the page enumerates by number or id (REQ-088: headline-only outcomes, no photo
    // key — the photos are files — four FAQ points, cards for the priced plans only)
    for (const n of [1, 2, 3]) keys.add(`landing2.outcome.${n}.title`);
    for (const n of [1, 2]) {
      for (const part of ["name", "role", "line"]) {
        keys.add(`landing2.team.${n}.${part}`);
      }
    }
    for (const n of [1, 2, 3, 4]) keys.add(`landing2.faqPoint.${n}`);
    for (const n of [1, 2, 3, 4]) {
      for (const part of ["q", "a"]) keys.add(`landing2.faq.${n}.${part}`);
    }
    for (const p of CARD_PLANS) {
      for (const part of ["sub", "cta"]) {
        keys.add(`landing2.plan.${p.id}.${part}`);
      }
    }
    for (const id of ["terms", "refunds", "privacy", "sms"]) {
      keys.add(`landing2.footer.${id}`);
    }
    expect(keys.size).toBeGreaterThan(80);
    const missing = [...keys].filter((k) => !(k in en) || !(k in es));
    expect(missing).toEqual([]);
    // the two languages are two languages (a few labels are the same on purpose: names, a title)
    const same = [...keys].filter((k) =>
      en[k] === es[k] && /[a-z]{4}/.test(en[k])
    );
    expect(same.length).toBeLessThan(keys.size / 10);
    // no landing2 key sits in a dictionary unread
    const unread = Object.keys(en).filter((k) =>
      k.startsWith("landing2.") && !keys.has(k)
    );
    expect(unread).toEqual([]);
    expect(Object.keys(es).filter((k) => k.startsWith("landing2."))).toEqual(
      Object.keys(en).filter((k) => k.startsWith("landing2.")),
    );
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
    expect(read("front-end/static/sitemap.xml")).toContain(
      "<loc>https://documonster.com/landing2</loc>",
    );
  });
});

/**
 * REQ-088/089/090 — the v3 mock: WhatsApp is nowhere on the page, the team's hours are 8 to 8, the
 * two consent boxes start unticked and gate what they guard, and the demo posts the new booking
 * (a call with just a cell, or a day and a window) with the consent on it.
 */
describe("REQ-088 the v3 landing reads as the mock", () => {
  test("WhatsApp is nowhere on the page, its islands or its stylesheet", () => {
    for (const s of [...SOURCES, CSS].map(read)) {
      expect(s).not.toMatch(/wa\.me|whatsapp/i);
    }
    expect(read(PAGE)).not.toMatch(/SUPPORT_PHONE_E164/); // the WhatsApp line was its one use
  });

  test("the team answers 8 AM – 8 PM in both languages, and Art and Ben are named with their photos", () => {
    expect(es["landing2.hours"]).toMatch(/8 AM – 8 PM/);
    expect(en["landing2.hours"]).toMatch(/8 AM – 8 PM/);
    expect(es["landing2.team.1.name"]).toBe("Art");
    expect(es["landing2.team.2.name"]).toBe("Ben");
    expect(en["landing2.team.1.role"]).toBe("Monster Success Specialist");
    const page = read(PAGE);
    expect(page).toMatch(/team-art\.jpg/);
    expect(page).toMatch(/team-ben\.jpg/);
    expect(page).not.toMatch(/team\.\$\{n\}\.photo|\.photo\b/);
  });

  test("the sticky bar and the final CTA are start / call / demo — no email button, no WhatsApp", () => {
    const page = read(PAGE);
    const sticky =
      /data-cy="l2-stickybar"[\s\S]*?<\/div>\s*<\/div>/.exec(page)?.[0] ?? "";
    expect(sticky).toMatch(/#empezar/);
    expect(sticky).toMatch(/href="#llamanos"/); // REQ-092: Call us scrolls to the call-us section
    expect(sticky).not.toMatch(/SUPPORT_PHONE_HREF/);
    expect((sticky.match(/<a\b/g) ?? []).length).toBe(2);
    const final =
      /data-cy="l2-final"[\s\S]*?data-cy="l2-footer"/.exec(page)?.[0] ?? "";
    expect((final.match(/<a\b/g) ?? []).length).toBe(3);
    expect(final).toMatch(/href="#llamanos"/); // REQ-092
    expect(final).not.toMatch(/SUPPORT_PHONE_HREF/);
    expect(final).not.toMatch(/EMAIL_HREF|mailto/);
    expect(page).not.toMatch(/emailUs/);
  });
});

describe("REQ-089 the signup card's consent box", () => {
  test("starts unticked, is wired to the SMS terms, and the code waits for it", () => {
    const signup = read(ISLANDS[0]);
    expect(signup).toMatch(/const \[consent, setConsent\] = useState\(false\)/);
    const box = /<input[^>]*id="reg-consent"[\s\S]*?\/>/.exec(signup)?.[0] ??
      "";
    expect(box).toMatch(/type="checkbox"/);
    expect(box).toMatch(/checked=\{consent\}/);
    expect(box).not.toMatch(/checked(=\{true\}|=""|\s)/);
    expect(signup).toMatch(/if \(!consent\)[\s\S]*?labels\.errConsent/);
    // the terms link is the shared SMS-terms path, handed in by the route
    expect(read(PAGE)).toMatch(/smsTermsPath=\{/);
    expect(read(PAGE)).toMatch(/LEGAL_LINKS\.find\(\(l\) => l\.id === "sms"\)/);
    // the ¿Prefieres hablar? row dials the support line, handed in by the route
    expect(read(PAGE)).toMatch(/phoneHref=\{SUPPORT_PHONE_HREF\}/);
    expect(signup).toMatch(/preferTalk/);
    for (
      const k of [
        "landing2.consentA",
        "landing2.consentTerms",
        "landing2.errConsent",
        "landing2.preferTalk",
      ]
    ) {
      expect([k, k in es && k in en]).toEqual([k, true]);
    }
    // REQ-081's trust row and sub-line are gone with the mock
    for (
      const k of [
        "landing2.tr1",
        "landing2.regSubA",
        "landing2.orTalk",
        "landing2.whatsapp",
      ]
    ) {
      expect([k, k in es]).toEqual([k, false]);
    }
  });
});

describe("REQ-090 the demo card posts the new booking", () => {
  test("the shared model is five days from tomorrow and two windows", () => {
    expect(DEMO_DAY_COUNT).toBe(5);
    expect(DEMO_SLOTS.map((s) => s.id)).toEqual(["morning", "afternoon"]);
  });

  test("the island books a call with just a cell, or a demo with a day and a window; its consent box starts unticked and gates both; the client carries the consent and nothing retired", () => {
    const demo = read(ISLANDS[1]);
    expect(demo).toMatch(/const \[consent, setConsent\] = useState\(false\)/);
    expect(demo).toMatch(/if \(!consent\)[\s\S]*?labels\.errConsent/);
    expect(demo).toMatch(/mode: "call"[\s\S]*?day: ""[\s\S]*?slot: ""/);
    expect(demo).toMatch(/mode: "demo"/);
    expect(demo).toMatch(/consent: true/);
    expect(demo).toMatch(/data-cy="l2-demo-call"/);
    expect(demo).toMatch(/data-cy="l2-pick-time"/);
    expect(demo).toMatch(/data-cy="l2-quick-mode"/);
    expect(demo).not.toMatch(/noEmail|trade|l2-mode-demo|l2-mode-call/);
    const client = read("front-end/clients/landing.ts");
    expect(client).toMatch(/consent: boolean/);
    expect(client).not.toMatch(/noEmail|trade/);
    // the route hands the days and the windows from the one shared model
    const page = read(PAGE);
    expect(page).toMatch(/upcomingDemoDays\(lang\)/);
    expect(page).toMatch(/slots=\{DEMO_SLOTS\}/);
  });
});

describe("REQ-092 the bottom Llámanos scrolls to the call-us section; the 1-855 buttons are plain tel: links", () => {
  test("the team section is the call-us anchor, and both bottom Call us buttons point at it", () => {
    const page = read(PAGE);
    const team = /<div[^>]*data-cy="l2-team"[^>]*>/.exec(page)?.[0] ?? "";
    expect(team).toMatch(/\bid="llamanos"/);
    expect((page.match(/\bid="llamanos"/g) ?? []).length).toBe(1);
    const sticky =
      /data-cy="l2-stickybar"[\s\S]*?<\/div>\s*<\/div>/.exec(page)?.[0] ?? "";
    const final =
      /data-cy="l2-final"[\s\S]*?data-cy="l2-footer"/.exec(page)?.[0] ?? "";
    for (const block of [sticky, final]) {
      const call = /<a\b[^>]*l2-btn--dark[^>]*>/.exec(block)?.[0] ?? "";
      expect(call).toMatch(/href="#llamanos"/);
      expect(call).not.toMatch(/SUPPORT_PHONE_HREF|tel:/);
    }
  });

  test("every 1-855 button is the shared tel: href with nothing in the way — the browser's dialer gets the number untouched", () => {
    const contact = read("shared/legal/contact.ts");
    expect(contact).toMatch(/export const SUPPORT_PHONE_E164 = "\+1\d{10}"/);
    expect(contact).toMatch(
      /export const SUPPORT_PHONE_HREF = `tel:\$\{SUPPORT_PHONE_E164\}`/,
    );
    const page = read(PAGE);
    const phones = page.match(/<a\b[^>]*href=\{SUPPORT_PHONE_HREF\}[^>]*>/g) ??
      [];
    expect(phones.length).toBe(4); // the nav, the team's button, the Projects line, the footer
    for (const a of phones) expect(a).not.toMatch(/onClick|target=|download/);
    const signup = read(ISLANDS[0]);
    const row = /<a\b[^>]*href=\{phoneHref\}[^>]*>/.exec(signup)?.[0] ?? "";
    expect(row).not.toBe("");
    expect(row).not.toMatch(/onClick|target=|download/);
    for (const s of SOURCES.map(read)) expect(s).not.toMatch(/href="tel:/);
  });
});

describe("REQ-093 the Big jobs, plans or bids line has 10px of padding", () => {
  test("the stylesheet gives the Projects line 10px of padding on every side, and no margin the page's paragraph reset would eat", () => {
    const css = read(CSS);
    const rule = /\.l2-plans__note \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/padding: 10px;/);
    expect(rule).not.toMatch(/margin/);
    // the paragraph reset (REQ-094: :where-scoped, so a class's own margin applies — the line
    // keeps padding, not a margin, because 10px of padding is what was asked)
    expect(css).toMatch(/\.l2 :where\(p\) \{\s*margin: 0;\s*\}/);
  });
});

/**
 * REQ-094 — "go through this with a fine tooth comb." What the audit of the shipped page found and
 * fixed: the paragraph reset ate two of the mock's margins (the plan blurbs, the plans subtitle);
 * the hero's 118% monster image widened the page on a tablet (a sideways scroll at 761–860px); the
 * share image every landing's og:image names, /og-card.png, was a 404 — never tracked; and the
 * signup's phone field carried `required`, so an empty Empezar gratis got the browser's tooltip in
 * the browser's language instead of the page's own message.
 */
describe("REQ-094 the fine-tooth comb — what the audit of the shipped page found", () => {
  test("the paragraph reset is :where-scoped, so a class's own margin applies: the plan blurbs and the plans subtitle keep the mock's spacing", () => {
    const css = read(CSS);
    expect(css).toMatch(/\.l2 :where\(p\) \{\s*margin: 0;\s*\}/);
    expect(css).not.toMatch(/\.l2 p \{/);
    const planSub = /\.l2-plan__sub \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(planSub).toMatch(/margin: -4px 0 4px;/);
    const plansSub = /\.l2-plans__sub \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(plansSub).toMatch(/margin-top: 6px;/);
  });

  test("the hero clips sideways overflow: the monster's oversized image cannot widen the page on a tablet", () => {
    const css = read(CSS);
    const hero = /\.l2-hero \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(hero).toMatch(/overflow-x: clip;/);
  });

  test("the share image every landing's og:image names is a tracked PNG of the size the tags declare, 1200×630", () => {
    const rel = `front-end/static${OG_IMAGE.path}`;
    expect([rel, tracked(rel)]).toEqual([rel, true]);
    const buf = fs.readFileSync(path.join(ROOT, rel));
    expect(buf.subarray(0, 8)).toEqual(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
    expect([buf.readUInt32BE(16), buf.readUInt32BE(20)]).toEqual([
      OG_IMAGE.width,
      OG_IMAGE.height,
    ]);
    expect([OG_IMAGE.width, OG_IMAGE.height]).toEqual([1200, 630]);
  });

  test("the signup's phone field carries no `required`: an empty send is answered by the page's own message, in the page's language", () => {
    const signup = read(ISLANDS[0]);
    const input = /<input[^>]*id="reg-phone"[\s\S]*?\/>/.exec(signup)?.[0] ?? "";
    expect(input).not.toBe("");
    expect(input).not.toMatch(/\brequired\b/);
    expect(signup).toMatch(/labels\.errPhone/);
  });
});
