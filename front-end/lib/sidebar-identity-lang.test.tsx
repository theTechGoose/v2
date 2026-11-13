/**
 * REQ-712 (demo-loop cycle 5, issue m7) — the sidebar names the account in
 * the PAGE's language. In the demo a Spanish account on /admin?lang=en read
 * "Cuenta" under an English rail: the identity was worded with the profile's
 * saved language, not the language the page paints.
 *
 *   cd front-end && deno test -A lib/sidebar-identity-lang.test.tsx
 */
import { assert } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.6.7";
import { langSignal } from "./i18n.ts";
import DashSidebar from "../islands/DashSidebar.tsx";
import { _resetForTest } from "./dash-cache.ts";

const CACHE_KEY = "pm:dash-cache:v1";

function render(lang: "en" | "es", profileLang: "en" | "es"): string {
  _resetForTest();
  globalThis.sessionStorage.setItem(
    CACHE_KEY,
    JSON.stringify({
      stats: null,
      profile: { user: { language: profileLang } },
    }),
  );
  const before = langSignal.value;
  langSignal.value = lang;
  try {
    return renderToString(<DashSidebar active="home" />);
  } finally {
    langSignal.value = before;
    globalThis.sessionStorage.removeItem(CACHE_KEY);
    _resetForTest();
  }
}

Deno.test("REQ-712 (m7): a Spanish profile with no name on an English page reads 'Account', not 'Cuenta'", () => {
  const html = render("en", "es");
  assert(html.includes(">Account<"), "the English rail names the account");
  assert(!html.includes(">Cuenta<"), "no Spanish 'Cuenta' on the EN page");
});

Deno.test("REQ-712 (m7): an English profile on a Spanish page reads 'Cuenta'", () => {
  const html = render("es", "en");
  assert(html.includes(">Cuenta<"), "the Spanish rail names the account");
  assert(!html.includes(">Account<"), "no English 'Account' on the ES page");
});
