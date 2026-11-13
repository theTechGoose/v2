/**
 * REQ-217 — one demo viewer per customer: the tab they are looking at. The customer's browser has
 * /dashboard visible, the worker portal open and /customers hidden; Demo lands the stage on
 * /dashboard (never /worker); the customer switches to /customers and the frame follows; the
 * worker portal never shows a pill.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const FRAME = "pm-demo-replica";

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
  if (!cookie) throw new Error(`sign-in: no cookie (${JSON.stringify(body)})`);
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
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out: ${what}`);
}

/** the tab's visibility, under the story's control: /customers starts hidden, the rest visible */
const VISIBILITY_SCRIPT = `(() => {
  const read = () => globalThis.__vis ?? (location.pathname.startsWith("/customers") ? "hidden" : "visible");
  Object.defineProperty(document, "visibilityState", { get: read, configurable: true });
  Object.defineProperty(document, "hidden", { get: () => read() !== "visible", configurable: true });
})();`;
// deno-lint-ignore no-explicit-any
const setVisibility = (p: any, v: "visible" | "hidden") =>
  p.evaluate((v: string) => {
    (globalThis as { __vis?: string }).__vis = v;
    document.dispatchEvent(new Event("visibilitychange"));
  }, v);

Deno.test("REQ-217: the visible tab is the demo's viewer — Demo lands on /dashboard with /worker open, the frame follows a tab switch to /customers, and /worker never shows a pill", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
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
    expect.eq(boot.status, 200, "the admin phone is a super admin");
    await boot.body?.cancel();

    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 420, height: 800 },
    });
    try {
      await userCtx.addInitScript(VISIBILITY_SCRIPT);
      await useCookie(userCtx, baseUrl, user.cookie);
      // three tabs on the customer's cookie: the dashboard (looked at), the worker portal, and
      // /customers in the background
      const dash = await userCtx.newPage();
      await dash.goto(`${baseUrl}/dashboard`);
      // a fresh account lands on the welcome wizard: the tab's real page is what counts
      const dashPath = new URL(dash.url()).pathname;
      const worker = await userCtx.newPage();
      await worker.goto(`${baseUrl}/worker?lang=en`);
      const customers = await userCtx.newPage();
      await customers.goto(`${baseUrl}/customers`);
      // let every tab poll at least once
      await new Promise((r) => setTimeout(r, 6_000));

      // 1. Demo: the stage opens on the dashboard — not the worker portal, not the hidden tab
      await useCookie(page.context(), baseUrl, admin.cookie);
      await page.goto("/admin");
      await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
      await page.locator("[data-cy='adm-search']").click();
      await page.locator("[data-cy='adm-demo']").first().waitFor({
        timeout: 15_000,
      });
      await page.locator("[data-cy='adm-demo']").first().click();
      await page.waitForURL((u) => u.pathname === "/demo/stage", {
        timeout: 20_000,
      });
      await until("the frame opens on the dashboard tab's page", () => {
        const f = page.frame({ name: FRAME });
        return !!f && new URL(f.url()).pathname === dashPath;
      });

      // 2. the dashboard tab joins; the hidden tab and the worker portal do not
      await dash.locator("[data-cy='demo-status']").filter({
        hasText: /direct|relay/,
      }).waitFor({ timeout: 20_000 });
      await new Promise((r) => setTimeout(r, 6_000));
      expect.eq(
        await worker.locator("[data-cy='demo-pill']").count(),
        0,
        "the worker portal never shows a pill",
      );
      expect.eq(
        await customers.locator("[data-cy='demo-status']").count(),
        0,
        "the hidden tab has not joined",
      );
      expect.eq(
        new URL(page.frame({ name: FRAME })!.url()).pathname,
        dashPath,
        "the frame is still the dashboard tab's page",
      );

      // 3. the customer switches tabs: /customers takes over and the frame follows
      await setVisibility(dash, "hidden");
      await setVisibility(customers, "visible");
      await customers.locator("[data-cy='demo-status']").filter({
        hasText: /direct|relay/,
      }).waitFor({ timeout: 20_000 });
      await until("the frame follows to /customers", () => {
        const f = page.frame({ name: FRAME });
        return !!f && new URL(f.url()).pathname === "/customers";
      });

      await page.locator("[data-cy='demo-end']").click();
      await page.waitForURL(/\/admin/, { timeout: 20_000 });
    } finally {
      await userCtx.close();
    }
  }));
