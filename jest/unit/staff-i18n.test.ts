/**
 * REQ-269 (demo issue i18n-formatting-m2, demo-rca.md "Staff side is half
 * English in Spanish mode") — the super-admin console, the impersonation bar
 * and the /admin footer follow the app language.
 *
 * RCA: AdminPage.tsx and ImpersonationBanner.tsx had zero t() calls (every
 * string a hard-coded English literal, AdminPage even said it "deliberately
 * doesn't touch the i18n dictionaries"); routes/admin/index.tsx rendered the
 * static server component SiteFooter with the SSR lang, so the topbar's
 * EN/ES toggle never reached it.
 *
 * Dictionary + source contracts; the rendered proof is
 * front-end/lib/staff-i18n.test.tsx, the browser proof
 * e2e/staff-i18n/staff-i18n.e2e.test.ts.
 */
import * as fs from "fs";
import * as path from "path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const en: Record<string, string> = require("../../lang/en.json");
// eslint-disable-next-line @typescript-eslint/no-var-requires
const es: Record<string, string> = require("../../lang/es.json");

/** the files that render the staff copy (the bar's markup lives in its view component) */
const ISLANDS = [
  "front-end/islands/AdminPage.tsx",
  "front-end/islands/ImpersonationBanner.tsx",
  "front-end/components/ImpersonationBannerView.tsx",
];
const COPY = [
  "front-end/islands/AdminPage.tsx",
  "front-end/components/ImpersonationBannerView.tsx",
];
/** REQ-723 — staff chrome that keeps the impersonator's language, never the global t */
const STAFF_CHROME = ["front-end/components/ImpersonationBannerView.tsx"];
/** the same word in both languages, on purpose ("Admin" is the role's name in both, REQ-191) */
const SAME_IN_BOTH = new Set([
  "adminPage.title",
  "adminPage.col.admin",
  "adminPage.demo",
  "adminPage.no",
]);

/** JSX text nodes that carry words: `>Grant<`, `>\n  Return to your account\n<`. */
function jsxTextLiterals(src: string): string[] {
  // drop comments so prose in doc blocks does not count
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  for (const m of code.matchAll(/>([^<>{}]*[A-Za-z]{2,}[^<>{}]*)</g)) {
    const text = m[1].trim();
    // `a => b` arrows and comparisons inside expressions are not JSX text
    if (!text || /[=;()]/.test(text)) continue;
    out.push(text);
  }
  return out;
}

/** English user-facing string literals: attributes and ternary branches. */
function englishStringLiterals(src: string): string[] {
  const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const out: string[] = [];
  for (
    const m of code.matchAll(
      /(?:placeholder|title|aria-label)=["']([^"']*[A-Za-z][^"']*)["']/g,
    )
  ) out.push(m[1]);
  for (
    const m of code.matchAll(
      /[?:]\s*"([A-Z][a-z]+(?:[ .…][^"]*)?)"/g,
    )
  ) out.push(m[1]);
  return out;
}

function keysUsed(src: string): string[] {
  return [...src.matchAll(/\bt\(\s*["'`]([\w.]+)["'`]/g)].map((m) => m[1]);
}

describe("REQ-269 the staff side follows the app language (demo i18n-formatting-m2)", () => {
  it.each(ISLANDS)(
    "REQ-269 %s carries no hard-coded English JSX text",
    (file) => {
      expect(jsxTextLiterals(read(file))).toEqual([]);
    },
  );

  it.each(ISLANDS)(
    "REQ-269 %s carries no hard-coded English placeholder/title/aria-label or ternary copy",
    (file) => {
      expect(englishStringLiterals(read(file))).toEqual([]);
    },
  );

  it.each(COPY.filter((f) => !STAFF_CHROME.includes(f)))(
    "REQ-269 %s renders its copy with t() from lib/i18n.ts",
    (file) => {
      const src = read(file);
      expect(src).toMatch(/import \{[^}]*\bt\b[^}]*\} from "\.\.\/lib\/i18n\.ts"/);
      expect(keysUsed(src).length).toBeGreaterThan(0);
    },
  );

  it.each(STAFF_CHROME)(
    "REQ-723 (cycle 5, p18-7d) %s renders its copy with the staff's t (staffBarT), never the global t",
    (file) => {
      const src = read(file);
      expect(src).not.toMatch(/import \{[^}]*\bt\b[^}]*\} from "\.\.\/lib\/i18n\.ts"/);
      expect(src).toMatch(/import \{ staffBarT \} from "\.\.\/lib\/staff-bar-t\.ts"/);
      expect(src).toMatch(/const t = staffBarT\(who\)/);
      expect(keysUsed(src).length).toBeGreaterThan(0);
    },
  );

  it("REQ-269 AdminPage no longer declares itself English-only", () => {
    expect(read("front-end/islands/AdminPage.tsx")).not.toMatch(
      /intentionally English-only|doesn't touch the i18n/,
    );
  });

  it("REQ-269 every key the two islands use exists in en AND es, translated", () => {
    const keys = new Set(COPY.flatMap((f) => keysUsed(read(f))));
    const missing: string[] = [];
    const untranslated: string[] = [];
    for (const k of keys) {
      if (!en[k] || !es[k]) missing.push(k);
      else if (en[k] === es[k] && !SAME_IN_BOTH.has(k)) untranslated.push(k);
    }
    expect(missing).toEqual([]);
    expect(untranslated).toEqual([]);
  });

  it("REQ-269 the Spanish strings the demo agents expected", () => {
    expect(es["adminPage.lead.users"]).toMatch(/^Busca usuarios/);
    expect(es["adminPage.searching"]).toBe("Buscando…");
    expect(es["impersonation.acting"]).toMatch(/Suplantando/);
    expect(es["impersonation.return"]).toBe("Volver a tu cuenta");
  });

  it("REQ-269 the island mounts the translated view", () => {
    expect(read("front-end/islands/ImpersonationBanner.tsx")).toMatch(
      /<ImpersonationBannerView\b/,
    );
  });

  it("REQ-269 every adminPage.* / impersonation.* key exists in both dictionaries", () => {
    const own = (d: Record<string, string>) =>
      Object.keys(d).filter((k) => /^(adminPage|impersonation)\./.test(k))
        .sort();
    expect(own(en).length).toBeGreaterThan(0);
    expect(own(es)).toEqual(own(en));
  });

  it("REQ-269 /admin's footer is the live island that follows langSignal, not a static footer", () => {
    // REQ-367 made the one SiteFooter the live island on every page: /admin renders it like the rest
    const route = read("front-end/routes/admin/index.tsx");
    expect(route).toMatch(/import SiteFooter from "\.\.\/\.\.\/components\/SiteFooter\.tsx"/);
    expect(route).toMatch(/<SiteFooter lang=\{lang\}( compact)? \/>/); // REQ-425: the app routes pass compact
    expect(read("front-end/components/SiteFooter.tsx")).toMatch(/<SiteFooterLive\b/);
    const island = read("front-end/islands/SiteFooterLive.tsx");
    expect(island).toMatch(/useLiveLang\(lang\)/);
    expect(read("front-end/lib/live-lang.ts")).toMatch(/langSignal\.subscribe/);
    expect(island).toMatch(/<SiteFooterView\s+copy=/ /* REQ-509: the props may wrap */);
  });
});
