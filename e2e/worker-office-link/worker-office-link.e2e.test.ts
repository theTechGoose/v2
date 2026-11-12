/**
 * REQ-282 — demo issue customers-payments-fieldops-m2: "Worker view (/worker)
 * has no way back to the office app". An owner who opens the worker view from
 * the office sidebar finds a "Back to office" link in its header that lands on
 * /field/tasks; a phone with no owner session (a worker's) does not see it.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

async function signInOwner(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
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
  const me = await http("/api/me", {
    method: "PUT",
    headers: { ...JSON_HEADERS, cookie },
    body: JSON.stringify({ language: "en", name: "Office Owner" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      // the page's language is the pm_lang cookie, as on every field story
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
}

Deno.test("REQ-282: the owner's worker view has a Back to office link that lands on /field/tasks", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signInOwner(http, page, baseUrl);
    await page.goto("/worker?lang=en");
    const back = page.locator("[data-cy='w-office']");
    await back.waitFor({ timeout: 15_000 });
    await expect.see("Back to office");
    await back.click();
    await page.waitForURL(/\/field\/tasks/, { timeout: 15_000 });
    expect(
      new URL(page.url()).pathname === "/field/tasks",
      `landed on ${page.url()}`,
    );
  }));

Deno.test("REQ-282: a worker's phone (no owner session) shows no office link", (t) =>
  story(t, async ({ page, expect }) => {
    await page.goto("/worker?lang=en");
    await page.locator(".top .brand").waitFor({ timeout: 15_000 });
    expect.eq(
      await page.locator("[data-cy='w-office']").count(),
      0,
      "no office link without an owner session",
    );
  }));
