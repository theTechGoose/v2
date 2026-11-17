/**
 * REQ-863 (demo-loop cycle dm4, issue p5) — "Presenter's demo pill on his other pages opens in the
 * customer's language (ES) while the stage is EN". Hans's PROFILE is Spanish (a new account is born
 * es, REQ-590) and he works on /admin?lang=en, so REQ-829 gives him an English stage. A fresh second
 * tab of his (/dashboard — Maria's page — with no ?lang=) used to rank his es profile: "Modo demo ·
 * Guiando a Maria Lopez", and /admin's guide gate in Spanish. The stage now records the demo's live
 * presenter language (pm_demo_lang) and both rank it before the profile.
 */
import { story, type StoryTools } from "#shots";

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

/** the browser carries Hans's session only — no pm_lang: his language is his profile's */
// deno-lint-ignore no-explicit-any
async function useSession(ctx: any, baseUrl: string, cookie: string) {
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await ctx.clearCookies();
  await ctx.addCookies(
    [...hosts].map((domain) => ({ name, value, domain, path: "/" })),
  );
}

async function profile(
  http: StoryTools["http"],
  auth: Record<string, string>,
  name: string,
  language: "en" | "es",
) {
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language, name }),
  })).body?.cancel();
}

Deno.test("REQ-863 (cycle dm4, p5): an es-profile presenter who started from /admin?lang=en opens a fresh /dashboard tab — an English pill (Demo mode · Guiding Maria Lopez) and an English /admin gate", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const hansPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await profile(http, user.auth, "Maria Lopez", "es");
    const hans = await verify(http, hansPhone);
    await profile(http, hans.auth, "Hans", "es");
    const token = Deno.env.get("SUPERADMIN_BOOTSTRAP_TOKEN") ?? "";
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: hansPhone, token }),
    });
    expect.eq(boot.status, 200, `Hans is a super admin (${await boot.text()})`);

    await useSession(page.context(), baseUrl, hans.cookie);
    await page.goto(`${baseUrl}/admin?lang=en`);
    await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
    await page.locator("[data-cy='adm-search']").click();
    await page.locator("[data-cy='adm-demo']").first().waitFor({
      timeout: 15_000,
    });
    const demoBtn = await page.locator("[data-cy='adm-demo']").first()
      .boundingBox();
    if (!demoBtn) throw new Error("no Demo button on /admin");
    await page.mouse.click(
      demoBtn.x + demoBtn.width / 2,
      demoBtn.y + demoBtn.height / 2,
    );
    await page.waitForURL((u) => u.pathname === "/demo/stage", {
      timeout: 20_000,
    });
    await page.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
    await page.waitForLoadState("load");
    expect.eq(
      await page.evaluate(() => document.documentElement.lang),
      "en",
      "REQ-829: the stage is English",
    );

    // a FRESH second tab of the same browser: Maria's /dashboard, no ?lang=
    const tab = await page.context().newPage();
    await tab.setViewportSize({ width: 1280, height: 800 });
    await tab.goto(`${baseUrl}/dashboard`);
    await tab.locator("[data-cy='demo-rejoin']").waitFor({ timeout: 20_000 });
    await tab.waitForLoadState("load");
    await tab.waitForTimeout(2_000); // whoami / active answered
    const pill = await tab.locator("[data-cy='demo-pill']").innerText();
    expect(
      pill.includes("Demo mode") && pill.includes("Guiding Maria Lopez") &&
        pill.includes("Back to the demo"),
      `p5: the pill follows the demo's English, not Hans's es profile ("${pill}")`,
    );
    expect(
      !/Modo demo|Guiando|Volver a la demo/.test(pill),
      `p5: no Spanish in Hans's pill ("${pill}")`,
    );

    // and /admin's guide gate in that tab
    await tab.goto(`${baseUrl}/admin`);
    await tab.locator("[data-cy='admin-gate']").waitFor({ timeout: 15_000 });
    const gate = await tab.locator("[data-cy='admin-gate']").innerText();
    expect(
      gate.includes("You are guiding Maria Lopez in this browser"),
      `p5: the gate is English ("${gate.slice(0, 300)}")`,
    );
    await tab.close();

    // tidy: end the demo from the stage
    await page.locator("[data-cy='demo-end']").click();
    await page.locator("[data-cy='demo-end-confirm']").click();
    await page.waitForURL((u) => u.pathname === "/admin", { timeout: 20_000 });
  }));
