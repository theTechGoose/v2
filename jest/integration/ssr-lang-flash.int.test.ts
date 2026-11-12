/**
 * REQ-231 — demo issues stage-content-m2 + quote-invoice-money-m11 (RCA
 * ssr-lang-flash): the SSR'd islands of a signed-in English user's pages were
 * Spanish (langSignal's module default on the server), so the page flashed
 * Spanish until hydration and the assistant composer's placeholder attribute
 * ("Ej: El cliente quiere una losa…") stayed Spanish for good.
 *
 * Over the dev stack: the raw server HTML of /assistant and /dashboard for an
 * English user carries the English composer placeholder / island copy and hands
 * the browser the language it rendered in (`window.__PM_LANG`), even when the
 * shared pm_lang cookie says Spanish (the staff's own pages in demo mode).
 */
import { type ApiSession, contractor } from "./helpers/api";
import en from "../../lang/en.json";
import es from "../../lang/es.json";

const FE = process.env.FRONTEND_BASE_URL ?? "http://localhost:5280";
const EN = en as Record<string, string>;
const ES = es as Record<string, string>;

const decode = (s: string) =>
  s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");

async function ssr(s: ApiSession, path: string, extraCookie = "") {
  const res = await fetch(`${FE}${path}`, {
    headers: {
      cookie: [s.cookieHeaderValue(), extraCookie].filter(Boolean).join("; "),
    },
    redirect: "manual",
  });
  return { status: res.status, html: decode(await res.text()) };
}

describe("REQ-231 SSR renders islands in the signed-in user's language", () => {
  let s: ApiSession;

  beforeAll(async () => {
    s = await contractor(
      `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`,
    );
    const me = await s.put("/me", { name: "Lang Flash", language: "en" });
    expect(me.status).toBeLessThan(400);
  });

  it("REQ-231 m11: /assistant SSRs the English composer placeholder, not 'Ej: El cliente quiere una losa…'", async () => {
    const { status, html } = await ssr(s, "/assistant");
    expect(status).toBe(200);
    expect(html).toContain(`placeholder="${EN["asstChat.composer.default"]}"`);
    expect(html).not.toContain(ES["asstChat.composer.default"]);
    expect(html).toContain(`window.__PM_LANG="en"`);
  });

  it("REQ-231 m2: the user's language beats a Spanish pm_lang cookie left by another window", async () => {
    const { status, html } = await ssr(s, "/assistant", "pm_lang=es");
    expect(status).toBe(200);
    expect(html).toContain(`<html lang="en"`);
    expect(html).toContain(`placeholder="${EN["asstChat.composer.default"]}"`);
    expect(html).toContain(`window.__PM_LANG="en"`);
  });

  it("REQ-231 m2: /customers SSRs the topbar with EN pressed, not ES", async () => {
    const { status, html } = await ssr(s, "/customers", "pm_lang=es");
    expect(status).toBe(200);
    expect(html).toContain(`window.__PM_LANG="en"`);
    // preact-render-to-string writes aria-pressed={true} bare, omits false
    expect(html).toMatch(
      /topbar__lang-btn--on" aria-pressed data-cy="topbar-lang-en"/,
    );
    expect(html).toMatch(/class="topbar__lang-btn "\s+data-cy="topbar-lang-es"/);
    expect(html).toContain(`aria-label="${EN["dashTopbar.language"]}"`);
  });

  it("REQ-231: a Spanish user still gets Spanish", async () => {
    const sp = await contractor(
      `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`,
    );
    await sp.put("/me", { name: "Lang Flash ES", language: "es" });
    const { html } = await ssr(sp, "/assistant", "pm_lang=en");
    expect(html).toContain(`placeholder="${ES["asstChat.composer.default"]}"`);
    expect(html).toContain(`window.__PM_LANG="es"`);
  });
});
