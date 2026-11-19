/**
 * REQ-1063 (LOOP-007 q2, q2-52) — the customer page's RECURRING KPI honours the repeat visit's end date
 * (REQ-1004). A weekly $85 visit that ends in six weeks (6 visits, $510 left) used to read
 * "RECURRING $368/mo · 1 active · next <date>" as if it ran forever. Now the KPI hint says
 * "· until <end>" ("· hasta el <end>" in Spanish) and the service card says "until <end> ($510 left)".
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const shiftIso = (iso: string, days: number) =>
  new Date(Date.parse(iso + "T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10);
const label = (iso: string, lang: "en" | "es") =>
  new Date(iso + "T12:00:00Z").toLocaleDateString(lang === "es" ? "es-US" : "en-US", { month: "short", day: "numeric", timeZone: "UTC" });

async function signIn(http: StoryTools["http"], page: StoryTools["page"], baseUrl: string) {
  const phone = `+1512${digits()}`;
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
  });
  let body = await r.json();
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    const f = await http("/api/auth/start-fresh", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: body.recoveryToken }),
    });
    body = await f.json();
    cookie = (f.headers.get("set-cookie") ?? "").split(";")[0];
  }
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  await (await http("/api/me", { method: "PUT", headers: auth, body: JSON.stringify({ language: "en", name: "End Date Story" }) })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = [...new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"])];
  const setLang = (lang: "en" | "es") =>
    page.context().addCookies(hosts.map((domain) => ({ name: "pm_lang", value: lang, domain, path: "/" })));
  await page.context().addCookies(hosts.map((domain) => ({ name, value, domain, path: "/" })));
  await setLang("en");
  return { auth, setLang };
}

Deno.test("REQ-1063 (LOOP-007 q2, q2-52): a weekly $85 repeat visit that ends in six weeks — the RECURRING KPI says 'until <end>' (EN and ES) and the service card says '($510 left)'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth, setLang } = await signIn(http, page, baseUrl);
    const call = async (method: string, url: string, body?: unknown) => {
      const r = await http(url, { method, headers: auth, ...(body ? { body: JSON.stringify(body) } : {}) });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(json)}`);
      return json;
    };
    const today = new Date().toISOString().slice(0, 10);
    const first = shiftIso(today, 1);
    const end = shiftIso(today, 41); // visits first, +7 … +35 → 6 left; +42 is past the end
    const sam = await call("POST", "/api/customers", { name: `Seasonal Sam ${digits()}` });
    const sub = await call("POST", "/api/field/subscriptions", {
      customerId: sam.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      cadence: "weekly",
      days: [new Date(first + "T00:00:00Z").getUTCDay()],
      startDate: first,
      endDate: end,
      items: [{ taskTypeName: "Lawn cut", priceCents: 8500 }],
    });
    expect.eq(sub.endDate, end, "the repeat visit is stored with its end date");

    await page.goto(`/customers/${sam.id}`);
    const kpi = page.locator("[data-cy='cws-recurring']");
    await kpi.waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector("[data-cy='cws-recurring']")?.textContent?.includes("/mo") === true, undefined, { timeout: 20_000 });
    const en = (await kpi.textContent()) ?? "";
    expect(en.includes("$368"), `the /mo rate stays (got "${en}")`);
    expect(en.includes(`until ${label(end, "en")}`), `the RECURRING KPI says when it ends: 'until ${label(end, "en")}' (got "${en}")`);

    await page.locator("[data-cy='cws-tab-recurring']").click();
    const card = page.locator(`[data-cy='cws-service'][data-id='${sub.id}']`);
    await card.waitFor({ timeout: 20_000 });
    const price = (await card.locator(".cws-svc__price").textContent()) ?? "";
    expect(price.includes(`until ${label(end, "en")}`) && price.includes("$510 left"), `the card's price line says 'until ${label(end, "en")} ($510 left)' (got "${price}")`);

    await (await http("/api/me", { method: "PUT", headers: auth, body: JSON.stringify({ language: "es" }) })).body?.cancel();
    await setLang("es");
    await page.goto(`/customers/${sam.id}?lang=es`);
    await kpi.waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => document.querySelector("[data-cy='cws-recurring']")?.textContent?.includes("/mes") === true, undefined, { timeout: 20_000 });
    const es = (await kpi.textContent()) ?? "";
    expect(es.includes(`hasta el ${label(end, "es")}`), `the Spanish KPI says 'hasta el ${label(end, "es")}' (got "${es}")`);
  }));
