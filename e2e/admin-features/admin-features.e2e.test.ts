/**
 * REQ-177 — "put the texting feature behind a feature flag on the account. add a tab called
 * 'accounts' this way we can enable and disable features per account."
 * Run with SUPERADMIN_BOOTSTRAP_TOKEN set (shots' serve is stamped DENO_DEPLOY=true, so the
 * bootstrap route wants the token).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Rafa Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: "en",
      domain,
      path: "/",
    }]),
  );
  return { auth, phone };
}

Deno.test("REQ-177: the super admin opens /admin → Accounts, switches Field texts on for an account; it stays on after a reload and the API agrees", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth, phone } = await signIn(http, page, baseUrl);
    const token = Deno.env.get("SUPERADMIN_BOOTSTRAP_TOKEN") ?? "";
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ phoneNumber: phone, token }),
    });
    expect.eq(boot.status, 200, `bootstrap super admin (${await boot.text()})`);
    // the account whose feature gets switched
    const other = `+1512${digits()}`;
    const o = await http("/api/auth/verify", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: other, code: "000000" }),
    });
    const oCookie = (o.headers.get("set-cookie") ?? "").split(";")[0];
    await (await http("/api/me", {
      method: "PUT",
      headers: { ...JSON_HEADERS, cookie: oCookie },
      body: JSON.stringify({ language: "en", name: "Alex Account" }),
    })).body?.cancel();
    const otherId =
      ((await (await http(`/api/admin/users?q=${other.slice(2)}`, {
        headers: auth,
      })).json()) as { id: string }[])[0].id;

    await page.goto("/admin");
    // REQ-191 — the role a person reads: the tab is "Admin", the lead says "admin", never "super"
    const tab = page.locator("a.nav-item[href='/admin'] .nav-item__label");
    await tab.waitFor({ timeout: 15_000 });
    expect.eq(
      (await tab.textContent())?.trim(),
      "Admin",
      "the sidebar tab reads Admin",
    );
    const lead =
      (await page.locator("h1:has-text('Admin') + p").textContent()) ?? "";
    expect(
      lead.includes("grant or revoke admin,"),
      `the lead says admin (${lead})`,
    );
    expect(!/super/i.test(lead), "the lead never says super");
    await page.locator("[data-cy='adm-tab-accounts']").click();
    const row = page.locator(`[data-cy='adm-account'][data-user='${otherId}']`);
    await row.waitFor({ timeout: 15_000 });
    const sw = row.locator("[data-cy='adm-feature-fieldTexts']");
    expect.eq(await sw.isChecked(), false, "off by default");
    await sw.click();
    await page.waitForFunction(
      (id: string) =>
        (document.querySelector(
          `[data-cy='adm-account'][data-user='${id}'] [data-cy='adm-feature-fieldTexts']`,
        ) as HTMLInputElement | null)?.checked === true,
      otherId,
      { timeout: 15_000 },
    );
    await page.reload();
    await page.locator("[data-cy='adm-tab-accounts']").click();
    await row.waitFor({ timeout: 15_000 });
    expect.eq(
      await row.locator("[data-cy='adm-feature-fieldTexts']").isChecked(),
      true,
      "still on after a reload",
    );
    const api = (await (await http(`/api/admin/users?q=${other.slice(2)}`, {
      headers: auth,
    })).json()) as { features?: Record<string, boolean> }[];
    expect.eq(api[0].features?.fieldTexts, true, "the API agrees");
  }));
