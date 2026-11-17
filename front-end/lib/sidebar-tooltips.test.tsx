/**
 * REQ-517 (demo-loop cycle 3, demo issue p8-pair8-a) — the collapsed sidebar's
 * icons name themselves. In the demo the rail collapsed to bare icons:
 * folder rows and Back carried `title=`, but the link rows (Dashboard,
 * Customers, Quotes, …) and the super-admin Admin link had neither a title
 * nor an aria-label, and their label span leaves the DOM when collapsed —
 * no hover tooltip, no accessible name. The rail's bottom rows (Worker view,
 * Log out) had the same gap: Worker view's label leaves the DOM, Log out's is
 * display:none under `.sb--collapsed`.
 *
 * Renders the real island collapsed (pm:sb-collapsed=1) and expanded.
 *
 *   cd front-end && deno test -A lib/sidebar-tooltips.test.tsx
 */
import { assert, assertEquals } from "@std/assert";
import { renderToString } from "npm:preact-render-to-string@^6.6.7";
import { langSignal, tFor } from "./i18n.ts";
import DashSidebar from "../islands/DashSidebar.tsx";

const CACHE_KEY = "pm:dash-cache:v1";

function render(
  active: string,
  { collapsed, lang = "en" }: { collapsed: boolean; lang?: "en" | "es" },
): string {
  const before = langSignal.value;
  langSignal.value = lang;
  globalThis.localStorage.setItem("pm:sb-collapsed", collapsed ? "1" : "0");
  try {
    return renderToString(<DashSidebar active={active} />);
  } finally {
    langSignal.value = before;
    globalThis.localStorage.removeItem("pm:sb-collapsed");
  }
}

/** Every `.nav-item` opening tag (link or button) in the rendered rail. */
function navItems(html: string): string[] {
  return [
    ...html.matchAll(/<(?:a|button)\b[^>]*class="nav-item[^"]*"[^>]*>/g),
  ].map((m) => m[0]);
}

Deno.test("REQ-517 (p8-pair8-a): collapsed, every nav row has a title and an aria-label naming it", () => {
  for (const lang of ["en", "es"] as const) {
    const html = render("home", { collapsed: true, lang });
    const links = navItems(html);
    assert(links.length > 0, "the collapsed rail renders nav rows");
    for (const a of links) {
      assert(/\btitle="[^"]+"/.test(a), `no title on ${a}`);
      assert(/\baria-label="[^"]+"/.test(a), `no aria-label on ${a}`);
    }
    const home = tFor(lang, "nav.home");
    assert(
      links.some((a) =>
        a.includes(`title="${home}"`) && a.includes(`aria-label="${home}"`)
      ),
      `${lang}: the Dashboard row is named "${home}"`,
    );
    for (const key of ["nav.workerView", "nav.logout"]) {
      const name = tFor(lang, key);
      assert(
        links.some((a) => a.includes(`aria-label="${name}"`)),
        `${lang}: the rail's "${name}" row is named`,
      );
    }
  }
});

Deno.test("REQ-517 (p8-pair8-a): expanded, link rows keep a title tooltip (the visible label is the name)", () => {
  const html = render("home", { collapsed: false });
  const links = navItems(html);
  assert(links.length > 0);
  for (const a of links) assert(/\btitle="[^"]+"/.test(a), `no title on ${a}`);
});

Deno.test("REQ-517 (p8-pair8-a): the super-admin Admin link is named when collapsed", () => {
  globalThis.sessionStorage.setItem(
    CACHE_KEY,
    JSON.stringify({
      stats: null,
      profile: { user: { superAdmin: true, language: "en" } },
    }),
  );
  try {
    const html = render("admin", { collapsed: true });
    const admin = navItems(html).filter((a) => a.includes('href="/admin"'));
    assertEquals(admin.length, 1, "the Admin link renders for a super-admin");
    assert(admin[0].includes('title="Admin"'), admin[0]);
    assert(admin[0].includes('aria-label="Admin"'), admin[0]);
  } finally {
    globalThis.sessionStorage.removeItem(CACHE_KEY);
  }
});
