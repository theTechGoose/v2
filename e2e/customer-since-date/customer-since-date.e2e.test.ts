/**
 * REQ-1042 (LOOP-007 cycle 2, q2-26) — on a customer's page, the Details card's "Customer since"
 * reads like every other date in the app: "Nov 19, 2026" in English (with its comma), "19 nov 2026"
 * in Spanish. The bug: the island glued the raw ISO year onto "Nov 19" → "Nov 19 2026".
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Since Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
  return auth;
}

/** The Details card's "Customer since" value, read in one evaluate (label + value together). */
const sinceText = (page: StoryTools["page"], label: string) =>
  page.evaluate((label) => {
    const dts = [...document.querySelectorAll(".cws-info dl dt")];
    const dt = dts.find((d) => d.textContent?.trim() === label);
    return dt?.nextElementSibling?.textContent?.trim() ?? null;
  }, label);

Deno.test("REQ-1042: a customer's Details card reads 'Customer since Nov 19, 2026' — the whole date formatted, comma included (es '19 nov 2026')", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const r = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: `Ana Since ${digits()}` }),
    });
    const ana = await r.json();
    if (!r.ok) throw new Error(`/api/customers → ${r.status} ${JSON.stringify(ana)}`);
    const created = new Date(ana.createdAt ?? Date.now());
    const want = (locale: string) =>
      created.toLocaleDateString(locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

    // English
    await page.goto(`/customers/${ana.id}?lang=en`);
    await page.locator(`[data-cy='customer-workspace'][data-customer='${ana.id}'] .cws-info dl`).waitFor({ timeout: 20_000 });
    const en = await sinceText(page, "Customer since");
    expect(en !== null, "the Details card has a 'Customer since' row");
    expect(/^[A-Z][a-z]{2} \d{1,2}, \d{4}$/.test(en ?? ""), `'Customer since' reads 'Mon D, YYYY' (got "${en}")`);
    expect.eq(en, want("en-US"), "the date is the customer's creation day, formatted whole");

    // Spanish keeps its own form
    await page.goto(`/customers/${ana.id}?lang=es`);
    await page.locator(`[data-cy='customer-workspace'][data-customer='${ana.id}'] .cws-info dl`).waitFor({ timeout: 20_000 });
    await page.waitForFunction(
      () => [...document.querySelectorAll(".cws-info dl dt")].some((d) => d.textContent?.trim() === "Cliente desde"),
      undefined,
      { timeout: 15_000 },
    );
    const es = await sinceText(page, "Cliente desde");
    expect.eq(es, want("es-US"), "Spanish reads '19 nov 2026'");
  }));
