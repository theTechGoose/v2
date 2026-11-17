/**
 * REQ-537 (demo-loop cycle 4, issue m36) — the stage has one exit. The presenter's browser on
 * /demo/stage is an impersonation session, and the red "Impersonating … · Return to your account"
 * bar sat above the stage next to the pill's End demo: two exits. The bar is gone from the stage
 * (every other page keeps it); with more than one presenter the pill offers "Leave the demo".
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

async function setName(
  http: StoryTools["http"],
  auth: Record<string, string>,
  name: string,
) {
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name }),
  })).body?.cancel();
}

async function bootstrap(http: StoryTools["http"], phone: string) {
  const r = await http("/api/admin/bootstrap", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone }),
  });
  await r.body?.cancel();
  return r.status;
}

Deno.test("REQ-537 (cycle 4, m36): the stage has one exit — no impersonation banner (no 'Return to your account') on /demo/stage, the stage reaches the top of the window; alone, the pill has End and no Leave; with a second presenter both pills offer Leave the demo; Lia leaves — she is back on /admin as herself, the demo goes on with Hans, whose Leave goes away", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const hansPhone = `+1843${digits()}`;
    const liaPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await setName(http, user.auth, "Ana Torres");
    const hans = await verify(http, hansPhone);
    await setName(http, hans.auth, "Hans");
    const lia = await verify(http, liaPhone);
    await setName(http, lia.auth, "Lia");
    expect.eq(await bootstrap(http, hansPhone), 200, "Hans is a super admin");
    expect.eq(await bootstrap(http, liaPhone), 200, "Lia is a super admin too");

    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 420, height: 800 },
    });
    const liaCtx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    try {
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await userPage.goto(`${baseUrl}/dashboard`);

      const openDemo = async (pg: typeof page) => {
        await pg.goto(`${baseUrl}/admin`);
        await pg.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
        await pg.locator("[data-cy='adm-search']").click();
        await pg.locator("[data-cy='adm-demo']").first().waitFor({
          timeout: 15_000,
        });
        await pg.locator("[data-cy='adm-demo']").first().click();
        await pg.waitForURL((u) => u.pathname === "/demo/stage", {
          timeout: 20_000,
        });
        await pg.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
      };
      const live = (pg: typeof page) =>
        pg.locator("[data-cy='demo-status']").filter({
          hasText: /^\s*Live\s*$/,
        }).waitFor({ timeout: 20_000 });

      // 1. Hans alone on the stage: End is the one exit, no banner, no Leave
      await useCookie(page.context(), baseUrl, hans.cookie);
      await openDemo(page);
      await userPage.reload();
      await live(page);
      // the banner mounts after its whoami answers: give it the time it would take
      await page.waitForTimeout(1_500);
      expect.eq(
        await page.locator("[data-cy='imp-banner']").count(),
        0,
        "no impersonation banner on the stage",
      );
      expect.eq(
        await page.getByText("Return to your account").count(),
        0,
        "no 'Return to your account' on the stage",
      );
      expect.eq(
        await page.locator("[data-cy='demo-end']").count(),
        1,
        "the pill's End is there",
      );
      expect.eq(
        await page.locator("[data-cy='demo-leave']").count(),
        0,
        "alone: no Leave next to End",
      );
      const padTop = await page.evaluate(() =>
        getComputedStyle(document.body).paddingTop
      );
      expect.eq(padTop, "0px", "no room kept for a banner that is not there");

      // 2. Lia joins: both stages offer Leave the demo
      const liaPage = await liaCtx.newPage();
      await useCookie(liaCtx, baseUrl, lia.cookie);
      await openDemo(liaPage);
      await live(liaPage);
      await liaPage.locator("[data-cy='demo-leave']").waitFor({
        timeout: 15_000,
      });
      await page.locator("[data-cy='demo-leave']").waitFor({ timeout: 15_000 });
      expect.eq(
        (await liaPage.locator("[data-cy='demo-leave']").textContent() ?? "")
          .trim(),
        "Leave the demo",
        "the secondary action says what it does",
      );
      expect.eq(
        await liaPage.locator("[data-cy='imp-banner']").count(),
        0,
        "no impersonation banner on Lia's stage either",
      );

      // 3. Lia leaves: /admin as herself, the demo goes on with Hans alone
      await liaPage.locator("[data-cy='demo-leave']").click();
      await liaPage.waitForURL((u) => u.pathname === "/admin", {
        timeout: 20_000,
      });
      const liaWho = await http("/api/admin/whoami", { headers: lia.auth });
      expect.eq(
        (await liaWho.json()).impersonating,
        false,
        "Lia has her own account back",
      );
      const active = await http("/api/demo-mode/active", {
        headers: user.auth,
      });
      const a = await active.json();
      expect(a.session !== null, "the demo goes on for Ana");
      expect.eq(a.session.presenters.length, 1, "with Hans alone");
      await page.locator("[data-cy='demo-leave']").waitFor({
        state: "detached",
        timeout: 15_000,
      });

      // clean up: Hans ends it
      await page.locator("[data-cy='demo-end']").click();
      await page.locator("[data-cy='demo-end-confirm']").click();
      await page.waitForURL(/\/admin/, { timeout: 20_000 });
    } finally {
      await userCtx.close();
      await liaCtx.close();
    }
  }));
