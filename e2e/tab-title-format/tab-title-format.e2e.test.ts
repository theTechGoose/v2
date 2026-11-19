/**
 * REQ-977 (LOOP-007 cycle 1, q1-56) — "Inconsistent browser tab titles". Every
 * signed-in app page's tab reads "<Page> · DocuMonster"; the pages the sidebar
 * names lead with the sidebar's label. The tester saw "Bandeja de salida",
 * "Linda Pérez", "HR · Overview" and "Informes — DocuMonster" in the tab.
 * Here: a Spanish account opens /communications, /messages, /reports, /hr and
 * one customer's page, and the tab title after hydration is read off
 * document.title.
 */
import { story } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

Deno.test("REQ-977 (q1-56): /communications, /messages, /reports, /hr and a customer's page read '<Page> · DocuMonster' in the tab", (t) =>
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
    if (!cookie) throw new Error(`sign-in: no cookie (${JSON.stringify(body)})`);
    const auth = { ...JSON_HEADERS, cookie };
    await (await http("/api/me", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ language: "es", name: "Tab Title Story" }),
    })).body?.cancel();
    const c = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Linda Pérez" }),
    });
    const customer = await c.json();
    if (!c.ok || !customer.id) throw new Error(`customer: ${c.status} ${JSON.stringify(customer)}`);

    const [name, value] = cookie.split("=");
    const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
    await page.context().addCookies([...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "es", domain, path: "/" },
    ]));

    // [path, the labels one of which must lead the title]
    const cases: [string, string[]][] = [
      ["/communications", ["Teléfono · ", "Comunicaciones · "]],
      ["/messages", ["Bandeja de salida · "]],
      ["/reports", ["Informes · "]],
      ["/hr", [""]],
      [`/customers/${customer.id}`, ["Linda Pérez · Clientes · "]],
    ];
    const bad: string[] = [];
    for (const [path, leads] of cases) {
      await page.goto(path);
      await page.waitForLoadState("load");
      await page.waitForTimeout(1_500); // hydration: HtmlLang re-sets the tab title
      const title = await page.evaluate(() => document.title);
      if (!title.endsWith(" · DocuMonster")) bad.push(`${path}: "${title}" lacks " · DocuMonster"`);
      if (/ [—–] /.test(title)) bad.push(`${path}: "${title}" uses a dash separator`);
      if (!leads.some((p) => title.startsWith(p))) {
        bad.push(`${path}: "${title}" should start with ${leads.map((p) => `"${p}"`).join(" or ")}`);
      }
    }
    expect.eq(JSON.stringify(bad, null, 1), "[]", "every tab title has the one format");
  }));
