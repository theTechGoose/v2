/**
 * REQ-135 — "we need to paginate this information via the api cause customers take a long time to
 * load now and its affecting other pages too."
 * The page: /customers (front-end/routes/clients/index.tsx → islands/ClientsPage.tsx + ClientsBoard.tsx),
 * reading one page at a time from GET /api/clients.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(http: StoryTools["http"], page: StoryTools["page"], baseUrl: string) {
  const phone = `+1512${digits()}`;
  const r = await http("/api/auth/verify", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ phoneNumber: phone, code: "000000" }) });
  let body = await r.json();
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    const f = await http("/api/auth/start-fresh", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ token: body.recoveryToken }) });
    body = await f.json();
    cookie = (f.headers.get("set-cookie") ?? "").split(";")[0];
  }
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", { method: "PUT", headers: auth, body: JSON.stringify({ language: "en", name: "Pager Story" }) });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [{ name, value, domain, path: "/" }, { name: "pm_lang", value: "en", domain, path: "/" }]));
  return { auth };
}

Deno.test("REQ-135: thirty customers — the page shows twenty-five, says Page 1 of 2, next shows five, a search shows one, the crumb counts thirty", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    for (let i = 1; i <= 30; i++) {
      const r = await http("/api/customers", { method: "POST", headers: auth, body: JSON.stringify({ name: `Client ${String(i).padStart(2, "0")}`, email: `client${i}@blackhole.postmarkapp.com` }) });
      await r.body?.cancel();
    }
    await page.goto("/customers");
    await expect.see("30 on the books");
    await expect.see("Page 1 of 2");
    const cards = page.locator(".ccard2");
    await page.locator("[data-cy='clients-next']").waitFor();
    expect((await cards.count()) === 25, `twenty-five cards on page one (${await cards.count()})`);
    await expect.see("Client 01");
    await page.locator("[data-cy='clients-next']").click();
    await expect.see("Page 2 of 2");
    await expect.see("Client 30");
    expect((await cards.count()) === 5, `five cards on page two (${await cards.count()})`);
    await page.locator("[data-cy='clients-search']").fill("client 07");
    await expect.see("Page 1 of 1");
    await expect.see("Client 07");
    expect((await cards.count()) === 1, `one card for the search (${await cards.count()})`);
    await expect.see("30 on the books");
  }));
