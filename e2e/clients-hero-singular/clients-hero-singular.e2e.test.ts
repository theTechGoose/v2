/**
 * REQ-530 — demo-loop cycle 3, issue p7: with one customer on the books the
 * /customers hero read "The person / you work for." (es "La persona / para la
 * que trabajas.") — a boss, not a customer. It now reads "Your first customer
 * / is on your list." (es "Tu primer cliente / ya está en tu lista.").
 *
 * Page: /customers (islands/ClientsPage.tsx → components/ClientsSections.tsx).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

async function signInWithOneCustomer(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: "en" | "es",
) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ name: "Hero Story", language: lang }),
  });
  await me.body?.cancel();
  const c = await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Dana Fictional",
      phoneNumber: "(512) 555-0123",
    }),
  });
  if (!c.ok) throw new Error(`create customer: ${c.status} ${await c.text()}`);
  await c.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: lang, domain, path: "/" },
    ]),
  );
}

const CASES = [
  {
    lang: "en",
    want: "Your first customer is on your list.",
    bad: /person|work for/i,
  },
  {
    lang: "es",
    want: "Tu primer cliente ya está en tu lista.",
    bad: /persona|trabajas/i,
  },
] as const;

for (const { lang, want, bad } of CASES) {
  Deno.test(`REQ-530 (demo p7, cycle 3): /customers in ${lang} with one customer — the hero reads "${want}"`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      await signInWithOneCustomer(http, page, baseUrl, lang);
      await page.goto("/customers");
      const h1 = page.locator("h1.ph2__title");
      await h1.waitFor();
      const text = (await h1.innerText()).replace(/\s+/g, " ").trim();
      expect(text === want, `the hero reads "${want}" — got "${text}"`);
      expect(!bad.test(text), `no boss wording — got "${text}"`);
    }));
}
