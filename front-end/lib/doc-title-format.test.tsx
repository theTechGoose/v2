/**
 * REQ-977 (LOOP-007 cycle 1, q1-56) — one browser-tab title format. Every
 * signed-in app page's tab reads "<Page> · DocuMonster" in EN and ES: it ends
 * with " · DocuMonster", never uses an em/en dash, and the pages whose sidebar
 * row names them (dashboard, communications, outbox, reports) start with that
 * sidebar label. A customer's own page names her AND the brand.
 *
 * The test walks every <DocTitle … title={(l) => …} /> call site under
 * routes/, evaluates that builder (the route's own expression, with the real
 * tFor and every export of lib/doc-title.ts in scope), renders it through the
 * real components/DocTitle.tsx, and judges the painted <title> and both
 * data-title-en / data-title-es — so it holds whether the brand is appended
 * by the dictionaries, by DocTitle, or by a doc-title.ts helper.
 *
 *   cd front-end && deno test -A lib/doc-title-format.test.tsx
 */
import { assert, assertEquals } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import DocTitle from "../components/DocTitle.tsx";
import * as docTitleLib from "./doc-title.ts";
import * as i18n from "./i18n.ts";
import { type Lang, tFor } from "./i18n.ts";

const ROUTES = new URL("../routes/", import.meta.url);
const LANGS: Lang[] = ["en", "es"];
const BRAND = ` · ${tFor("en", "brand.name")}`;

/**
 * Pages outside the signed-in app (no sidebar): the customer's quote/invoice/
 * change-order/signing links, sign-in, onboarding, errors, the demo stage and
 * fake/test pay pages. They may keep their own titles.
 */
const PUBLIC = new Set([
  "_error.tsx",
  "login.tsx",
  "login-internal.tsx",
  "verify.tsx",
  "verify-internal.tsx",
  "contact.tsx",
  "welcome.tsx",
  "demo/stage.tsx",
  "pay/fake.tsx",
  "plan/pay.tsx",
  "plan/test.tsx",
  "ops/approve/[token].tsx",
  "q/[id].tsx",
  "i/[id].tsx",
  "i/[id]/pay.tsx",
  "co/[id].tsx",
  "sign/[token].tsx",
]);

function walk(dir: URL, rel = ""): string[] {
  const out: string[] = [];
  for (const e of Deno.readDirSync(dir)) {
    if (e.isDirectory) {
      out.push(...walk(new URL(`${e.name}/`, dir), `${rel}${e.name}/`));
    } else if (e.name.endsWith(".tsx") && !e.name.includes(".test.")) {
      out.push(`${rel}${e.name}`);
    }
  }
  return out;
}

/** every in-app route file and the source of its DocTitle title builder */
const SITES = walk(ROUTES)
  .map((rel) => {
    const src = Deno.readTextFileSync(new URL(rel, ROUTES));
    const m = src.match(
      /<DocTitle[\s\S]*?title=\{\(l\)\s*=>\s*([\s\S]*?)\}\s*\/>/,
    );
    return { rel, builder: m?.[1] };
  })
  .filter((s): s is { rel: string; builder: string } =>
    s.builder !== undefined && !PUBLIC.has(s.rel)
  );

/** a customer's name for the builders that read one (customers/[id].tsx) */
const CUSTOMER = "Linda Pérez";

/** the builder as a function, in a scope of the real i18n + doc-title exports */
function builderFn(builder: string): (l: Lang) => string {
  const scope: Record<string, unknown> = {
    ...i18n,
    ...docTitleLib,
    name: CUSTOMER,
  };
  const keys = Object.keys(scope);
  const make = new Function(...keys, `return (l) => (${builder});`);
  return make(...keys.map((k) => scope[k]));
}

/** what the tab shows: the painted <title> for `lang`, plus each language's attribute */
function tab(builder: string, lang: Lang): { text: string; en: string; es: string } {
  const html = renderToString(
    <DocTitle lang={lang} title={builderFn(builder)} />,
  );
  const m = html.match(/<title([^>]*)>([^<]*)<\/title>/);
  assert(m, `no <title> in ${html}`);
  const attr = (n: string) => m[1].match(new RegExp(`${n}="([^"]*)"`))?.[1] ?? "";
  const dec = (v: string) => v.replace(/&amp;/g, "&").replace(/&#39;/g, "'");
  return { text: dec(m[2]), en: dec(attr("data-title-en")), es: dec(attr("data-title-es")) };
}

/** each in-app page's title in each language, as the tab shows it */
function titles(): { rel: string; lang: Lang; title: string }[] {
  return SITES.flatMap((s) =>
    LANGS.map((lang) => {
      const t = tab(s.builder, lang);
      // the painted text and that language's attribute agree (REQ-367)
      assertEquals(t.text, t[lang], `${s.rel} [${lang}]`);
      return { rel: s.rel, lang, title: t.text };
    })
  );
}

Deno.test("REQ-977 (q1-56): the walk finds the in-app DocTitle call sites", () => {
  const rels = SITES.map((s) => s.rel);
  for (
    const r of [
      "dashboard/index.tsx",
      "communications/index.tsx",
      "messages/index.tsx",
      "reports/index.tsx",
      "customers/[id].tsx",
      "hr/index.tsx",
      "quotes/index.tsx",
    ]
  ) assert(rels.includes(r), `missing ${r}`);
  assert(SITES.length >= 30, `only ${SITES.length} sites`);
});

Deno.test("REQ-977 (q1-56): every in-app tab title ends with ' · DocuMonster' in EN and ES", () => {
  const bad = titles().filter((t) => !t.title.endsWith(BRAND))
    .map((t) => `${t.rel} [${t.lang}] "${t.title}"`);
  assertEquals(bad, []);
});

Deno.test("REQ-977 (q1-56): no in-app tab title uses an em/en dash separator", () => {
  const bad = titles().filter((t) => / [—–] /.test(t.title))
    .map((t) => `${t.rel} [${t.lang}] "${t.title}"`);
  assertEquals(bad, []);
});

Deno.test("REQ-977 (q1-56): dashboard, communications, outbox and reports tabs start with their sidebar label", () => {
  const PAGES: [string, string[]][] = [
    ["dashboard/index.tsx", ["nav.home"]],
    // the sidebar shows Communications > Phone; either label leads
    ["communications/index.tsx", ["nav.phone", "nav.communications"]],
    ["messages/index.tsx", ["nav.outbox"]],
    ["reports/index.tsx", ["nav.reports"]],
  ];
  const bad: string[] = [];
  for (const [rel, navKeys] of PAGES) {
    const s = SITES.find((x) => x.rel === rel)!;
    for (const l of LANGS) {
      const t = tab(s.builder, l).text;
      const labels = navKeys.map((k) => `${tFor(l, k)} · `);
      if (!labels.some((p) => t.startsWith(p))) {
        bad.push(`${rel} [${l}] "${t}" should start with ${labels.map((p) => `"${p}"`).join(" or ")}`);
      }
    }
  }
  assertEquals(bad, []);
});

Deno.test("REQ-977 (q1-56): a customer's page tab names her, Customers and the brand", () => {
  const s = SITES.find((x) => x.rel === "customers/[id].tsx")!;
  for (const l of LANGS) {
    assertEquals(
      [l, tab(s.builder, l).text],
      [l, `${CUSTOMER} · ${tFor(l, "nav.customers")}${BRAND}`],
    );
  }
});
