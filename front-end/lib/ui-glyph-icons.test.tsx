/**
 * REQ-366 — Raphael: "fix every issue the demo found, loop until there are
 * none" / "make sure we never have to do this again". Demo issue setup-m4
 * (demo-loop cycle 1, run r20a1d9c2): the checklist ticks and the ✎ edit
 * pencil rendered as empty "tofu" boxes — on the customer side in pairs
 * 1,2,3,4,6,7,10 and only on the demo stage in pairs 8/9.
 *
 * Root cause (RCA, commit 4da03589): the icons were literal characters
 * (SetupChecklist ✓, AsstChat ✎, pay/fake ✓, …). The app's web fonts
 * (Google Nunito / Inter, latin + latin-ext subsets — dashboard.css @import)
 * carry no Dingbats (U+2700–U+27BF), so every such glyph came from Chromium's
 * per-character font fallback, which varies per document / frame.
 *
 * The rule now: a UI icon is an inline SVG (components/ui/Icon.tsx), never a
 * Dingbat character. This test is the guard that keeps it that way: it scans
 * every app surface's source (and the app's lang copy) for Dingbats outside
 * comments, and renders the replacement icons to prove they are <svg>.
 */
import { assert, assertEquals } from "@std/assert";
import { renderToString } from "preact-render-to-string";
import { Icon } from "../components/ui/Icon.tsx";
import OnboardingProgress from "../islands/OnboardingProgress.tsx";
import PublicSignQuote from "../islands/PublicSignQuote.tsx";

const FE = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const join = (...parts: string[]) => parts.join("/");
const relative = (base: string, p: string) => p.slice(base.length + 1);

/**
 * U+2700–U+27BF Dingbats (✓ ✔ ✎ ✏ ✕ ✖ ✗ ✘ …) and — REQ-407, demo-loop cycle 2
 * m30, where "Adjust invoice ▾" drew a tofu box — U+25A0–U+25FF Geometric
 * Shapes (▾ ▸ ◀ ▶ ■ ●): none are in the app's web fonts.
 */
const DINGBAT = /[✀-➿■-◿]/u;

/**
 * Marketing landing pages: decorative copy ("Signed ✓") inside a mock
 * document, not an app or customer-facing UI icon, and owned by the landing
 * i18n source. Everything else must use <Icon>.
 */
const ALLOW_FILES = new Set([
  "routes/index.tsx",
  "routes/landing2.tsx",
  "islands/LandingScripts.tsx",
  "islands/Landing2Docs.tsx",
  "lib/landing-dict.ts",
]);
/** REQ-712 AMENDMENT (reconciled on demo-fixes): the signed thread row's
 *  stored preview "✓ {label}" — the same plain-text preview the backend has
 *  stored since REQ-563, now worded from its key so it follows the live
 *  language. It is thread-list text, not a UI icon. */
const ALLOW_LANG_KEY = /^(landing\.|landing3\.|acceptQuote\.signed\.preview$)/;

/**
 * Blank comment lines (`//`, `/*`, ` *`, `{/*`) and trailing `// …` comments.
 * Line-based on purpose: a global block-comment regex mis-pairs `/*` inside
 * strings/regexes and silently hides real hits.
 */
function codeLines(src: string): string[] {
  return src.split("\n").map((l) =>
    /^\s*(\/\/|\/\*|\*|\{\/\*)/.test(l)
      ? ""
      : l.replace(/(^|\s)\/\/\s.*$/, "$1")
  );
}

async function* sources(dir: string): AsyncGenerator<string> {
  for await (const e of Deno.readDir(dir)) {
    const p = join(dir, e.name);
    if (e.isDirectory) {
      if (e.name === "node_modules" || e.name.startsWith("_")) continue;
      yield* sources(p);
    } else if (
      /\.(tsx?|jsx?)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)
    ) yield p;
  }
}

Deno.test("REQ-366 setup-m4: no app UI source uses a Dingbat character as an icon", async () => {
  const hits: string[] = [];
  for (const dir of ["islands", "components", "routes", "lib"]) {
    for await (const file of sources(join(FE, dir))) {
      const rel = relative(FE, file);
      if (ALLOW_FILES.has(rel)) continue;
      const lines = codeLines(await Deno.readTextFile(file));
      lines.forEach((l, i) => {
        if (DINGBAT.test(l)) {
          hits.push(`front-end/${rel}:${i + 1}: ${l.trim()}`);
        }
      });
    }
  }
  assertEquals(
    hits,
    [],
    "literal Dingbat glyphs render as tofu boxes (no web-font coverage) — use <Icon name=…/>:\n" +
      hits.join("\n"),
  );
});

Deno.test("REQ-366 setup-m4: no app lang string carries a Dingbat glyph", async () => {
  const hits: string[] = [];
  for (const lang of ["en", "es"]) {
    const dict = JSON.parse(
      await Deno.readTextFile(join(ROOT, "lang", `${lang}.json`)),
    ) as Record<string, string>;
    for (const [k, v] of Object.entries(dict)) {
      if (ALLOW_LANG_KEY.test(k)) continue;
      if (typeof v === "string" && DINGBAT.test(v)) {
        hits.push(`${lang}:${k}=${v}`);
      }
    }
  }
  assertEquals(hits, [], hits.join("\n"));
});

Deno.test("REQ-366 setup-m4: the icon set has the check / pencil / x replacements as SVG", () => {
  for (
    const name of [
      "check",
      "pencil",
      "x",
      "chevron-down",
      "chevron-left",
      "chevron-right",
      "play",
    ] as const
  ) {
    const html = renderToString(<Icon name={name} />);
    assert(html.startsWith("<svg"), `${name}: ${html}`);
    assert(/<path d="[^"]+"/.test(html), `${name} has a path: ${html}`);
    assert(!DINGBAT.test(html), `${name}: ${html}`);
  }
});

Deno.test("REQ-366 setup-m4: the finished onboarding strip draws its tick as SVG", () => {
  const html = renderToString(<OnboardingProgress initialStep={4} />);
  assert(html.includes("<svg"), html.slice(0, 2000));
  assert(!DINGBAT.test(html), "no Dingbat in the rendered strip");
});

Deno.test("REQ-366 setup-m4: the customer's signature pad draws its sign-here mark as SVG", () => {
  const html = renderToString(<PublicSignQuote quoteId="q1" lang="en" />);
  assert(!DINGBAT.test(html), "no ✕ character on the signature line");
  assert(
    html.includes('data-icon="x"'),
    "the sign-here mark is an <Icon name=x>",
  );
});
