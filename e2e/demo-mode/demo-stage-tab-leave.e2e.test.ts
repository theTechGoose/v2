/**
 * REQ-823 — demo-loop cycle dm1, issues m8 and M2, end to end in real browsers (the tester's own
 * set-up: two customer tabs in one browser, both "visible" as headless says of every tab).
 *
 *   1. m8: an address-bar navigation in the followed tab (`page.goto` — no Navigation API
 *      `navigate`, so the page says "closing") with a second tab open: the stage stays on that
 *      browser tab. It never shows the other tab's screen and never says "Now showing {name}'s
 *      other tab".
 *   2. M2: the customer signs out from the sidebar with a second tab open: the stage says
 *      "Ana Torres signed out" at once. It never says "Loading their next page…" for it and never
 *      goes Live on the other tab. The other tab's pill goes too (its overlay heard the sign-out).
 *   3. REQ-834 (demo-loop cycle dm2, M1 — amends REQ-823): she signs out in tab 1 and back in
 *      while tab 2 stays open (never reloaded). Tab 2 rejoins: its pill is back within 5 s of
 *      tab 1's, and a key in tab 2 takes the stage there. REQ-823's latch was for the page's whole
 *      life, so tab 2 asked for no demo again until a navigation inside it.
 *
 * Which tab the stage shows is read off the stage pill's screen size ("Ana Torres's screen,
 * 1000 × 760"): the two tabs have different viewports.
 */
import { story, type StoryTools } from "#shots";
import { pillUp } from "../_shared/demo-pill.ts";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
/** past the presence grace (PRESENCE_GRACE_MS, 5 s): a fallback would have come by then */
const PAST_GRACE_MS = 6_500;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** past REQ-821's join grace (JOIN_SAY_MS 5 s) and a check: the pill has yielded */
const JOIN_PAST_MS = 6_500;

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
async function people(http: StoryTools["http"], adminLang: "en" | "es" = "en") {
  const userPhone = `+1512${digits()}`;
  const adminPhone = `+1843${digits()}`;
  const user = await verify(http, userPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: user.auth,
    body: JSON.stringify({ language: "en", name: "Ana Torres" }),
  })).body?.cancel();
  // past onboarding (REQ-091): the app's pages, with the sidebar's Log out, are hers
  await answerQuestions(http, user.auth, {
    name: "Ana Torres",
    businessName: "Torres Plumbing",
  });
  const admin = await verify(http, adminPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: admin.auth,
    body: JSON.stringify({ language: adminLang, name: "Hans" }),
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
async function openDemo(
  pg: Page,
  baseUrl: string,
  userPhone: string,
  lang: "en" | "es" = "en",
) {
  await pg.goto(`${baseUrl}/admin${lang === "es" ? "?lang=es" : ""}`);
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
const screenOf = (pg: Page) =>
  pg.locator("[data-cy='demo-screen']").innerText() as Promise<string>;
const pathOf = (pg: Page) =>
  pg.locator("[data-cy='demo-frame']").getAttribute("data-path") as Promise<
    string | null
  >;

/** what the stage shows, every 25 ms, each change kept: its status, the screen it mirrors, that
 *  screen's page, and the "other tab" notice */
interface Seen {
  status: string;
  screen: string;
  path: string;
  banner: string;
}
const record = (pg: Page) =>
  pg.evaluate(() => {
    const w = globalThis as unknown as {
      __pmSeen: unknown[];
      __pmTimer?: ReturnType<typeof setInterval>;
    };
    clearInterval(w.__pmTimer);
    w.__pmSeen = [];
    let last = "";
    const text = (sel: string) =>
      document.querySelector(sel)?.textContent?.trim() ?? "";
    w.__pmTimer = setInterval(() => {
      const s = {
        status: text("[data-cy='demo-status']"),
        screen: text("[data-cy='demo-screen']"),
        path: document.querySelector("[data-cy='demo-frame']")?.getAttribute(
          "data-path",
        ) ?? "",
        banner: text("[data-cy='demo-tab-switched']"),
      };
      const k = JSON.stringify(s);
      if (k !== last) {
        last = k;
        w.__pmSeen.push(s);
      }
    }, 25);
  });
const recorded = (pg: Page) =>
  pg.evaluate(() =>
    (globalThis as unknown as { __pmSeen: unknown[] }).__pmSeen
  ) as Promise<Seen[]>;

/** the stage and two customer tabs of one browser: tab 1 (`size1`) followed, tab 2 (640 × 760,
 *  on `path2`) open behind it — both connected, as headless keeps every tab */
async function twoTabs(
  page: Page,
  http: StoryTools["http"],
  baseUrl: string,
  size1: { width: number; height: number },
  path2: string,
  warm: string[] = [],
  // REQ-826 AMENDMENT 5 (dm11) — the stage's language (the admin's): "es" for a Spanish stage
  adminLang: "en" | "es" = "en",
) {
  const who = await people(http, adminLang);
  const browser = page.context().browser();
  if (!browser) throw new Error("no browser behind the story page");
  const userCtx = await browser.newContext({ viewport: size1 });
  const tab1 = await userCtx.newPage();
  await useCookie(userCtx, baseUrl, who.user.cookie);
  // the dev server compiles a route on its first visit (seconds): the pages the story moves to
  // are visited once before the demo, as a built deploy serves them at once
  for (const p of warm) await tab1.goto(`${baseUrl}${p}`);
  await tab1.goto(`${baseUrl}/dashboard`);
  await useCookie(page.context(), baseUrl, who.admin.cookie);
  await openDemo(page, baseUrl, who.userPhone, adminLang);
  await tab1.reload();
  await pillUp(tab1);
  const one = `${size1.width} × ${size1.height}`;
  await until(
    `the stage shows tab 1's screen (${one})`,
    async () => (await screenOf(page)).includes(one),
    20_000,
  );
  // a second tab, another size, is the one the customer uses now: the stage follows it
  const tab2 = await userCtx.newPage();
  await tab2.setViewportSize({ width: 640, height: 760 });
  await tab2.goto(`${baseUrl}${path2}`);
  await pillUp(tab2);
  await until(
    "the stage follows tab 2 (640 × 760)",
    async () => (await screenOf(page)).includes("640 × 760"),
  );
  // the customer uses tab 1 again (a key: her input claims the stage) — tab 2 stays open behind it
  await tab1.keyboard.press("Shift");
  await until(
    `a click in tab 1 takes the stage back (${one})`,
    async () => (await screenOf(page)).includes(one),
  );
  await until(
    "Live on tab 1",
    async () => ["Live", "En vivo"].includes(await statusOf(page)),
  );
  // that was a real switch, and the stage said so ("Now showing … other tab"): he moves on the
  // stage, so it is read — what the story records next is only what comes after
  await page.mouse.move(600, 380);
  await page.mouse.move(620, 400);
  await until(
    "the set-up's own tab notice is read",
    async () =>
      (await page.locator("[data-cy='demo-tab-switched']").count()) === 0,
  );
  return { ...who, userCtx, tab1, tab2, one };
}

Deno.test("REQ-823 m8 (demo-loop cycle dm1): with a second customer tab open, an address-bar navigation in the followed tab keeps the stage on that tab — never the other tab's screen, never 'Now showing … other tab'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { userCtx, tab1, one } = await twoTabs(
      page,
      http,
      baseUrl,
      { width: 1000, height: 760 },
      "/settings",
      ["/customers"],
    );
    try {
      await sleep(1_000);
      await record(page);
      // the tester's `goto` (a URL typed in the address bar): the page says "closing"
      await tab1.goto(`${baseUrl}/customers`);
      await pillUp(tab1);
      await until(
        "the stage shows tab 1's next page (/customers)",
        async () =>
          (await pathOf(page)) === "/customers" &&
          (await screenOf(page)).includes(one),
        20_000,
      );
      // long enough for a late fallback, and for the notice (shown for 8 s) to be seen
      await sleep(PAST_GRACE_MS);
      const seen = await recorded(page);
      const said = seen.filter((s) => s.banner);
      expect(
        said.length === 0,
        `m8: the stage never said it shows the other tab (${
          JSON.stringify(said)
        })`,
      );
      const other = seen.filter((s) => s.screen.includes("640 × 760"));
      expect(
        other.length === 0,
        `m8: tab 2's screen never came on the stage (${JSON.stringify(other)})`,
      );
      expect.eq(await pathOf(page), "/customers", "the stage is on /customers");
      expect(
        (await screenOf(page)).includes(one),
        "and on tab 1's screen",
      );
      expect.eq(await statusOf(page), "Live", "and Live there");
    } finally {
      await userCtx.close();
    }
  }));

Deno.test("REQ-823 M2 (demo-loop cycle dm1): the customer signs out from the sidebar with a second tab open — the stage says 'Ana Torres signed out' at once and never goes Live on the other tab; the other tab's pill goes too", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // tab 1 is a desktop window: its sidebar (with Log out) is on screen
    const { userCtx, tab1, tab2 } = await twoTabs(
      page,
      http,
      baseUrl,
      { width: 1100, height: 780 },
      "/quotes",
    );
    try {
      await sleep(1_000);
      await record(page);
      await tab1.locator("button.nav-item--logout").click();
      await until(
        "M2: the stage says Ana Torres signed out",
        async () => (await statusOf(page)) === "Ana Torres signed out",
        10_000,
      ).catch(async (e) => {
        throw new Error(
          `${(e as Error).message} — the stage showed ${
            JSON.stringify(await recorded(page))
          }`,
        );
      });
      // the waiting banner across the frame says it too
      await page.locator("[data-cy='demo-waiting']").filter({
        hasText: "Ana Torres signed out",
      }).waitFor({ timeout: 5_000 });
      // the other tab's overlay heard it: its pill is gone
      await tab2.locator("[data-cy='demo-pill']").waitFor({
        state: "detached",
        timeout: 10_000,
      });
      // past the 5 s grace: no fallback to the other tab ever comes
      await sleep(PAST_GRACE_MS);
      const seen = await recorded(page);
      const at = seen.findIndex((s) => s.status === "Ana Torres signed out");
      const after = seen.slice(at);
      expect(
        !after.some((s) => s.status === "Live"),
        `M2: never Live again after the sign-out (${JSON.stringify(after)})`,
      );
      expect(
        !seen.some((s) => /Loading their next page/.test(s.status)),
        `M2: the sign-out was never 'Loading their next page…' (${
          JSON.stringify(seen)
        })`,
      );
      expect(
        !seen.some((s) => s.screen.includes("640 × 760")),
        `M2: the other tab's screen never came on the stage (${
          JSON.stringify(seen)
        })`,
      );
      expect.eq(
        await statusOf(page),
        "Ana Torres signed out",
        "still says she signed out",
      );
    } finally {
      await userCtx.close();
    }
  }));

Deno.test("REQ-834 / REQ-823 AMENDMENT (demo-loop cycle dm2, M1): she signs out in tab 1 and back in while tab 2 stays open — tab 2 shows the pill again within 5 s, and a key in tab 2 takes the stage there", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { userCtx, tab1, tab2, userPhone } = await twoTabs(
      page,
      http,
      baseUrl,
      { width: 1100, height: 780 },
      "/quotes",
    );
    try {
      await sleep(1_000);
      await tab1.locator("button.nav-item--logout").click();
      await until(
        "the stage says Ana Torres signed out",
        async () => (await statusOf(page)) === "Ana Torres signed out",
        10_000,
      );
      await tab2.locator("[data-cy='demo-pill']").waitFor({
        state: "detached",
        timeout: 10_000,
      });
      // the sign-out's redirect has left the app (its own page load may still be going)
      await tab1.waitForURL((u: URL) => u.pathname === "/", {
        timeout: 20_000,
        waitUntil: "commit",
      });
      // she signs in again (the same phone: a new session); the browser's cookie is the new one,
      // in tab 2 too — and tab 2 is never reloaded
      const again = await verify(http, userPhone);
      await useCookie(userCtx, baseUrl, again.cookie);
      await tab1.goto(`${baseUrl}/dashboard`);
      await pillUp(tab1);
      // she goes back to tab 2: its pill is back within 5 s
      await tab2.bringToFront();
      const back = Date.now();
      await tab2.locator("[data-cy='demo-pill']").waitFor({
        state: "attached",
        timeout: 5_000,
      }).catch(() => {
        throw new Error(
          `M1: tab 2's pill is back within 5 s of the re-login (none after ${
            Date.now() - back
          } ms)`,
        );
      });
      // and her key in tab 2 takes the stage there
      await tab2.keyboard.press("Shift");
      await until(
        "M1: a key in tab 2 takes the stage to it (640 × 760)",
        async () => (await screenOf(page)).includes("640 × 760"),
      );
      await until(
        "M1: Live on tab 2",
        async () => (await statusOf(page)) === "Live",
      );
      expect.eq(
        await pathOf(page),
        "/quotes",
        "the stage shows tab 2's /quotes",
      );
    } finally {
      await userCtx.close();
    }
  }));

/** openDemo with a real mouse click on Demo: the runner's frame taken right after a click that
 *  navigates to /demo/stage can stall 90 s on a loaded host (REQ-823's evidence) */
async function openDemoByMouse(pg: Page, baseUrl: string, userPhone: string) {
  await pg.goto(`${baseUrl}/admin`);
  await pg.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
  await pg.locator("[data-cy='adm-search']").click();
  const demo = pg.locator("[data-cy='adm-demo']").first();
  await demo.waitFor({ timeout: 15_000 });
  const b = await demo.boundingBox();
  if (!b) throw new Error("no Demo button on /admin");
  await pg.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
  await pg.waitForURL((u: URL) => u.pathname === "/demo/stage", {
    timeout: 30_000,
  });
  await pg.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
}

Deno.test("REQ-879 (demo-loop cycle dm5, m3): a stale logged-out /login?next=/quotes tab, brought back and clicked after she signed in again in another tab, goes to /quotes, shows the pill, and the stage follows it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const who = await people(http);
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 1100, height: 780 },
    });
    try {
      const tab1 = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, who.user.cookie);
      // warm the routes the story moves to (the dev server compiles a route on first visit)
      for (const p of ["/quotes", "/login"]) await tab1.goto(`${baseUrl}${p}`);
      await tab1.goto(`${baseUrl}/dashboard`);
      await useCookie(page.context(), baseUrl, who.admin.cookie);
      await openDemoByMouse(page, baseUrl, who.userPhone);
      await tab1.reload();
      await pillUp(tab1);
      await until(
        "the stage shows tab 1 (1100 × 780)",
        async () => (await screenOf(page)).includes("1100 × 780"),
        20_000,
      );
      // she signs out in tab 1
      await tab1.locator("button.nav-item--logout").click();
      await until(
        "the stage says Ana Torres signed out",
        async () => (await statusOf(page)) === "Ana Torres signed out",
        10_000,
      );
      await until(
        "tab 1's sign-out redirect has left the app",
        () => new URL(tab1.url()).pathname !== "/dashboard",
        30_000,
      );
      // a second tab lands on the sign-in page with no session (client.ts's 401 redirect)
      const stale = await userCtx.newPage();
      await stale.setViewportSize({ width: 640, height: 760 });
      await stale.goto(`${baseUrl}/login?next=%2Fquotes`);
      expect.eq(
        new URL(stale.url()).pathname,
        "/login",
        "the stale tab is on /login",
      );
      expect.eq(
        await stale.locator("[data-cy='demo-pill']").count(),
        0,
        "no demo on a session-less /login",
      );
      // she signs in again in tab 1 (a new session in the browser's shared cookie)
      const again = await verify(http, who.userPhone);
      await useCookie(userCtx, baseUrl, again.cookie);
      await tab1.goto(`${baseUrl}/dashboard`);
      await pillUp(tab1);
      await until(
        "Live on tab 1 again (1100 × 780)",
        async () =>
          (await screenOf(page)).includes("1100 × 780") &&
          (await statusOf(page)) === "Live",
        20_000,
      );
      // she goes back to the stale /login tab and clicks in it
      await stale.bringToFront();
      await stale.mouse.click(8, 8);
      await stale.waitForURL((u: URL) => u.pathname === "/quotes", {
        timeout: 10_000,
      }).catch(() => {
        throw new Error(
          `m3: the stale /login tab never went to /quotes after the re-login (still ${stale.url()})`,
        );
      });
      await pillUp(stale);
      await stale.keyboard.press("Shift");
      await until(
        "m3: the stage follows the formerly stale tab (640 × 760)",
        async () => (await screenOf(page)).includes("640 × 760"),
      );
      await until(
        "m3: Live on that tab",
        async () => (await statusOf(page)) === "Live",
      );
      expect.eq(await pathOf(page), "/quotes", "the stage shows its /quotes");
    } finally {
      await userCtx.close();
    }
  }));

Deno.test("REQ-892 (demo-loop run 6, m3): the tab a sign-out landed on '/' (the landing, no session), brought back and clicked after she signed in again in another tab, goes to the dashboard, shows the pill, and the stage follows it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const who = await people(http);
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 1100, height: 780 },
    });
    try {
      const tab1 = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, who.user.cookie);
      // warm the routes the story moves to (the dev server compiles a route on first visit)
      for (const p of ["/", "/dashboard"]) await tab1.goto(`${baseUrl}${p}`);
      await useCookie(page.context(), baseUrl, who.admin.cookie);
      await openDemoByMouse(page, baseUrl, who.userPhone);
      await tab1.reload();
      await pillUp(tab1);
      await until(
        "the stage shows tab 1 (1100 × 780)",
        async () => (await screenOf(page)).includes("1100 × 780"),
        20_000,
      );
      // she signs out in tab 1: it lands on the landing, with no session
      await tab1.locator("button.nav-item--logout").click();
      await until(
        "the stage says Ana Torres signed out",
        async () => (await statusOf(page)) === "Ana Torres signed out",
        10_000,
      );
      // the sign-out's redirect ("/", or /login?next= when a 401 of a poll wins the race): the
      // tab ends on the landing, as the tester's did
      await until(
        "tab 1's sign-out redirect has left the app",
        () => new URL(tab1.url()).pathname !== "/dashboard",
        30_000,
      );
      if (new URL(tab1.url()).pathname !== "/") {
        await tab1.goto(`${baseUrl}/`);
      }
      expect.eq(
        new URL(tab1.url()).pathname,
        "/",
        `tab 1 is on the session-less landing (${tab1.url()})`,
      );
      expect.eq(
        await tab1.locator("[data-cy='demo-pill']").count(),
        0,
        "no demo on the session-less landing",
      );
      // she signs in again in a second tab (a new session in the browser's shared cookie)
      const tab2 = await userCtx.newPage();
      await tab2.setViewportSize({ width: 640, height: 760 });
      const again = await verify(http, who.userPhone);
      await useCookie(userCtx, baseUrl, again.cookie);
      await tab2.goto(`${baseUrl}/dashboard`);
      await pillUp(tab2);
      await until(
        "Live on tab 2 (640 × 760)",
        async () =>
          (await screenOf(page)).includes("640 × 760") &&
          (await statusOf(page)) === "Live",
        20_000,
      );
      // she goes back to the landing tab and clicks in it
      await tab1.bringToFront();
      await tab1.mouse.click(8, 8);
      await tab1.waitForURL((u: URL) => u.pathname === "/dashboard", {
        timeout: 10_000,
      }).catch(() => {
        throw new Error(
          `m3: the landing tab never went to the dashboard after the re-login (still ${tab1.url()})`,
        );
      });
      await pillUp(tab1);
      await tab1.keyboard.press("Shift");
      await until(
        "m3: the stage follows the formerly signed-out tab (1100 × 780)",
        async () => (await screenOf(page)).includes("1100 × 780"),
      );
      await until(
        "m3: Live on that tab",
        async () => (await statusOf(page)) === "Live",
      );
      expect.eq(
        await pathOf(page),
        "/dashboard",
        "the stage shows its dashboard",
      );
    } finally {
      await userCtx.close();
    }
  }));

Deno.test("REQ-826 AMENDMENT 3 (demo-loop run 9, p1): the customer's other tab is a mistyped URL (the 404 page) — the stage's 'Now showing … other tab' notice names it by the page's title, never by the path it was typed with", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // tab 2 is the 404 page of a URL typed by hand; the stage follows it (its pill is there)
    const { userCtx, tab2 } = await twoTabs(
      page,
      http,
      baseUrl,
      { width: 1000, height: 760 },
      "/outbox-zz/field",
    );
    try {
      // the 404 page says what it is in its own title (part of the same fix)
      expect.eq(
        await tab2.title(),
        "We couldn't find that page · DocuMonster",
        "the 404 page's document title",
      );
      await record(page);
      // the customer uses the 404 tab: the stage follows it and says so
      await tab2.keyboard.press("Shift");
      await until(
        "the stage follows tab 2 (640 × 760) again",
        async () => (await screenOf(page)).includes("640 × 760"),
      );
      await until(
        "the stage says it shows her other tab",
        async () =>
          (await page.locator("[data-cy='demo-tab-switched']").count()) === 1,
        10_000,
      );
      const banner = (await page.locator("[data-cy='demo-tab-switched']")
        .innerText() as string).trim();
      const mirrored = await page.evaluate(() => {
        const f = document.querySelector(
          "[data-cy='demo-frame']",
        ) as HTMLIFrameElement | null;
        const d = f?.contentDocument;
        return {
          title: d?.title ?? null,
          titles: d
            ? Array.from(d.querySelectorAll("title")).map((e) => e.textContent)
            : null,
          path: f?.getAttribute("data-path"),
        };
      });
      expect(
        /\(We couldn't find that page\)/.test(banner),
        `p1: the notice names the page by its title — got "${banner}" (the mirror: ${
          JSON.stringify(mirrored)
        })`,
      );
      expect(
        !/outbox|zz|field/i.test(banner),
        `p1: never a word off the typed path — got "${banner}"`,
      );
      const said = (await recorded(page)).filter((s) => s.banner);
      expect(
        said.every((s) => !/outbox|zz|field/i.test(s.banner)),
        `p1: no notice ever read the path (${JSON.stringify(said)})`,
      );
    } finally {
      await userCtx.close();
    }
  }));

Deno.test("REQ-826 AMENDMENT 4 (demo-loop run 10, m2): the customer's other tab is a 404 UNDER A KNOWN PREFIX (/quotes/…) — the stage's 'Now showing … other tab' notice names it by the page's title, never by the path it was typed with", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    // tab 2 is the 404 page of a mistyped /quotes/… URL: the known prefix must not name it
    const { userCtx, tab2 } = await twoTabs(
      page,
      http,
      baseUrl,
      { width: 1000, height: 760 },
      "/quotes/zz-not-a-quote",
    );
    try {
      // the 404 page says what it is in its own title (part of the same fix)
      expect.eq(
        await tab2.title(),
        "We couldn't find that page · DocuMonster",
        "the 404 page's document title",
      );
      await record(page);
      // the customer uses the 404 tab: the stage follows it and says so
      await tab2.keyboard.press("Shift");
      await until(
        "the stage follows tab 2 (640 × 760) again",
        async () => (await screenOf(page)).includes("640 × 760"),
      );
      await until(
        "the stage says it shows her other tab",
        async () =>
          (await page.locator("[data-cy='demo-tab-switched']").count()) === 1,
        10_000,
      );
      const banner = (await page.locator("[data-cy='demo-tab-switched']")
        .innerText() as string).trim();
      const mirrored = await page.evaluate(() => {
        const f = document.querySelector(
          "[data-cy='demo-frame']",
        ) as HTMLIFrameElement | null;
        const d = f?.contentDocument;
        return {
          title: d?.title ?? null,
          titles: d
            ? Array.from(d.querySelectorAll("title")).map((e) => e.textContent)
            : null,
          path: f?.getAttribute("data-path"),
        };
      });
      expect(
        /\(We couldn't find that page\)/.test(banner),
        `m2: the notice names the page by its title — got "${banner}" (the mirror: ${
          JSON.stringify(mirrored)
        })`,
      );
      expect(
        !/\((Quote|Quotes|Cotización|Cotizaciones)\)/.test(banner),
        `m2: never the known prefix's name for a 404 — got "${banner}"`,
      );
      const said = (await recorded(page)).filter((s) => s.banner);
      expect(
        said.every((s) =>
          !/\((Quote|Quotes|Cotización|Cotizaciones)\)/.test(s.banner)
        ),
        `m2: no notice ever named it by the prefix (${JSON.stringify(said)})`,
      );
    } finally {
      await userCtx.close();
    }
  }));

/** REQ-826 AMENDMENT 5 (dm11) — the notice's page name, on a Spanish stage, for a customer whose
 *  app is in English and whose other tab is `path2` */
async function spanishNoticeFor(
  page: Page,
  http: StoryTools["http"],
  baseUrl: string,
  path2: string,
  expectedTitle: string,
  expect: StoryTools["expect"],
) {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { userCtx, tab2 } = await twoTabs(
    page,
    http,
    baseUrl,
    { width: 1000, height: 760 },
    path2,
    [],
    "es",
  );
  try {
    expect.eq(await tab2.title(), expectedTitle, "the tab's own (EN) title");
    await record(page);
    await tab2.keyboard.press("Shift");
    await until(
      "the stage follows tab 2 (640 × 760) again",
      async () => (await screenOf(page)).includes("640 × 760"),
    );
    await until(
      "the stage says it shows her other tab",
      async () =>
        (await page.locator("[data-cy='demo-tab-switched']").count()) === 1,
      10_000,
    );
    const banner = (await page.locator("[data-cy='demo-tab-switched']")
      .innerText() as string).trim();
    const said = (await recorded(page)).filter((s) => s.banner).map((s) =>
      s.banner
    );
    return { banner, said };
  } finally {
    await userCtx.close();
  }
}

Deno.test("REQ-826 AMENDMENT 5 (demo-loop run 11, demo 5 #2): a SPANISH stage, the customer's app in English, her other tab a 404 — the notice names the page in the STAGE's language, '(No encontramos esa página)', never the English title", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { banner, said } = await spanishNoticeFor(
      page,
      http,
      baseUrl,
      "/quotes/zz-not-a-quote",
      "We couldn't find that page · DocuMonster",
      expect,
    );
    expect(
      /\(No encontramos esa página\)/.test(banner),
      `the notice names the 404 in Spanish — got "${banner}"`,
    );
    expect(
      [banner, ...said].every((b) =>
        !/couldn't find|\((Quote|Cotización)/.test(b)
      ),
      `never the English title or the prefix's name (${JSON.stringify(said)})`,
    );
  }));

Deno.test("REQ-826 AMENDMENT 5 (demo-loop run 11, demo 4 #1): the customer's other tab is a DEAD public invoice link (/i/<unknown>) — the notice says '(Mmm, no se puede abrir esto)', never '(Factura)'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { banner, said } = await spanishNoticeFor(
      page,
      http,
      baseUrl,
      "/i/nonexistent123",
      "Hmm, can't open this",
      expect,
    );
    expect(
      /\(Mmm, no se puede abrir esto\)/.test(banner),
      `the notice names the dead link by its error heading — got "${banner}"`,
    );
    expect(
      [banner, ...said].every((b) => !/\((Factura|Invoice)\)/.test(b)),
      `never "(Factura)" for a link that opens nothing (${
        JSON.stringify(said)
      })`,
    );
  }));

Deno.test("REQ-821 AMENDMENT (demo-loop run 11, p2): she signs out mid-demo (POST /api/auth/logout) and signs in again through /login in the SAME tab — the first page of the new session joins as a first join: the whole pill, '{name} is guiding you', held through the grace (no 200 ms flash and fold)", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const who = await people(http);
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    try {
      const tab1 = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, who.user.cookie);
      await tab1.goto(`${baseUrl}/dashboard`);
      await useCookie(page.context(), baseUrl, who.admin.cookie);
      await openDemo(page, baseUrl, who.userPhone);
      await tab1.reload();
      await pillUp(tab1);
      // past the join grace: the pill has yielded on this crowded phone page
      await tab1.waitForTimeout(JOIN_PAST_MS);
      // the tester's sign-out: the API, then /login by hand
      await tab1.evaluate(() =>
        fetch("/api/auth/logout", { method: "POST" }).then(() => undefined)
      );
      await tab1.goto(`${baseUrl}/login?lang=en`);
      await until(
        "the stage says she signed out",
        async () => (await statusOf(page)) === "Ana Torres signed out",
        10_000,
      );
      // she signs in again through the app: the phone, then the code
      await tab1.locator("input[type='tel']").fill(who.userPhone.slice(2));
      await tab1.locator("button[type='submit']").click();
      await tab1.waitForURL((u: URL) => u.pathname === "/verify", {
        timeout: 20_000,
      });
      await tab1.locator("input[inputmode='numeric']").first().focus();
      await tab1.keyboard.type("000000", { delay: 40 });
      await tab1.waitForURL((u: URL) => u.pathname !== "/verify", {
        timeout: 20_000,
      });
      // the new session's first page: the pill arrives as a first join — whole, guiding, held
      await tab1.locator("[data-cy='demo-pill']").waitFor({
        state: "attached",
        timeout: 20_000,
      });
      const seen: { tucked: boolean; text: string }[] = [];
      const t0 = Date.now();
      while (Date.now() - t0 < 2_500) {
        seen.push(
          await tab1.evaluate(() => {
            const p = document.querySelector("[data-cy='demo-pill']")!;
            return {
              tucked: p.hasAttribute("data-tucked"),
              text: (p.textContent ?? "").trim().slice(0, 50),
            };
          }),
        );
        await tab1.waitForTimeout(100);
      }
      await tab1.screenshot({ path: `${folder}/relogin-pill.png` });
      expect(
        seen.every((s) => !s.tucked),
        `p2: the pill stays whole through the first 2.5 s of the new session, never folded (${
          JSON.stringify(seen.filter((s) => s.tucked).slice(0, 3))
        } of ${seen.length})`,
      );
      expect(
        seen.some((s) => /guiding/.test(s.text)),
        `p2: it says "Hans is guiding you" (${
          JSON.stringify([...new Set(seen.map((s) => s.text))])
        })`,
      );
    } finally {
      await userCtx.close();
    }
  }));
