/**
 * REQ-1077 — LOOP-007 cycle 2, issue q2-67 (AMENDMENT of REQ-530): add two
 * customers, delete one, open /customers — the hero called the one left
 * "Your first customer" ("Tu primer cliente"), though it is not the first.
 * The count is of current customers, so the singular headline must make no
 * ordinal claim: "You have one customer on your list." /
 * "Tienes un cliente en tu lista."
 *
 * Page: /customers (islands/ClientsPage.tsx → components/ClientsSections.tsx).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

async function signInAddTwoDeleteOne(
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
    body: JSON.stringify({ name: "Hero Delete Story", language: lang }),
  });
  await me.body?.cancel();
  const ids: string[] = [];
  for (
    const [name, phoneNumber] of [
      ["Ana First", "(512) 555-0141"],
      ["Ben Second", "(512) 555-0142"],
    ]
  ) {
    const c = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name, phoneNumber }),
    });
    if (!c.ok) {
      throw new Error(`create customer: ${c.status} ${await c.text()}`);
    }
    ids.push((await c.json()).id);
  }
  const d = await http(`/api/customers/${ids[0]}`, {
    method: "DELETE",
    headers: auth,
  });
  if (!d.ok) throw new Error(`delete customer: ${d.status} ${await d.text()}`);
  await d.body?.cancel();
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
    want: "You have one customer on your list.",
    bad: /first/i,
  },
  {
    lang: "es",
    want: "Tienes un cliente en tu lista.",
    bad: /primer/i,
  },
] as const;

for (const { lang, want, bad } of CASES) {
  Deno.test(`REQ-1077 (LOOP-007 q2-67): /customers in ${lang} after adding two customers and deleting one — the hero reads "${want}", never "first"`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      await signInAddTwoDeleteOne(http, page, baseUrl, lang);
      await page.goto("/customers");
      const h1 = page.locator("h1.ph2__title");
      await h1.waitFor();
      const text = (await h1.innerText()).replace(/\s+/g, " ").trim();
      expect(!bad.test(text), `no ordinal "first" — got "${text}"`);
      expect(text === want, `the hero reads "${want}" — got "${text}"`);
    }));
}
