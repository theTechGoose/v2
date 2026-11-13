/**
 * REQ-231 — the server renders every island in the signed-in user's language,
 * and the browser hydrates in that same language (demo issues
 * stage-content-m2 and quote-invoice-money-m11; RCA ssr-lang-flash).
 *
 * The bug: `langSignal` is a module-level signal whose server value is the
 * Spanish-first default and is never set per request, so every SSR'd island
 * (t(), langSignal.value) painted Spanish for an English user until hydration —
 * and an attribute such as the assistant composer's `placeholder` stayed
 * Spanish for good, because Preact's hydration does not patch attributes.
 *
 *   deno test -A front-end/lib/ssr-lang.test.ts
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import { h } from "preact";
import { renderToString } from "npm:preact-render-to-string@^6.6.3";
import en from "../../lang/en.json" with { type: "json" };
import es from "../../lang/es.json" with { type: "json" };
import { langSignal, pickClientLang } from "./lang.ts";
import { t } from "./i18n.ts";
import {
  bootLangScript,
  resolveSsrLang,
  type SsrLangSource,
  withRequestLang,
} from "./ssr-lang.ts";

const EN_PLACEHOLDER =
  (en as Record<string, string>)["asstChat.composer.default"];
const ES_PLACEHOLDER =
  (es as Record<string, string>)["asstChat.composer.default"];

function src(
  path: string,
  opts: { cookie?: string; user?: "en" | "es"; stateLang?: "en" | "es" } = {},
): SsrLangSource {
  const url = new URL(`http://localhost${path}`);
  const headers = new Headers();
  if (opts.cookie) headers.set("cookie", opts.cookie);
  return {
    url,
    req: new Request(url, { headers }),
    state: {
      ...(opts.user ? { user: { language: opts.user } } : {}),
      ...(opts.stateLang ? { lang: opts.stateLang } : {}),
    },
  };
}

/** Stand-in for an island: reads the language exactly the way AsstChat's
 *  composer does (t()/langSignal.value), and puts it in an attribute. */
function Composer() {
  return h("textarea", {
    placeholder: t("asstChat.composer.default"),
    "data-lang": langSignal.value,
  });
}

Deno.test("REQ-231: resolveSsrLang — page's own lang > ?lang= > user.language > pm_lang cookie > none", () => {
  assertEquals(resolveSsrLang(src("/assistant")), null);
  assertEquals(
    resolveSsrLang(src("/assistant", { cookie: "pm_lang=en" })),
    "en",
  );
  // The signed-in user's profile language beats a cookie another window
  // (the staff's own pages in demo mode) left on the shared origin.
  assertEquals(
    resolveSsrLang(src("/assistant", { cookie: "pm_lang=es", user: "en" })),
    "en",
  );
  assertEquals(
    resolveSsrLang(src("/assistant?lang=es", { user: "en" })),
    "es",
  );
  assertEquals(
    resolveSsrLang(src("/q/1?lang=es", { stateLang: "en", user: "es" })),
    "en",
  );
  assertEquals(resolveSsrLang(src("/assistant?lang=fr")), null);
});

Deno.test("REQ-231: an island SSR'd for an English user renders the English composer placeholder (m11)", () => {
  const html = withRequestLang(
    src("/assistant", { user: "en" }),
    () => renderToString(h(Composer, null)),
  );
  assertStringIncludes(html, `data-lang="en"`);
  assertStringIncludes(
    html,
    EN_PLACEHOLDER.replaceAll("'", "&#39;").slice(0, 20),
  );
  assertEquals(html.includes("Ej: El cliente"), false, html);
});

Deno.test("REQ-231: a Spanish user's island still SSRs Spanish", () => {
  const html = withRequestLang(
    src("/dashboard", { user: "es" }),
    () => renderToString(h(Composer, null)),
  );
  assertStringIncludes(html, `data-lang="es"`);
  assertStringIncludes(html, ES_PLACEHOLDER.slice(0, 14));
});

Deno.test("REQ-231: concurrent requests each render in their own language (no shared module state)", async () => {
  const gate = Promise.withResolvers<void>();
  const a = withRequestLang(src("/dashboard", { user: "en" }), async () => {
    await gate.promise; // the Spanish request runs while this one is suspended
    return renderToString(h(Composer, null));
  });
  const b = withRequestLang(src("/dashboard", { user: "es" }), () => {
    const html = renderToString(h(Composer, null));
    gate.resolve();
    return html;
  });
  assertStringIncludes(await a, `data-lang="en"`);
  assertStringIncludes(b, `data-lang="es"`);
});

Deno.test("REQ-231: outside a request the server keeps the Spanish-first default", () => {
  assertEquals(langSignal.value, "es");
});

Deno.test("REQ-231: bootLangScript hands the SSR language to the browser, nothing when there is none", () => {
  assertEquals(bootLangScript(null), "");
  assertEquals(bootLangScript("en"), `window.__PM_LANG="en";`);
});

Deno.test("REQ-231: the client seed hydrates in the server's language, persisting only a real choice", () => {
  // server said en; a stale pm:lang (another window's) must not win
  assertEquals(
    pickClientLang({ server: "en", query: null, stored: "es" }),
    { lang: "en", persist: "es" },
  );
  assertEquals(
    pickClientLang({ server: undefined, query: "en", stored: "es" }),
    { lang: "en", persist: "en" },
  );
  assertEquals(
    pickClientLang({ server: undefined, query: null, stored: "en" }),
    { lang: "en", persist: "en" },
  );
  assertEquals(
    pickClientLang({ server: "garbage", query: null, stored: null }),
    { lang: "es", persist: null },
  );
});
