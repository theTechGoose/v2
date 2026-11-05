/**
 * REQ-147/148/149 — Raphael, 2026-11-05: "look at landing 1, then landing2, take notes. then
 * implement landing3 landing4 landing5. make sure all of the buttons and ctas and everything works
 * just as it works in landing 1 and 2."
 *
 * The three pages are the Nov 3 mocks (landing-variations/v3, v4, v5) made real the way /landing2
 * was (REQ-081): the plans from the one list, the phone and the address from their module, the four
 * policy links from the one list, both languages from the dictionaries, the images tracked under
 * static, the pixel on them, the app shell treating them Spanish-first, the sitemap listing them —
 * and the forms posting to the same endpoints /landing2 and /contact post to.
 */
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { isPixelPage } from "../../shared/meta-pixel/pixel";
import { PUBLIC_PLANS } from "../../shared/quote-flow/pricing-plans";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const exists = (rel: string) => fs.existsSync(path.join(ROOT, rel));
const tracked = (rel: string) =>
  execSync(`git ls-files ${rel}`, { cwd: ROOT }).toString().trim() === rel;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

const PAGE3 = "front-end/routes/landing3.tsx";
const PAGE4 = "front-end/routes/landing4.tsx";
const PAGE5 = "front-end/routes/landing5.tsx";
const SECTIONS = "front-end/components/Landing3Sections.tsx";
const ADS = "front-end/lib/landing-ads.ts";
const CONTACT = "front-end/islands/Landing3Contact.tsx";
const CALLME = "front-end/islands/Landing5CallMe.tsx";
const SIGNUP = "front-end/islands/Landing2Signup.tsx";
const DEMO = "front-end/islands/Landing2Demo.tsx";
const CSS3 = "front-end/static/landing3.css";
const CSS5 = "front-end/static/landing5.css";
const ALL_SOURCES = [PAGE3, PAGE4, PAGE5, SECTIONS, CONTACT, CALLME];
const CARD_PLANS = PUBLIC_PLANS.filter((p) => !p.custom);
const LINE_PLANS = PUBLIC_PLANS.filter((p) => p.custom);
const AD_IDS = ["cumple", "domingo", "sabado", "graduacion"];
const IMAGES = [
  ...AD_IDS.map((a) => `ad-${a}.jpg`),
  "team-art.jpg",
  "team-ben.jpg",
  "team-sergio.jpg",
  "team-keren.jpg",
  "monster-paper.png",
];

/** every dictionary key a source reads: t("k") is the file's own namespace, t3/t4/t5("k") the named one */
function keysRead(rel: string, ownNs: string): Set<string> {
  const src = read(rel);
  const keys = new Set<string>();
  const ns: Record<string, string> = {
    t: ownNs,
    t3: "landing3",
    t4: "landing4",
    t5: "landing5",
  };
  for (const m of src.matchAll(/\b(t[345]?)\("([A-Za-z0-9_.]+)"[,)]/g)) {
    keys.add(`${ns[m[1]]}.${m[2]}`);
  }
  // the label lists handed to the islands: pick([ "a", "b", … ] as const) / pick3 / pick5
  for (
    const block of src.matchAll(
      /\bpick([345]?)\(\s*(?:t[345]?,\s*)?\[([\s\S]*?)\]\s*as const/g,
    )
  ) {
    const prefix = block[1] ? `landing${block[1]}` : ownNs;
    for (const m of block[2].matchAll(/"([A-Za-z0-9_.]+)"/g)) {
      keys.add(`${prefix}.${m[1]}`);
    }
  }
  return keys;
}

/** the families the pages enumerate by number or id */
function families(): Set<string> {
  const keys = new Set<string>();
  for (const id of AD_IDS) {
    keys.add(`landing3.ad.${id}`);
    keys.add(`landing3.adAlt.${id}`);
  }
  for (const n of [1, 2, 3]) keys.add(`landing3.outcome.${n}.title`);
  for (const n of [1, 2, 3, 4]) {
    for (const part of ["name", "role", "line"]) {
      keys.add(`landing3.team.${n}.${part}`);
    }
    keys.add(`landing3.faqPoint.${n}`);
    for (const part of ["q", "a"]) keys.add(`landing3.faq.${n}.${part}`);
    keys.add(`landing5.team.${n}`);
    keys.add(`landing5.inc.${n}`);
  }
  for (const p of CARD_PLANS) {
    for (const part of ["sub", "cta"]) {
      keys.add(`landing3.plan.${p.id}.${part}`);
    }
  }
  for (const id of ["terms", "refunds", "privacy", "sms"]) {
    keys.add(`landing3.footer.${id}`);
    keys.add(`landing5.footer.${id}`);
  }
  for (const d of ["quote", "contract", "invoice"]) {
    for (const part of ["title", "sub", "pill", "amt"]) {
      keys.add(`landing3.doc.${d}.${part}`);
    }
  }
  for (const n of [1, 2, 3]) keys.add(`landing4.step.${n}`);
  return keys;
}

function auditNamespace(ns: string, read: Set<string>) {
  const own = [...read].filter((k) => k.startsWith(`${ns}.`));
  expect(own.length).toBeGreaterThan(10);
  const missing = own.filter((k) => !(k in en) || !(k in es));
  expect(missing).toEqual([]);
  // the two languages are two languages (a few labels are the same on purpose: names, amounts)
  const same = own.filter((k) => en[k] === es[k] && /[a-z]{4}/.test(en[k]));
  expect(same.length).toBeLessThan(own.length / 5);
  // no key sits in a dictionary unread
  const unread = Object.keys(en).filter((k) =>
    k.startsWith(`${ns}.`) && !read.has(k)
  );
  expect(unread).toEqual([]);
  expect(Object.keys(es).filter((k) => k.startsWith(`${ns}.`))).toEqual(
    Object.keys(en).filter((k) => k.startsWith(`${ns}.`)),
  );
}

const allRead = () => {
  const keys = families();
  for (const k of keysRead(PAGE3, "landing3")) keys.add(k);
  for (const k of keysRead(SECTIONS, "landing3")) keys.add(k);
  for (const k of keysRead(PAGE4, "landing4")) keys.add(k);
  for (const k of keysRead(PAGE5, "landing5")) keys.add(k);
  return keys;
};

describe("REQ-147 /landing3 is the v3 mock wired to the site's one sources", () => {
  test("the route, the shared sections, the islands, the ad module, the stylesheet and the images exist and are tracked", () => {
    for (const f of [PAGE3, SECTIONS, ADS, CONTACT, CSS3, SIGNUP, DEMO]) {
      expect([f, exists(f)]).toEqual([f, true]);
    }
    // REQ-075: an image a page references is a tracked file — the four ads, the four people, the monster
    for (const img of IMAGES) {
      expect([img, tracked(`front-end/static/${img}`)]).toEqual([img, true]);
    }
    const src = read(SECTIONS) + read(ADS);
    for (const img of IMAGES) {
      expect(src).toMatch(new RegExp(img.replace(".", "\\.")));
    }
    // the stylesheet rides on the l2 design system, both through asset() (REQ-096)
    expect(read(PAGE3)).toMatch(/asset\("\/landing2\.css"\)/);
    expect(read(PAGE3)).toMatch(/asset\("\/landing3\.css"\)/);
  });

  test("the ad the person tapped: the hero reads ?ad= through landing-ads, the outcomes show the other three", () => {
    expect(read(PAGE3)).toMatch(/adFromUrl/);
    const sections = read(SECTIONS);
    expect(sections).toMatch(/otherAds/);
    expect(sections).toMatch(/adPhoto/);
    expect(sections).toMatch(/data-cy="l3-outcome"/);
  });

  test("the plans are the one plan list — PUBLIC_PLANS — never a copy; the custom plan is the call-us line; every card button goes to the signup", () => {
    const src = read(SECTIONS);
    expect(src).toMatch(/PUBLIC_PLANS/);
    expect(src).toMatch(/pricing-plans\.ts/);
    for (const p of PUBLIC_PLANS) {
      if (!p.custom) {
        expect(src).not.toMatch(
          new RegExp(`"\\$${Math.round(p.priceCents / 100)}"`),
        );
      }
    }
    for (const s of ALL_SOURCES.map(read)) {
      expect(s).not.toMatch(/Facturas ilimitadas|Unlimited invoices/);
    }
    expect(src).toMatch(/data-cy="l3-projects"/);
    expect(src).not.toMatch(/Monster Projects/);
    expect(CARD_PLANS.map((p) => p.id)).toEqual(["free", "monster", "assist"]);
    expect(LINE_PLANS.map((p) => p.id)).toEqual(["projects"]);
    const plans =
      /data-cy="l3-plans"[\s\S]*?data-cy="l3-projects"/.exec(src)?.[0] ?? "";
    expect(plans).toMatch(/href="#empezar"/);
  });

  test("the phone, the address and the policy links come from their shared modules; no hard-coded host, phone or address; no tagline (REQ-071)", () => {
    const src = read(SECTIONS);
    expect(src).toMatch(/SUPPORT_PHONE_HREF/);
    expect(src).toMatch(/SUPPORT_PHONE_DISPLAY/);
    expect(src).toMatch(/BUSINESS_ADDRESS/);
    expect(src).toMatch(/LEGAL_LINKS/);
    expect(src).toMatch(/data-legal-link/);
    for (const s of [...ALL_SOURCES, CSS3, CSS5].map(read)) {
      expect(s).not.toMatch(/855-362-8666|18553628666/);
      expect(s).not.toMatch(/https?:\/\/(www\.)?documonster\.com\//);
      expect(s).not.toMatch(/4505 Socastee/);
      expect(s).not.toMatch(/Powered by Paperwork Monster/i);
      expect(s).not.toMatch(/wa\.me|whatsapp/i);
    }
  });

  test("the bottom Llámanos buttons scroll to the call-us section (REQ-092): the team is #llamanos, the closing and the sticky bar point at it, and no tel: sits on them", () => {
    const src = read(SECTIONS);
    expect(src).toMatch(/id="llamanos"/);
    const final =
      /data-cy="l3-final"[\s\S]*?data-cy="l3-footer"/.exec(src)?.[0] ?? "";
    expect(final).toMatch(/href="#empezar"/);
    expect(final).toMatch(/href="#llamanos"/);
    expect(final).toMatch(/href="#demo"/);
    expect(final).not.toMatch(/SUPPORT_PHONE_HREF/);
    const sticky = /data-cy="l3-stickybar"[\s\S]*?<\/div>/.exec(src)?.[0] ?? "";
    expect(sticky).toMatch(/href="#empezar"/);
    expect(sticky).toMatch(/href="#llamanos"/);
    expect(sticky).not.toMatch(/SUPPORT_PHONE_HREF/);
  });

  test("every dictionary key the pages, the sections and the islands read exists in BOTH languages, and no landing3 key goes unread", () => {
    auditNamespace("landing3", allRead());
  });

  test("the signup is /landing2's island — the same OTP endpoints, the consent box, the Lead — in its inline variant; the contact island posts the inquiry; the demo island posts the booking", () => {
    const sections = read(SECTIONS);
    expect(sections).toMatch(/Landing2Signup/);
    expect(sections).toMatch(/variant="inline"/);
    expect(sections).toMatch(/Landing2Demo/);
    expect(sections).toMatch(/Landing3Contact/);
    const signup = read(SIGNUP);
    expect(signup).toMatch(/landingClient\.sendOtp/);
    expect(signup).toMatch(/verifyClient\.verifyOtp/);
    expect(signup).toMatch(/leadEvent/);
    expect(signup).toMatch(/variant/);
    const contact = read(CONTACT);
    expect(contact).toMatch(/landingClient\.submitContact/);
    expect(contact).toMatch(/useState\(true\)/); // REQ-097: the consent box starts ticked
    expect(read("front-end/clients/landing.ts")).toMatch(/"\/contact"/);
    expect(read(DEMO)).toMatch(/landingClient\.requestDemo/);
  });

  test("the pixel loads on /landing3, the app shell treats it as Spanish-first, and the sitemap lists it", () => {
    expect(isPixelPage("/landing3")).toBe(true);
    expect(isPixelPage("/landing3/")).toBe(true);
    expect(read("front-end/routes/_app.tsx")).toMatch(/"\/landing3"/);
    expect(read("front-end/static/sitemap.xml")).toContain(
      "<loc>https://documonster.com/landing3</loc>",
    );
  });

  test("REQ-147 amendment — the English signup button is Get started and the consent line names it; the Spanish one is still Empezar gratis", () => {
    expect(en["landing3.sendCode"]).toBe("Get started");
    expect(en["landing3.consentA"]).toMatch(
      /^By tapping Get started you agree/,
    );
    expect(es["landing3.sendCode"]).toBe("Empezar gratis");
    expect(es["landing3.consentA"]).toMatch(/^Al tocar Empezar aceptas/);
  });

  test("the head: canonical, both hreflang variants and a default, the social tags, the title and description from the dictionary", () => {
    const src = read(PAGE3);
    expect(src).toMatch(/const PATH = "\/landing3" as const/);
    expect(src).toMatch(/absoluteUrl\(PATH\)/);
    expect(src).toMatch(/hreflang="es"/);
    expect(src).toMatch(/hreflang="en"/);
    expect(src).toMatch(/hreflang="x-default"/);
    expect(src).toMatch(/socialMetaTags\(/);
    expect(src).toMatch(/t\("docTitle"\)/);
    expect(src).toMatch(/t\("metaDescription"\)/);
  });
});

describe("REQ-148 /landing4 is the v4 mock: /landing3 opening on You do the work with the three steps", () => {
  test("the route exists, reuses the shared sections and the stylesheets, and adds the top and the steps", () => {
    expect(exists(PAGE4)).toBe(true);
    const src = read(PAGE4);
    expect(src).toMatch(/Landing3Sections\.tsx/);
    expect(src).toMatch(/asset\("\/landing2\.css"\)/);
    expect(src).toMatch(/asset\("\/landing3\.css"\)/);
    expect(src).toMatch(/data-cy="l3-top"/);
    expect(src).toMatch(/data-cy="l3-steps"/);
    // the two top links: the signup, the documents (the proof band)
    const top = /data-cy="l3-top"[\s\S]*?data-cy="l3-steps"/.exec(src)?.[0] ??
      "";
    expect(top).toMatch(/href="#empezar"/);
    expect(top).toMatch(/href="#documentos"/);
    expect(src).toMatch(/adFromUrl/);
    expect(src).toMatch(/const PATH = "\/landing4" as const/);
    expect(src).toMatch(/absoluteUrl\(PATH\)/);
  });

  test("its landing4 keys exist in both languages and none goes unread", () => {
    auditNamespace("landing4", allRead());
  });

  test("the pixel loads on /landing4, the app shell treats it as Spanish-first, and the sitemap lists it", () => {
    expect(isPixelPage("/landing4")).toBe(true);
    expect(read("front-end/routes/_app.tsx")).toMatch(/"\/landing4"/);
    expect(read("front-end/static/sitemap.xml")).toContain(
      "<loc>https://documonster.com/landing4</loc>",
    );
  });
});

describe("REQ-149 /landing5 is the v5 mock: the simple one", () => {
  test("the route, the call-me island and the stylesheet exist; the images are the tracked ones", () => {
    for (const f of [PAGE5, CALLME, CSS5]) {
      expect([f, exists(f)]).toEqual([f, true]);
    }
    const src = read(PAGE5);
    expect(src).toMatch(/asset\("\/landing2\.css"\)/);
    expect(src).toMatch(/asset\("\/landing5\.css"\)/);
    for (
      const img of [
        "team-art.jpg",
        "team-ben.jpg",
        "team-keren.jpg",
        "team-sergio.jpg",
        "monster-paper.png",
      ]
    ) {
      expect(src + read(SECTIONS)).toMatch(new RegExp(img.replace(".", "\\.")));
    }
    expect(src).toMatch(/adFromUrl/);
    expect(src).toMatch(/adPhoto/);
  });

  test("Sign up now and Start free are the app's own /login; Llámanos scrolls to the phone row; Escríbenos is the email; the sticky bar is sign-up and call", () => {
    const src = read(PAGE5);
    expect(src).toMatch(/href="\/login"/);
    expect(src).not.toMatch(/documonster\.com\/login/);
    expect(src).toMatch(/id="llamanos"/);
    const final =
      /data-cy="l5-final"[\s\S]*?data-cy="l5-footer"/.exec(src)?.[0] ?? "";
    expect(final).toMatch(/href="\/login"/);
    expect(final).toMatch(/href="#llamanos"/);
    expect(final).toMatch(/mailto:|EMAIL_HREF/);
    expect(src).toMatch(/EMAIL_HREF = `mailto:\$\{EMAIL\}`/);
    const sticky = /data-cy="l5-stickybar"[\s\S]*?<\/div>/.exec(src)?.[0] ?? "";
    expect(sticky).toMatch(/href="\/login"/);
    expect(sticky).toMatch(/href="#llamanos"/);
    expect(src).toMatch(/SUPPORT_PHONE_HREF/);
    expect(src).toMatch(/BUSINESS_ADDRESS/);
    expect(src).toMatch(/LEGAL_LINKS/);
  });

  test("the call-me island posts a call with the name to the demo-request endpoint, the consent box ticked on open (REQ-097)", () => {
    const island = read(CALLME);
    expect(island).toMatch(/landingClient\.requestDemo/);
    expect(island).toMatch(/mode: "call"/);
    expect(island).toMatch(/name/);
    expect(island).toMatch(/useState\(true\)/);
    expect(read("front-end/clients/landing.ts")).toMatch(/"\/demo-request"/);
  });

  test("its landing5 keys exist in both languages and none goes unread", () => {
    auditNamespace("landing5", allRead());
  });

  test("the pixel loads on /landing5, the app shell treats it as Spanish-first, and the sitemap lists it", () => {
    expect(isPixelPage("/landing5")).toBe(true);
    expect(read("front-end/routes/_app.tsx")).toMatch(/"\/landing5"/);
    expect(read("front-end/static/sitemap.xml")).toContain(
      "<loc>https://documonster.com/landing5</loc>",
    );
  });
});
