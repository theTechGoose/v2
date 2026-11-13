/**
 * REQ-709 — demo-loop cycle 5, issue m4: "Tab title in the other language".
 * An account whose language is "es" opened an app page with ?lang=en: the page
 * painted English (html lang="en") under the tab title "Panel · DocuMonster"
 * (fleet-6 stdout:257). The route built its DocTitle from user.language alone
 * and HtmlLang only followed a later switch. Here: /quotes?lang=en and
 * /invoices?lang=en for an es account — the server's <title> and the tab title
 * after hydration are English; without ?lang= they stay Spanish.
 */
import { story } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

Deno.test("REQ-709 (m4): an es account on /quotes?lang=en and /invoices?lang=en gets an English tab title", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const phone = `+1512${digits()}`;
    let r = await http("/api/auth/verify", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
    });
    let body = await r.json();
    let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
    if (body.recoverable === true) {
      r = await http("/api/auth/start-fresh", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ token: body.recoveryToken }),
      });
      body = await r.json();
      cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
    }
    if (!cookie) {
      throw new Error(`sign-in: no cookie (${JSON.stringify(body)})`);
    }
    await (await http("/api/me", {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie },
      body: JSON.stringify({ language: "es" }),
    })).body?.cancel();
    const [name, value] = cookie.split("=");
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies([...hosts].map((domain) => ({
      name,
      value,
      domain,
      path: "/",
    })));

    const cases: [string, string, string][] = [
      ["/quotes?lang=en", "Quotes · DocuMonster", "en"],
      ["/invoices?lang=en", "Invoices · DocuMonster", "en"],
      ["/quotes", "Cotizaciones · DocuMonster", "es"],
    ];
    for (const [path, title, lang] of cases) {
      const res = await page.goto(path);
      const html = (await res?.text()) ?? "";
      const ssr = html.match(/<title[^>]*>([^<]*)<\/title>/)?.[1] ?? "";
      expect.eq(ssr, title, `${path}: the server's <title>`);
      await page.waitForTimeout(1_500); // hydration + the dash cache's profile read
      expect.eq(await page.title(), title, `${path}: tab title after load`);
      expect.eq(
        await page.evaluate(() => document.documentElement.lang),
        lang,
        `${path}: <html lang>`,
      );
    }
  }));
