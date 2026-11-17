/**
 * REQ-507 — "fix every issue the demo found, loop until there are none." Demo-loop cycle 3,
 * issue m25 ("/admin search confusing: phone shows 'Nothing matches' while listed; 'abc!!'
 * shows all").
 *
 * In a browser: /admin has ONE search box — the users search, not the topbar's "Search the
 * account" (which searched the staff account's own customers and said "Nothing matches" for a
 * customer the table listed). "abc!!" lists nobody and the empty state names the query; the
 * customer's business name finds her row.
 *
 * Run with SUPERADMIN_BOOTSTRAP_TOKEN set when the serve is a real deploy.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  return { body, cookie, auth: { ...JSON_HEADERS, cookie } };
}

// deno-lint-ignore no-explicit-any
async function useCookie(ctx: any, baseUrl: string, cookie: string) {
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await ctx.clearCookies();
  await ctx.addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
}

async function superAdmin(
  http: StoryTools["http"],
  expect: StoryTools["expect"],
) {
  const phone = `+1843${digits()}`;
  const admin = await verify(http, phone);
  await (await http("/api/me", {
    method: "PUT",
    headers: admin.auth,
    body: JSON.stringify({ language: "en", name: "Hans" }),
  })).body?.cancel();
  const token = Deno.env.get("SUPERADMIN_BOOTSTRAP_TOKEN") ?? "";
  const boot = await http("/api/admin/bootstrap", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, token }),
  });
  expect.eq(boot.status, 200, `bootstrap super admin (${await boot.text()})`);
  return admin;
}

Deno.test("REQ-507 m25: /admin shows no topbar account search; 'abc!!' lists nobody and says so; the business name finds the customer", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const tag = digits();
    const customer = await verify(http, `+1512${tag}`);
    await answerQuestions(http, customer.auth, {
      name: "Deb Kowalski",
      businessName: `Sparkle ${tag}`,
    });
    const admin = await superAdmin(http, expect);
    await useCookie(page.context(), baseUrl, admin.cookie);

    await page.goto("/admin");
    await page.locator("[data-cy='adm-name']").first().waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await page.locator(".topbar .gsearch").count(),
      0,
      "the topbar's account search is not on /admin",
    );

    await page.locator("[data-cy='adm-q']").fill("abc!!");
    await page.locator("[data-cy='adm-search']").click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll("[data-cy='adm-name']").length === 0 &&
        (document.body.textContent ?? "").includes("No users match “abc!!”."),
      undefined,
      { timeout: 15_000 },
    );

    await page.locator("[data-cy='adm-q']").fill(`sparkle ${tag}`);
    await page.locator("[data-cy='adm-search']").click();
    await page.waitForFunction(
      (want) => {
        const names = [...document.querySelectorAll("[data-cy='adm-name']")]
          .map((e) => e.textContent?.trim());
        return names.length === 1 && names[0] === want;
      },
      "Deb Kowalski",
      { timeout: 15_000 },
    );
  }));
