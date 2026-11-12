import { assert, assertEquals } from "@std/assert";
import {
  DEFAULT_VERIFY_EDIT_HREF,
  VERIFY_EDIT_HREFS,
  verifyEditHref,
} from "./verify-edit-href.ts";

/**
 * REQ-351 — demo cycle 1, issue p15-12: on /verify, "Wrong number? Edit" sent a
 * visitor who typed the number on /login to "/", the marketing page. The link
 * must return to the phone form the person came from.
 */
Deno.test("REQ-351 verifyEditHref — each origin returns to its own phone form", () => {
  assertEquals(verifyEditHref("login"), "/login");
  assertEquals(verifyEditHref("home"), "/#contact");
  assertEquals(verifyEditHref("landing"), "/landing#trial");
  assertEquals(verifyEditHref("landing2"), "/landing2");
});

Deno.test("REQ-351 verifyEditHref — missing or unknown origin goes to /login, never / or a reflected URL", () => {
  assertEquals(DEFAULT_VERIFY_EDIT_HREF, "/login");
  for (
    const from of [
      null,
      undefined,
      "",
      "https://evil.example",
      "//evil.example",
      "toString",
      "__proto__",
      "constructor",
    ]
  ) {
    assertEquals(verifyEditHref(from), "/login", `from=${String(from)}`);
  }
});

const ROOT = decodeURIComponent(new URL("../", import.meta.url).pathname);
const PRODUCERS = [
  "islands/LoginForm.tsx",
  "islands/TrialSignup.tsx",
  "islands/LandingScripts.tsx",
  "islands/Landing2Signup.tsx",
  "static/landing-scripts.js",
];

/**
 * The guard that keeps this from coming back: every place that hands off to
 * /verify names its origin with a from= the allow-list knows. A new sign-in
 * form that forgets it fails here instead of in the next demo.
 */
Deno.test("REQ-351 every hand-off to /verify carries a from= the Edit link knows", async () => {
  const expected: Record<string, string> = {
    "islands/LoginForm.tsx": "login",
    "islands/TrialSignup.tsx": "landing",
    "islands/LandingScripts.tsx": "home",
    "islands/Landing2Signup.tsx": "landing2",
    "static/landing-scripts.js": "home",
  };
  let handOffs = 0;
  for (const file of PRODUCERS) {
    const src = await Deno.readTextFile(ROOT + file);
    // each `/verify?` navigation up to the end of its statement
    for (const m of src.matchAll(/["`]\/verify\?[^;]*;/g)) {
      handOffs++;
      const from = /from=(\w+)/.exec(m[0])?.[1];
      assert(from, `${file}: a /verify hand-off without from= — ${m[0]}`);
      assert(
        Object.hasOwn(VERIFY_EDIT_HREFS, from),
        `${file}: from=${from} is not on the Edit allow-list`,
      );
      assertEquals(from, expected[file], `${file}: names the wrong origin`);
    }
  }
  assert(handOffs >= 6, `found only ${handOffs} /verify hand-offs`);
});

Deno.test("REQ-351 no other front-end file hands off to /verify unlisted", async () => {
  const unlisted: string[] = [];
  for (const dir of ["islands", "components", "routes", "static", "lib"]) {
    for await (const f of walk(ROOT + dir)) {
      const rel = f.slice(ROOT.length);
      if (PRODUCERS.includes(rel) || rel.includes("_proto")) continue;
      if (!/\.(tsx?|js)$/.test(rel) || rel.endsWith(".test.ts")) continue;
      const src = await Deno.readTextFile(f);
      if (/["`]\/verify\?/.test(src)) unlisted.push(rel);
    }
  }
  assertEquals(unlisted, [], "add these to PRODUCERS with a from= origin");
});

Deno.test("REQ-351 /verify and CodeInput take the Edit link from verifyEditHref, not a hardcoded '/'", async () => {
  const route = await Deno.readTextFile(ROOT + "routes/verify.tsx");
  assert(
    /verifyEditHref\(url\.searchParams\.get\("from"\)\)/.test(route),
    "routes/verify.tsx builds editHref with verifyEditHref(from)",
  );
  const input = await Deno.readTextFile(ROOT + "islands/CodeInput.tsx");
  assert(
    !/editHref \?\? "\/"/.test(input),
    "CodeInput's fallback Edit link is not the marketing page",
  );
});

async function* walk(dir: string): AsyncGenerator<string> {
  for await (const e of Deno.readDir(dir)) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory) yield* walk(p);
    else if (e.isFile) yield p;
  }
}
