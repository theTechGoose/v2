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

/**
 * REQ-1070 (LOOP-007 cycle 2, q2-59): U+2300–U+23FF Miscellaneous Technical
 * (⏭ ⏯ ⏩ ⌘ ⏎ …) is not in the app's web fonts either. WorkerScreen's Defer
 * buttons and deferred hints drew a literal ⏭ next to SVG siblings, and
 * PhoneChat's end-state control did the same; DINGBAT above never covered the
 * block. A keyboard-key label inside `<kbd>…</kbd>` (AsstComposer's ⏎ / ⇧⏎
 * send hint) is text naming a key, not an icon, so it is stripped first.
 */
const MISC_TECHNICAL = /[\u2300-\u23FF]/u;
const stripKbd = (l: string) => l.replace(/<kbd>[^<]*<\/kbd>/g, "");

Deno.test("REQ-1070 (LOOP-007 q2-59): no app UI source uses a Misc Technical glyph (U+2300–23FF, e.g. ⏭) as an icon", async () => {
  const hits: string[] = [];
  for (const dir of ["islands", "components", "routes", "lib"]) {
    for await (const file of sources(join(FE, dir))) {
      const rel = relative(FE, file);
      if (ALLOW_FILES.has(rel)) continue;
      const lines = codeLines(await Deno.readTextFile(file));
      lines.forEach((l, i) => {
        if (MISC_TECHNICAL.test(stripKbd(l))) {
          hits.push(`front-end/${rel}:${i + 1}: ${l.trim()}`);
        }
      });
    }
  }
  assertEquals(
    hits,
    [],
    "literal Misc Technical glyphs fall back per character (no web-font coverage) — use <Icon name=…/>:\n" +
      hits.join("\n"),
  );
});

Deno.test("REQ-1070 (LOOP-007 q2-59): no app lang string carries a Misc Technical glyph", async () => {
  const hits: string[] = [];
  for (const lang of ["en", "es"]) {
    const dict = JSON.parse(
      await Deno.readTextFile(join(ROOT, "lang", `${lang}.json`)),
    ) as Record<string, string>;
    for (const [k, v] of Object.entries(dict)) {
      if (ALLOW_LANG_KEY.test(k)) continue;
      if (typeof v === "string" && MISC_TECHNICAL.test(v)) {
        hits.push(`${lang}:${k}=${v}`);
      }
    }
  }
  assertEquals(hits, [], hits.join("\n"));
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

/**
 * REQ-1147 (LOOP-007 cycle 3, q3-78) — Raphael: "test every single aspect of
 * this application … one Opus agent per issue to do root cause analysis, then
 * one to write the test, then one to fix it and make it green."
 *
 * QA: "Emoji in menus and the activity feed". REQ-924's customer workspace
 * (1c0be6f7) drew its icons as emoji literals — the More menu's 💬 / 🔁 next to
 * the SVG pencil of "Edit", the header's 📍 next to the SVG phone / mail, the
 * service card's 📍 next to its SVG repeat icon, the activity feed's
 * 💵 🧾 📝 🔁 dots — and the customers sidebar's 🔁 schedule line. Emoji draw
 * through the OS colour-emoji font, so one menu / row mixes two icon styles,
 * and DINGBAT / MISC_TECHNICAL above never covered U+1F300–1FAFF or
 * U+2600–26FF. The owner call (REQ-1147, amending REQ-366 / REQ-1070): emoji
 * are not UI icons on app surfaces; copy emoji inside message text stay.
 *
 * Scope: the surfaces where QA saw the emoji used as icons — the customer
 * workspace, the customers sidebar, and the same 💬 note icon in the field
 * task list and the worker screen. Each uses the matching SVG from
 * lib/dash-icons.tsx (ICN.msg / repeat / pin / pay / invoice / quote).
 */
const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{26FF}]/u;
const EMOJI_ICON_SURFACES = [
  "islands/CustomerWorkspace.tsx",
  "components/CustomersNav.tsx",
  "islands/FieldTasksPage.tsx",
  "islands/WorkerScreen.tsx",
  // the fixer's sweep of the other emoji-as-icon spots: the zone pin (📌), the
  // invoices page's at-risk ⚠ and paid-lock 🔒
  "islands/FieldAssignmentsPage.tsx",
  "islands/FieldSubscriptionsPage.tsx",
  "islands/InvoicesPage.tsx",
];

Deno.test("REQ-1147 (LOOP-007 q3-78): the customer workspace, customers sidebar, field tasks and worker screen draw no emoji as an icon (U+1F300–1FAFF, U+2600–26FF)", async () => {
  const hits: string[] = [];
  for (const rel of EMOJI_ICON_SURFACES) {
    const lines = codeLines(await Deno.readTextFile(join(FE, rel)));
    lines.forEach((l, i) => {
      if (EMOJI.test(l)) hits.push(`front-end/${rel}:${i + 1}: ${l.trim()}`);
    });
  }
  assertEquals(
    hits,
    [],
    "emoji icons draw through the OS colour-emoji font next to stroke SVG icons — use <I d={ICN.…}/> / <Icon name=…/>:\n" +
      hits.join("\n"),
  );
});

Deno.test("REQ-1147 (LOOP-007 q3-78): the customer activity feed's .cws-dot draws an SVG icon, not an emoji", async () => {
  const src = await Deno.readTextFile(join(FE, "islands/CustomerWorkspace.tsx"));
  const start = src.indexOf("function Activity(");
  assert(start > 0, "CustomerWorkspace has its Activity() feed");
  const end = src.indexOf("\nfunction ", start + 1);
  const body = src.slice(start, end > 0 ? end : undefined);
  const icons = [...body.matchAll(/icon:\s*([^,\n]+)/g)].map((m) => m[1].trim());
  assert(icons.length >= 4, `the feed has its four item kinds:\n${icons.join("\n")}`);
  assertEquals(
    icons.filter((v) => EMOJI.test(v)),
    [],
    "activity items carry an ICN path, not an emoji string",
  );
  const dot = body.match(/<span class="cws-dot"[^>]*>([\s\S]*?)<\/span>/);
  assert(dot, "the feed renders each item in <span class=\"cws-dot\">");
  assert(
    /<I\s+d=\{/.test(dot[1]) || /<Icon\s/.test(dot[1]),
    `the dot renders an SVG (<I d={…}/>), not the icon string as text:\n${dot[0]}`,
  );
});
