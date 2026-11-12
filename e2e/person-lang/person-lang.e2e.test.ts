/**
 * REQ-631 — "Language is per person." On the real shell: an English owner (A2Z Landscape) has an
 * editor; she flips the topbar to Español — her dashboard is Spanish (SSR and islands), her own
 * record holds "es", while the owner's next sign-in on the same browser is still English and what
 * the business shows its customers (the public invoice page, the business's customer language) is
 * unchanged.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

/** a phone's OTP sign-in through the proxy (the dev code), as the login page does */
async function verify(http: StoryTools["http"], phone: string) {
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
  return { body, cookie, auth: { ...JSON_HEADERS, cookie } };
}

/** the browser takes this session — every other cookie dropped; `lang` sets pm_lang when given */
async function useCookie(page: StoryTools["page"], baseUrl: string, cookie: string, lang?: "en" | "es") {
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().clearCookies();
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      ...(lang ? [{ name: "pm_lang", value: lang, domain, path: "/" }] : []),
    ]),
  );
}

/** the public invoice page as a customer gets it: no cookie at all */
async function customerView(http: StoryTools["http"], id: string) {
  const r = await http(`/i/${id}`);
  const html = await r.text();
  return { status: r.status, lang: /<html[^>]*\blang="(\w+)"/.exec(html)?.[1], title: /<title>([^<]*)<\/title>/.exec(html)?.[1] };
}

Deno.test("REQ-631: the editor switches to Español — her dashboard is Spanish; the owner's next sign-in is still English; the customer's invoice page and the business's customer language are unchanged", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    // the owner, in English, past onboarding, with a customer and an invoice
    const o = await verify(http, `+1512${digits()}`);
    const lang = await http("/api/me", { method: "PUT", headers: o.auth, body: JSON.stringify({ language: "en" }) });
    await lang.body?.cancel();
    await answerQuestions(http, o.auth, { name: "Alexander Jerez", businessName: "A2Z Landscape LLC" });
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: o.auth,
      body: JSON.stringify({ name: "Randall Belknap", email: "rb@blackhole.postmarkapp.com" }),
    })).json();
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: o.auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "draft",
        jobName: "October maintenance",
        lineItems: [{ description: "Lawn", quantity: 1, unit: "visit", price: 6500 }],
        amount: 6500,
      }),
    })).json();
    const commsBefore = (await (await http("/api/profile/identity", { headers: o.auth })).json()).commsLanguage;
    const customerBefore = await customerView(http, inv.id);
    expect.eq(customerBefore.status, 200, "the customer's invoice page opens");

    // the editor, invited by name
    const herPhone = `+1843${digits()}`;
    const invited = await http("/api/me/admins", {
      method: "POST",
      headers: o.auth,
      body: JSON.stringify({ phoneNumber: herPhone.slice(2), name: "Daughter Test" }),
    });
    expect.eq(invited.status, 201, "invited");
    await invited.body?.cancel();
    const her = await verify(http, herPhone);
    // she starts in English too (the dev-code sign-in sends no page language; a new person is "es")
    const herEn = await http("/api/me", { method: "PUT", headers: her.auth, body: JSON.stringify({ language: "en" }) });
    expect.eq((await herEn.json()).actor?.language, "en", "her own language: English to start");
    await useCookie(page, baseUrl, her.cookie, "en");
    await page.goto("/dashboard");
    const greet = page.locator("[data-cy='topbar-greeting']");
    await greet.waitFor({ timeout: 20_000 });
    await page.locator("[data-cy='topbar-greeting']", { hasText: "Hey, Daughter" }).waitFor({ timeout: 20_000 });

    // she flips to Español
    await page.locator("[data-cy='topbar-lang-es']").click();
    await page.locator("[data-cy='topbar-greeting']", { hasText: "Hola, Daughter" }).waitFor({ timeout: 15_000 });
    let saved: string | undefined;
    for (let i = 0; i < 30 && saved !== "es"; i++) {
      await page.waitForTimeout(300);
      saved = (await (await http("/api/me", { headers: her.auth })).json()).actor?.language;
    }
    expect.eq(saved, "es", "her own record holds Spanish");
    const ownerMe = await (await http("/api/me", { headers: o.auth })).json();
    expect.eq(ownerMe.language, "en", "the owner's language is untouched");

    // her dashboard, reloaded: Spanish from the server render on
    const ssr = await http("/dashboard", { headers: { cookie: her.cookie } });
    const ssrHtml = await ssr.text();
    expect(ssrHtml.includes("<title>Panel ·"), "her dashboard is rendered in Spanish by the server (no pm_lang cookie sent)");
    await page.goto("/dashboard");
    await page.locator("[data-cy='topbar-greeting']", { hasText: "Hola, Daughter" }).waitFor({ timeout: 20_000 });
    expect.eq(await page.locator("html").getAttribute("lang"), "es", "<html lang> is hers");
    await expect.see("Hola, Daughter");

    // the owner signs in on the same browser (it last spoke Spanish): English
    await useCookie(page, baseUrl, o.cookie);
    const ownerSsr = await (await http("/dashboard", { headers: { cookie: o.cookie } })).text();
    expect(ownerSsr.includes("<title>Dashboard ·"), "the owner's dashboard is rendered in English by the server");
    await page.goto("/dashboard");
    await page.locator("[data-cy='topbar-greeting']", { hasText: "Hey, Alexander" }).waitFor({ timeout: 20_000 });
    await page.waitForFunction(() => document.documentElement.lang === "en", undefined, { timeout: 15_000 });
    await expect.see("Hey, Alexander");

    // what the business sends its customers did not move
    const customerAfter = await customerView(http, inv.id);
    expect.eq(customerAfter.lang, customerBefore.lang, "the customer's invoice page language is unchanged");
    expect.eq(customerAfter.title, customerBefore.title, "and its words");
    const commsAfter = (await (await http("/api/profile/identity", { headers: o.auth })).json()).commsLanguage;
    expect.eq(commsAfter, commsBefore, "the business's customer language is unchanged");
  }));
