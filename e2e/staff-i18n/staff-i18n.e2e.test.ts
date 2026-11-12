/**
 * REQ-269 (demo issue i18n-formatting-m2) — "Staff side is half English in
 * Spanish mode": a Spanish super admin's /admin body, its footer after the
 * topbar's EN/ES toggle, and the impersonation bar all follow the app
 * language. Run with SUPERADMIN_BOOTSTRAP_TOKEN set (shots' serve is stamped
 * DENO_DEPLOY=true, so the bootstrap route wants the token).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

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
    body: JSON.stringify({ language: "es", name: "Alex Staff" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: "es",
      domain,
      path: "/",
    }]),
  );
  return { auth, phone };
}

const text = (page: StoryTools["page"], sel: string) =>
  page.evaluate(
    (s: string) => document.querySelector(s)?.textContent?.trim() ?? "",
    sel,
  );

Deno.test("REQ-269: a Spanish staff member's /admin is Spanish end to end; EN flips the body AND the footer; the impersonation bar speaks the app language", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth, phone } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, {
      name: "Alex Staff",
      businessName: "Staff Co",
    });
    const token = Deno.env.get("SUPERADMIN_BOOTSTRAP_TOKEN") ?? "";
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ phoneNumber: phone, token }),
    });
    expect.eq(boot.status, 200, `bootstrap super admin (${await boot.text()})`);
    // the account to impersonate: Spanish
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
      body: JSON.stringify({ language: "es", name: "Beto Cliente" }),
    })).body?.cancel();
    const otherId =
      ((await (await http(`/api/admin/users?q=${other.slice(2)}`, {
        headers: auth,
      })).json()) as { id: string }[])[0].id;

    await page.setViewportSize({ width: 1400, height: 900 });
    await page.goto("/admin");
    await page.locator("[data-cy='topbar-lang-en']").waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='adm-q']").waitFor({ timeout: 15_000 });
    // Spanish: the lead, the tabs, the search, the footer
    const leadEs = await text(page, "h1 + p");
    expect(leadEs.startsWith("Busca usuarios"), `Spanish lead (${leadEs})`);
    expect.eq(
      await text(page, "[data-cy='adm-tab-users']"),
      "Usuarios",
      "Users tab in Spanish",
    );
    expect.eq(
      await text(page, "[data-cy='adm-search']"),
      "Buscar",
      "Search button in Spanish",
    );
    const ph = await page.locator("[data-cy='adm-q']").getAttribute(
      "placeholder",
    );
    expect(ph?.startsWith("Buscar por nombre"), `placeholder (${ph})`);
    expect.eq(
      await text(page, "[data-legal-link='terms']"),
      "Términos de servicio",
      "footer in Spanish",
    );

    // EN in the topbar: the body AND the footer follow at once, no reload
    await page.locator("[data-cy='topbar-lang-en']").click();
    await page.waitForFunction(
      () =>
        document.querySelector("[data-legal-link='terms']")?.textContent
          ?.trim() === "Terms of Service",
      undefined,
      { timeout: 10_000 },
    );
    const leadEn = await text(page, "h1 + p");
    expect(
      leadEn.startsWith("Search users, grant or revoke admin"),
      `English lead after EN (${leadEn})`,
    );
    expect.eq(
      await text(page, "[data-cy='adm-search']"),
      "Search",
      "Search button in English",
    );

    // back to ES, then impersonate the Spanish account: the bar is Spanish
    await page.locator("[data-cy='topbar-lang-es']").click();
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='adm-search']")?.textContent
          ?.trim() === "Buscar",
      undefined,
      { timeout: 10_000 },
    );
    const status = await page.evaluate(
      async (id: string) =>
        (await fetch(`/api/admin/impersonate/${id}`, { method: "POST" }))
          .status,
      otherId,
    );
    expect.eq(status, 200, "impersonation started");
    await page.goto("/dashboard");
    const banner = page.locator("[data-cy='imp-banner']");
    await banner.waitFor({ timeout: 15_000 });
    const bar = (await banner.textContent()) ?? "";
    expect(bar.includes("Suplantando"), `Spanish bar (${bar})`);
    expect(bar.includes("Beto Cliente"), `names the account (${bar})`);
    expect(bar.includes("Volver a tu cuenta"), `Spanish return (${bar})`);
    expect(!/Impersonating|Return to your account/.test(bar), bar);

    await page.evaluate(async () => {
      await fetch("/api/admin/stop-impersonating", { method: "POST" });
    });
  }));
