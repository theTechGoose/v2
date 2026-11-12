/**
 * REQ-414 — Raphael, 2026-11-12: "fix every issue the demo found, loop until
 * there are none." Demo-loop cycle 2, issue p4: "/login has no language
 * switch".
 *
 * Over HTTP against the dev stack: /login and /verify server-render an
 * EN | ES toggle; with no choice they stay Spanish-first even for an English
 * browser (product decision), the toggle's ?lang= link renders the page in
 * that language and persists it to pm_lang, and the saved cookie is honoured
 * on a plain visit.
 */
const FRONT = process.env.FRONTEND_BASE_URL ?? "http://localhost:5280";
const EN_BROWSER = { "accept-language": "en-US,en;q=0.9" };

async function page(path: string, headers: Record<string, string> = {}) {
  const res = await fetch(`${FRONT}${path}`, { headers, redirect: "manual" });
  return {
    status: res.status,
    setCookie: res.headers.get("set-cookie") ?? "",
    html: await res.text(),
  };
}

/** The toggle link for `lang` — its aria-current and href, or null. */
function toggle(html: string, lang: "en" | "es") {
  const tag = html.match(
    new RegExp(`<a[^>]*data-public-lang="${lang}"[^>]*>`),
  )?.[0];
  if (!tag) return null;
  return {
    current: /aria-current="true"/.test(tag),
    href: tag.match(/href="([^"]*)"/)?.[1]?.replace(/&amp;/g, "&") ?? "",
  };
}

const htmlLang = (html: string) => html.match(/<html[^>]*\blang="([^"]*)"/)?.[1];

describe("REQ-414 (demo p4, cycle 2) /login — EN | ES toggle", () => {
  it("REQ-414 an English browser with no choice gets Spanish, and the toggle offers EN", async () => {
    const r = await page("/login", EN_BROWSER);
    expect(r.status).toBe(200);
    expect(r.html).toContain("Iniciar sesión");
    expect(toggle(r.html, "es")?.current).toBe(true);
    expect(toggle(r.html, "en")?.current).toBe(false);
    expect(toggle(r.html, "en")?.href).toBe("/login?lang=en");
    expect(htmlLang(r.html)).toBe("es");
    expect(r.setCookie).not.toMatch(/pm_lang=/);
  });

  it("REQ-414 the EN link renders English — heading and the form island — and persists pm_lang=en", async () => {
    const r = await page("/login?lang=en", EN_BROWSER);
    expect(r.status).toBe(200);
    expect(r.html).toContain("Welcome back");
    expect(r.html).toContain("Text me a code");
    expect(r.html).not.toContain("Enviar código");
    expect(toggle(r.html, "en")?.current).toBe(true);
    expect(toggle(r.html, "es")?.href).toBe("/login?lang=es");
    expect(htmlLang(r.html)).toBe("en");
    expect(r.setCookie).toMatch(/pm_lang=en/);
  });

  it("REQ-414 a plain visit with the saved choice opens English", async () => {
    const r = await page("/login", { ...EN_BROWSER, cookie: "pm_lang=en" });
    expect(r.html).toContain("Welcome back");
    expect(toggle(r.html, "en")?.current).toBe(true);
  });
});

describe("REQ-414 (demo p4, cycle 2) /verify — EN | ES toggle", () => {
  const PHONE = "%2B15125550100";

  it("REQ-414 the code screen carries the toggle; its links keep the phone", async () => {
    const r = await page(`/verify?phone=${PHONE}&from=login`, EN_BROWSER);
    expect(r.status).toBe(200);
    expect(r.html).toContain("Revisa tu celular");
    expect(toggle(r.html, "es")?.current).toBe(true);
    expect(toggle(r.html, "en")?.href).toBe(
      `/verify?phone=${PHONE}&from=login&lang=en`,
    );
  });

  it("REQ-414 ?lang=en (what /login's form hands on) renders the code screen in English and persists it", async () => {
    const r = await page(`/verify?phone=${PHONE}&lang=en&from=login`, {
      ...EN_BROWSER,
      cookie: "pm_lang=es",
    });
    expect(r.html).toContain("Check your phone");
    expect(toggle(r.html, "en")?.current).toBe(true);
    expect(r.setCookie).toMatch(/pm_lang=en/);
  });
});
