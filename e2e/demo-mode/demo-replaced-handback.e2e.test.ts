/**
 * REQ-541 — demo-loop cycle 4, issue M22, end to end in real browsers: a second window of the
 * same staff account takes the demo over; the first window's stage is greyed under "This demo
 * moved to another window · Use this window"; the demo is ended from the second window, and the
 * first one — which never hears that end (its link was replaced) — hands Hans his own account
 * back on its own: it lands on /admin, no longer impersonating the customer (no "You are guiding
 * … in this browser" gate).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
/** the overlay's poll interval (ACTIVE_POLL_MS) plus room: long enough for any self-move to show */
const POLL_AND_ROOM_MS = 7_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function until(
  what: string,
  cond: () => boolean | Promise<boolean>,
  timeout = 15_000,
) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    try {
      if (await cond()) return;
    } catch {
      // mid-navigation; ask again
    }
    await sleep(100);
  }
  throw new Error(`timed out: ${what}`);
}

/** a customer (Ana Torres) and a super admin (Hans), signed up fresh */
async function people(http: StoryTools["http"]) {
  const userPhone = `+1512${digits()}`;
  const adminPhone = `+1843${digits()}`;
  const user = await verify(http, userPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: user.auth,
    body: JSON.stringify({ language: "en", name: "Ana Torres" }),
  })).body?.cancel();
  const admin = await verify(http, adminPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: admin.auth,
    body: JSON.stringify({ language: "en", name: "Hans" }),
  })).body?.cancel();
  const boot = await http("/api/admin/bootstrap", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: adminPhone }),
  });
  await boot.body?.cancel();
  if (boot.status !== 200) throw new Error(`bootstrap: ${boot.status}`);
  return { user, admin, userPhone, adminPhone };
}

// deno-lint-ignore no-explicit-any
type Page = any;

/** on /admin: find the customer and click Demo; the page lands on the stage */
async function openDemo(pg: Page, baseUrl: string, userPhone: string) {
  await pg.goto(`${baseUrl}/admin`);
  await pg.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
  await pg.locator("[data-cy='adm-search']").click();
  await pg.locator("[data-cy='adm-demo']").first().waitFor({ timeout: 15_000 });
  await pg.locator("[data-cy='adm-demo']").first().click();
  await pg.waitForURL((u: URL) => u.pathname === "/demo/stage", {
    timeout: 20_000,
  });
  await pg.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
}

Deno.test("REQ-541 (cycle 4, M22): a replaced stage window is greyed under the moved banner, and when the demo is ended from the other window it hands the account back on its own", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { user, admin, userPhone, adminPhone } = await people(http);
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 420, height: 800 },
    });
    const win2Ctx = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    try {
      const tab = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await tab.goto(`${baseUrl}/dashboard`);
      await useCookie(page.context(), baseUrl, admin.cookie);
      await openDemo(page, baseUrl, userPhone);
      await tab.reload();
      await tab.locator("[data-cy='demo-status']").waitFor({ timeout: 20_000 });
      await page.locator("[data-cy='demo-status']").filter({
        hasText: /^\s*Live\s*$/,
      }).waitFor({ timeout: 20_000 });

      // window 2: Hans signs in again elsewhere and takes the demo over
      const again = await verify(http, adminPhone);
      const win2 = await win2Ctx.newPage();
      await useCookie(win2Ctx, baseUrl, again.cookie);
      await win2.goto(`${baseUrl}/admin`);
      await win2.locator("[data-cy='demo-rejoin']").waitFor({
        timeout: 15_000,
      });
      await win2.locator("[data-cy='demo-rejoin']").click();
      await win2.waitForURL((u: URL) => u.pathname === "/demo/stage", {
        timeout: 20_000,
      });
      await win2.locator("[data-cy='demo-status']").filter({
        hasText: /^\s*Live\s*$/,
      }).waitFor({ timeout: 20_000 });

      // window 1 is plainly not live: the moved banner across a greyed frame
      await page.locator("[data-cy='demo-elsewhere']").waitFor({
        timeout: 15_000,
      });
      const banner = await page.locator("[data-cy='demo-elsewhere']")
        .innerText();
      expect(
        banner.includes("This demo moved to another window") &&
          banner.includes("Use this window"),
        `M22: the first window says the demo moved, and offers it back ("${banner}")`,
      );
      const filter = await page.locator("[data-cy='demo-frame']").evaluate(
        // deno-lint-ignore no-explicit-any
        (el: any) => getComputedStyle(el.parentElement).filter,
      );
      expect(
        /grayscale/.test(filter),
        `M22: the first window's frame is greyed ("${filter}")`,
      );

      // the demo is ended from window 2
      const navs: string[] = [];
      // deno-lint-ignore no-explicit-any
      page.on("framenavigated", (f: any) => {
        if (f === page.mainFrame()) navs.push(new URL(f.url()).pathname);
      });
      await win2.locator("[data-cy='demo-end']").click();
      // End asks first; Yes counts once armed (END_ARM_MS)
      const yes = win2.locator("[data-cy='demo-end-confirm']");
      await yes.waitFor({ timeout: 5_000 });
      await sleep(600);
      await yes.click();
      await tab.locator("[data-cy='demo-pill']").waitFor({
        state: "hidden",
        timeout: 15_000,
      });

      // window 1 hands the account back by itself (its /active poll finds the demo gone)
      await until(
        "the first window lands on /admin",
        () => navs.includes("/admin"),
        POLL_AND_ROOM_MS + 8_000,
      );
      await page.waitForLoadState("domcontentloaded");
      expect.eq(
        await page.locator("[data-cy='admin-gate']").count(),
        0,
        "M22: /admin is Hans's own — no 'You are guiding … in this browser' gate",
      );
      const who = await page.evaluate(() =>
        fetch("/api/admin/whoami", { credentials: "include" }).then((r) =>
          r.json()
        )
      );
      expect(
        !who.impersonating,
        `M22: the first window is no longer impersonating the customer (${
          JSON.stringify(who)
        })`,
      );
    } finally {
      await userCtx.close();
      await win2Ctx.close();
    }
  }));
