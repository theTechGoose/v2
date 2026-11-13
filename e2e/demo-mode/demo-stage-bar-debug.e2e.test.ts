/**
 * REQ-650 (demo-loop cycle 5, issue c4-m1) — the staff stage bar in a real browser on localhost:
 * no mirror counters unless the debug flag is set (the hostname no longer turns them on); the
 * bar stays one row with End on it; End's question replaces the pill's spans, so neither the pill
 * nor the frame changes size while it asks; with localStorage `pm_demo_debug` = "1" the counters
 * come back (how a lost frame still gets pinned).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
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
    await sleep(50);
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
  // past onboarding (REQ-091), so the app's pages are the customer's to move between
  await answerQuestions(http, user.auth, {
    name: "Ana Torres",
    businessName: "Torres Plumbing",
  });
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

const statusOf = (pg: Page) =>
  pg.locator("[data-cy='demo-status']").innerText().then((s: string) =>
    s.trim()
  );
const framePath = (pg: Page) =>
  pg.locator("[data-cy='demo-frame']").getAttribute("data-path");
/** the stage is Live on `path`; a timeout says what it showed instead */
const liveOn = async (pg: Page, path: string, timeout = 25_000) => {
  let seen = "";
  await until(`the stage is Live on ${path}`, async () => {
    seen = `${await statusOf(pg)} on ${await framePath(pg)}`;
    return seen === `Live on ${path}`;
  }, timeout).catch((e) => {
    throw new Error(`${(e as Error).message} (it showed: ${seen})`);
  });
};

const box = (pg: Page, sel: string) =>
  pg.locator(sel).boundingBox() as Promise<
    { x: number; y: number; width: number; height: number } | null
  >;

Deno.test("REQ-650 (demo-loop cycle 5, c4-m1): the stage bar shows no dev counters on localhost without ?debug=1 / pm_demo_debug, stays one row with End on it, and End's question leaves the frame and the pill's height unchanged", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const who = await people(http);
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 420, height: 800 },
    });
    try {
      const tab = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, who.user.cookie);
      await tab.goto(`${baseUrl}/dashboard`);
      await useCookie(page.context(), baseUrl, who.admin.cookie);
      await openDemo(page, baseUrl, who.userPhone);
      await tab.reload();
      await liveOn(page, "/dashboard");
      // the counters tick every 500 ms: give them the time they would take
      await sleep(1_500);
      expect.eq(
        await page.locator("[data-cy='demo-mirror-stats']").count(),
        0,
        "no mirror counters on a plain stage (localhost included)",
      );
      const end = await box(page, "[data-cy='demo-end']");
      const status = await box(page, "[data-cy='demo-status']");
      expect(
        !!end && !!status &&
          Math.abs((end.y + end.height / 2) - (status.y + status.height / 2)) <
            4,
        `End demo sits on the status's row (end ${
          JSON.stringify(end)
        }, status ${JSON.stringify(status)})`,
      );

      // End asks: the pill's spans give way to the question; nothing resizes
      const FRAME = "[data-cy='demo-frame']";
      await page.locator(FRAME).waitFor({ timeout: 15_000 });
      const frame0 = await box(page, FRAME);
      const pill0 = await box(page, "[data-cy='demo-pill']");
      await page.locator("[data-cy='demo-end']").click();
      await page.locator("[data-cy='demo-end-ask']").waitFor({
        timeout: 5_000,
      });
      await sleep(600);
      const frame1 = await box(page, FRAME);
      const pill1 = await box(page, "[data-cy='demo-pill']");
      expect.eq(
        JSON.stringify(frame1),
        JSON.stringify(frame0),
        "the frame keeps its box while End asks",
      );
      expect.eq(
        pill1?.height,
        pill0?.height,
        "the pill keeps its height while End asks (one row)",
      );
      expect(
        (pill1?.width ?? 0) <= (pill0?.width ?? 0) + 1,
        `the question replaces the pill's spans, adding no width (${pill0?.width} → ${pill1?.width})`,
      );
      expect.eq(
        await page.locator("[data-cy='demo-status']").count(),
        0,
        "the status gives way to the question",
      );
      await page.locator("[data-cy='demo-end-cancel']").click();
      await page.locator("[data-cy='demo-status']").waitFor({
        timeout: 5_000,
      });

      // the explicit debug flag brings the counters back
      await page.evaluate(() => localStorage.setItem("pm_demo_debug", "1"));
      await page.reload();
      await liveOn(page, "/dashboard");
      await until(
        "the debug flag shows the mirror counters",
        async () =>
          /\bf[1-9]/.test(
            await page.locator("[data-cy='demo-mirror-stats']").innerText(),
          ),
      );
      await page.evaluate(() => localStorage.removeItem("pm_demo_debug"));

      // clean up: End it
      await page.locator("[data-cy='demo-end']").click();
      await page.locator("[data-cy='demo-end-confirm']").click();
      await page.waitForURL(/\/admin/, { timeout: 20_000 });
    } finally {
      await userCtx.close();
    }
  }));
