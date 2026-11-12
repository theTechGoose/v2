/**
 * REQ-367 — demo-loop cycle 1, issue m10: "Text left in the other language after an EN/ES switch
 * (footer, tab title, old cards, relative times)". The EN/ES switches (the topbar's, the settings
 * select, the onboarding wizard, the contract's own EN | ES) only reach what follows `langSignal`,
 * and the RCA found three things that did not:
 *   1. the footer — a server component rendered once in the request's language on 30 routes;
 *      REQ-269 had made only /admin's live;
 *   2. the tab title — every route wrote <title> with tFor(lang, …) at SSR and nothing ever
 *      updated document.title;
 *   3. the customer card's "added hace un momento" — the relative time (and the jobs sub-line)
 *      came back from the backend already rendered in the request's language, then was
 *      interpolated into the client's live-language template.
 *
 * These are the guards that keep each from coming back, for every page that exists now and every
 * page added later: the one footer IS the live island, every <title> is a DocTitle carrying both
 * languages, the shell's HtmlLang sets the tab title on every switch, and the card's words are
 * made in the client from raw data. The rendered proof is front-end/lib/live-lang.test.tsx, the
 * HTTP proof backend/src/analytics/entrypoints/clients-controller/lang.int.test.ts, the browser
 * proof e2e/live-lang-switch/live-lang-switch.e2e.test.ts.
 */
import * as fs from "fs";
import * as path from "path";
import en from "../../lang/en.json";
import es from "../../lang/es.json";
import type { CustomerCard } from "../../front-end/clients/clients";
import * as display from "../../front-end/lib/clients-display";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const EN = en as Record<string, string>;
const ES = es as Record<string, string>;

/** every .tsx under a front-end dir, repo-relative */
function tsxUnder(dir: string): string[] {
  const out: string[] = [];
  const walk = (abs: string) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      const p = path.join(abs, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx$/.test(e.name)) out.push(path.relative(ROOT, p));
    }
  };
  walk(path.join(ROOT, dir));
  return out.sort();
}

/** source without comments, so prose about <title> or <SiteFooter> never counts */
const code = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PAGES = [
  ...tsxUnder("front-end/routes"),
  ...tsxUnder("front-end/components"),
];

/** pages whose <title> is not the app's live one — each for a reason */
const TITLE_EXEMPT: Record<string, string> = {
  "front-end/routes/_app.tsx":
    "the shell's fallback: the brand name, one word in both languages; every page's DocTitle replaces it",
  "front-end/routes/index.tsx":
    "the website: static/landing-scripts.js swaps its copy and its title in place",
  "front-end/routes/landing.tsx":
    "a marketing landing with its own dictionary and switch",
  "front-end/routes/landing2.tsx":
    "a marketing landing with its own dictionary and switch",
  "front-end/routes/landing3.tsx":
    "a marketing landing with its own dictionary and switch",
  "front-end/routes/landing4.tsx":
    "a marketing landing with its own dictionary and switch",
  "front-end/routes/landing5.tsx":
    "a marketing landing with its own dictionary and switch",
  "front-end/routes/dev/money-input.tsx": "a dev-only page",
  "front-end/routes/dev/search-select.tsx": "a dev-only page",
};

describe("REQ-367 the footer follows the EN/ES switch on every page", () => {
  it("REQ-367 the one site footer IS the live island: SiteFooter hands both languages' copy to SiteFooterLive", () => {
    const footer = code(read("front-end/components/SiteFooter.tsx"));
    expect(footer).toMatch(
      /import SiteFooterLive from "\.\.\/islands\/SiteFooterLive\.tsx"/,
    );
    expect(footer).toMatch(/<SiteFooterLive\b/);
    expect(footer).toMatch(/siteFooterCopy\("en"\)/);
    expect(footer).toMatch(/siteFooterCopy\("es"\)/);
    // the island picks the language it shows with the live-language hook, and paints the view
    const island = code(read("front-end/islands/SiteFooterLive.tsx"));
    expect(island).toMatch(/useLiveLang\(/);
    expect(island).toMatch(/<SiteFooterView\b/);
  });

  it("REQ-367 the island ships no dictionary and no legal text: its words arrive as props", () => {
    /** the modules a file pulls into the browser bundle (type-only imports are erased) */
    const valueImports = (f: string) =>
      [...code(read(f)).matchAll(/^import (?!type\b)[^;]*?from "([^"]+)";/gms)]
        .map((m) => m[1])
        .sort();
    // the whole chain the island loads: nothing reaches lib/i18n.ts (both dictionaries) or
    // shared/legal/terms.ts (both languages' legal texts)
    expect(valueImports("front-end/islands/SiteFooterLive.tsx")).toEqual([
      "../components/SiteFooterView.tsx",
      "../lib/live-lang.ts",
    ]);
    expect(valueImports("front-end/components/SiteFooterView.tsx")).toEqual([
      "../../shared/legal/contact.ts",
    ]);
    expect(valueImports("front-end/lib/live-lang.ts")).toEqual([
      "./lang.ts",
      "preact/hooks",
    ]);
  });

  it("REQ-367 no page renders a footer that ignores the switch: every footer comes from components/SiteFooter.tsx", () => {
    const offenders: string[] = [];
    for (const f of PAGES) {
      if (f === "front-end/components/SiteFooter.tsx") continue;
      if (f === "front-end/components/SiteFooterView.tsx") continue;
      const src = code(read(f));
      // the markup is reachable only through the island
      if (/SiteFooterView/.test(src)) {
        offenders.push(`${f}: renders the static SiteFooterView`);
      }
      // one way to put a footer on a page
      if (/<SiteFooterLive\b/.test(src)) {
        offenders.push(`${f}: mounts SiteFooterLive by hand`);
      }
      if (
        /<SiteFooter\b/.test(src) &&
        !/import SiteFooter from "(?:(?:\.\.\/)+components\/|\.\/)SiteFooter\.tsx"/
          .test(src)
      ) {
        offenders.push(`${f}: a SiteFooter not from components/SiteFooter.tsx`);
      }
      // a page never paints its own footer markup
      if (/data-site-footer/.test(src)) {
        offenders.push(`${f}: paints its own footer`);
      }
    }
    expect(offenders).toEqual([]);
    // the footer the RCA named is on the pages it named
    for (
      const r of [
        "dashboard/index.tsx",
        "quotes/index.tsx",
        "assistant/index.tsx",
        "admin/index.tsx",
        "clients/index.tsx",
        "q/[id].tsx",
        "welcome.tsx",
      ]
    ) {
      expect([
        r,
        /<SiteFooter lang=\{lang\}( compact)? \/>/.test(read(`front-end/routes/${r}`)), // REQ-425: the app routes pass compact
      ]).toEqual([r, true]);
    }
  });
});

describe("REQ-367 the tab title follows the EN/ES switch on every page", () => {
  it("REQ-367 every page's <title> is a DocTitle carrying both languages — no raw <title> left", () => {
    const raw: string[] = [];
    for (const f of PAGES) {
      if (f in TITLE_EXEMPT || f === "front-end/components/DocTitle.tsx") {
        continue;
      }
      const n = (code(read(f)).match(/<title\b/g) ?? []).length;
      if (n > 0) raw.push(`${f} (${n})`);
    }
    expect(raw).toEqual([]);
    const doc = code(read("front-end/components/DocTitle.tsx"));
    expect(doc).toMatch(/<title\b/);
    expect(doc).toMatch(/titleAttr\("en"\)|data-title-en/);
    expect(doc).toMatch(/titleAttr\("es"\)|data-title-es/);
  });

  it("REQ-367 each DocTitle builds every language from its own argument, never from the page's SSR language", () => {
    const uses: string[] = [];
    const wrong: string[] = [];
    for (const f of PAGES) {
      const src = code(read(f));
      for (const m of src.matchAll(/<DocTitle\b[\s\S]*?\/>/g)) {
        uses.push(f);
        const el = m[0];
        const param = el.match(/title=\{\s*\((\w+)\)\s*=>/)?.[1];
        if (!param) {
          wrong.push(`${f}: no title={(l) => …} builder`);
          continue;
        }
        if (!new RegExp(`\\b${param}\\b`).test(el.slice(el.indexOf("=>")))) {
          wrong.push(`${f}: the builder never reads ${param}`);
        }
        for (const call of el.matchAll(/tFor\(\s*(\w+)/g)) {
          if (call[1] !== param) {
            wrong.push(`${f}: tFor(${call[1]}, …) inside the builder`);
          }
        }
        if (/\[\s*lang\s*\]|\(\s*lang\s*,/.test(el.slice(el.indexOf("=>")))) {
          wrong.push(`${f}: the builder reads the page's lang`);
        }
      }
    }
    expect(wrong).toEqual([]);
    // the pages the demo named, and every page with a <Head> title, use it
    expect(uses.length).toBeGreaterThanOrEqual(30);
    for (
      const r of [
        "clients/index.tsx",
        "settings/index.tsx",
        "dashboard/index.tsx",
        "assistant/index.tsx",
        "q/[id].tsx",
      ]
    ) {
      expect([r, /<DocTitle\b/.test(read(`front-end/routes/${r}`))]).toEqual([
        r,
        true,
      ]);
    }
  });

  it("REQ-367 the app shell's HtmlLang sets document.title from the DocTitle on every language change", () => {
    const src = code(read("front-end/islands/HtmlLang.tsx"));
    expect(src).toMatch(
      /import \{[^}]*\bfollowTitle\b[^}]*\} from "\.\.\/lib\/doc-title\.ts"/,
    );
    // inside the signal subscription, after the html lang
    const sub = src.slice(src.indexOf("langSignal.subscribe"));
    expect(sub).toMatch(/followTitle\(document, lang\)/);
    // HtmlLang stays dictionary-free (the titles arrive on the <title> itself)
    expect(src).not.toMatch(/lib\/i18n\.ts/);
  });

  it("REQ-367 the Accounts Manager page has a title in both dictionaries", () => {
    expect(EN["accountsManager.docTitle"]).toBe("Accounts Manager");
    expect(ES["accountsManager.docTitle"]).toBe("Gestor de cuentas");
  });
});

describe("REQ-367 the customer card's words are made in the client, in the live language", () => {
  const NOW = Date.parse("2026-11-12T10:00:00Z");
  const base = {
    id: "c1",
    userId: "u",
    name: "Ana Pérez",
    createdAt: "2026-11-12T09:59:30Z",
    updatedAt: "2026-11-12T09:59:30Z",
    lastWhen: "2026-11-12T09:59:30Z",
    lastTone: "hot",
    balanceCents: 0,
    balanceSub: "",
    activeJobs: 0,
    jobsSub: "none",
    status: "new",
    temp: 100,
    daysSinceContact: 0,
    revenue12moCents: 0,
  } as unknown as CustomerCard;

  it("REQ-367 the relative time comes from the card's lastWhen, in the language asked — never a backend string", () => {
    expect(typeof display.lastWhenFor).toBe("function");
    expect(display.lastWhenFor(base, "es", NOW)).toBe("hace un momento");
    expect(display.lastWhenFor(base, "en", NOW)).toBe("just now");
    const hourAgo = {
      ...base,
      lastWhen: "2026-11-12T08:30:00Z",
    } as CustomerCard;
    expect(display.lastWhenFor(hourAgo, "es", NOW)).toBe("hace 1 h");
    expect(display.lastWhenFor(hourAgo, "en", NOW)).toBe("1h ago");
  });

  it("REQ-367 the new customer's story reads one language whichever is live (the demo's 'added hace un momento')", () => {
    expect(display.storyLineFor(base, "es", NOW)).toBe(
      ES["clientsDisplay.story.new"].replace("{when}", "hace un momento"),
    );
    expect(display.storyLineFor(base, "en", NOW)).toBe(
      EN["clientsDisplay.story.new"].replace("{when}", "just now"),
    );
    expect(display.storyLineFor(base, "en", NOW)).not.toMatch(/hace|agregado/);
    expect(display.storyLineFor(base, "es", NOW)).not.toMatch(/just now|added/);
  });

  it("REQ-367 the active story's jobs line is a kind the client words — 'activo' in Spanish, 'active' in English", () => {
    const active = {
      ...base,
      status: "active",
      activeJobs: 1,
      jobsSub: "active",
    } as unknown as CustomerCard;
    expect(display.storyLineFor(active, "es", NOW)).toBe(
      "1 trabajo activo · activo.",
    );
    expect(display.storyLineFor(active, "en", NOW)).toBe(
      "1 active job · active.",
    );
    const overdue = {
      ...active,
      activeJobs: 2,
      jobsSub: "overdue",
    } as unknown as CustomerCard;
    expect(display.storyLineFor(overdue, "es", NOW)).toBe(
      "2 trabajos activos · vencido.",
    );
    expect(display.storyLineFor(overdue, "en", NOW)).toBe(
      "2 active jobs · overdue.",
    );
  });

  it("REQ-367 the card type carries raw data only: no lastWhenRel, jobsSub is a kind; the board words the time itself", () => {
    const types = code(read("front-end/clients/clients.ts"));
    expect(types).not.toMatch(/lastWhenRel/);
    expect(types).toMatch(/jobsSub: CustomerJobsSub;/);
    expect(types).toMatch(
      /export type CustomerJobsSub =\s*\|?\s*"overdue"\s*\|\s*"active"\s*\|\s*"scheduled"\s*\|\s*"none";/,
    );
    const board = code(read("front-end/islands/ClientsBoard.tsx"));
    expect(board).not.toMatch(/lastWhenRel/);
    expect(board).toMatch(/lastWhenFor\(c, lang\)/);
    const dto = code(read("backend/src/crm/dto/customer.ts"));
    expect(dto).not.toMatch(/lastWhenRel/);
    expect(dto).toMatch(/jobsSub: CustomerJobsSub;/);
  });
});
