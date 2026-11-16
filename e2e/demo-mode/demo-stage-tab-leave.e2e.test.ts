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
  // past onboarding (REQ-091): the app's pages, with the sidebar's Log out, are hers
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
) {
  const who = await people(http);
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
  await openDemo(page, baseUrl, who.userPhone);
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
    async () => (await statusOf(page)) === "Live",
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
