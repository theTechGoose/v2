/**
 * REQ-232 — every customer tab and every staff window is its own connection (the demo's B3,
 * demo-lifecycle-m1, demo-lifecycle-m3, demo-lifecycle-p1 and M21), end to end in real browsers.
 *
 *   1. p1: the pills say plainly whether the demo is live (staff "Live", customer "Connected" —
 *      never accept, direct or relay).
 *   2. m1: the customer changes page twice and the staff pill never says it is waiting.
 *   3. B3: a second customer tab (another size) is followed, a click in the first takes the stage
 *      back, and closing the second leaves the stage live on the first — never frozen on waiting —
 *      with the first tab's pointer still arriving.
 *   4. m3: a second window of the same staff account (a fresh login) opens /admin and STAYS there,
 *      saying "Guiding Ana Torres · Back to the demo"; taking the demo over moves it onto the stage
 *      and tells the first window "In another window" (REQ-646 wording).
 *   5. M21: "Return to your account" on the stage asks first, then leaves the demo (its only
 *      presenter: the demo ends for the customer) and lands on /admin — and stays there.
 *
 * Which tab the stage follows is read off the stage pill's screen size ("Ana Torres's screen,
 * 640 × 760"): the two tabs have different viewports.
 */
import { story, type StoryTools } from "#shots";
import { pillUp } from "../_shared/demo-pill.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
/** the overlay's poll interval (ACTIVE_POLL_MS) plus room: long enough for any self-move to show */
const POLL_AND_ROOM_MS = 7_000;
/** past the presence grace (PRESENCE_GRACE_MS, 5 s) */
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
const pillOf = (pg: Page) =>
  pg.locator("[data-cy='demo-pill']").innerText() as Promise<string>;

/** start recording every text the staff pill's status shows (every 25 ms) */
const recordStatus = (pg: Page) =>
  pg.evaluate(() => {
    const w = globalThis as unknown as {
      __pmSeen: string[];
      __pmTimer?: ReturnType<typeof setInterval>;
    };
    clearInterval(w.__pmTimer);
    w.__pmSeen = [];
    w.__pmTimer = setInterval(() => {
      const s = document.querySelector("[data-cy='demo-status']")
        ?.textContent ?? "";
      if (w.__pmSeen[w.__pmSeen.length - 1] !== s) w.__pmSeen.push(s);
    }, 25);
  });
const recorded = (pg: Page) =>
  pg.evaluate(() =>
    (globalThis as unknown as { __pmSeen: string[] }).__pmSeen
  ) as Promise<string[]>;

/** a customer tab (420 × 800) and the staff stage of a fresh demo, the tab's app joined */
async function liveDemo(
  page: Page,
  http: StoryTools["http"],
  baseUrl: string,
) {
  const who = await people(http);
  const browser = page.context().browser();
  if (!browser) throw new Error("no browser behind the story page");
  const userCtx = await browser.newContext({
    viewport: { width: 420, height: 800 },
  });
  const tab1 = await userCtx.newPage();
  await useCookie(userCtx, baseUrl, who.user.cookie);
  await tab1.goto(`${baseUrl}/dashboard`);
  await useCookie(page.context(), baseUrl, who.admin.cookie);
  await openDemo(page, baseUrl, who.userPhone);
  const first = await statusOf(page);
  await tab1.reload();
  // the customer's app has joined (its pill is up)
  await pillUp(tab1);
  return { ...who, userCtx, tab1, first };
}

const screenOf = (pg: Page) =>
  pg.locator("[data-cy='demo-screen']").innerText() as Promise<string>;

Deno.test("REQ-232 (demo-lifecycle-p1): the pills say plainly whether the demo is live — staff Live, customer Connected — never accept, direct or relay", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { userCtx, tab1, first } = await liveDemo(page, http, baseUrl);
    try {
      // at the start the staff pill waits for the customer's APP; nobody is asked anything
      expect(
        !/accept/i.test(first),
        `the staff pill never asks anyone to accept ("${first}")`,
      );
      await page.locator("[data-cy='demo-status']").filter({
        hasText: /^\s*Live\s*$/,
      }).waitFor({ timeout: 20_000 });
      await pillUp(tab1, { live: true });
      for (const [who, pg] of [["staff", page], ["customer", tab1]] as const) {
        const pill = await pillOf(pg);
        expect(
          !/\b(direct|relay|accept)\b/i.test(pill),
          `the ${who} pill has no jargon and no consent line ("${pill}")`,
        );
      }
      await page.locator("[data-cy='demo-end']").click();
      await tab1.locator("[data-cy='demo-pill']").waitFor({
        state: "hidden",
        timeout: 15_000,
      });
    } finally {
      await userCtx.close();
    }
  }));

Deno.test("REQ-232 (demo-lifecycle-m1): the customer changes page twice — each a new page and a new socket — and the staff pill never says it is waiting", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { userCtx, tab1 } = await liveDemo(page, http, baseUrl);
    try {
      await until(
        "the stage shows the customer's screen (420 × 800)",
        async () => (await screenOf(page)).includes("420 × 800"),
      );
      await sleep(1_500);
      await recordStatus(page);
      // REQ-391 AMENDMENT — page changes the APP makes (as its links and the assistant do): a
      // page pointed elsewhere from outside (the address bar, page.goto) cannot tell that from
      // leaving the app, and now says "closing" — that is REQ-391's own story
      const appGoesTo = async (path: string) => {
        await tab1.evaluate((p: string) =>
          setTimeout(() => {
            location.href = p;
          }, 0), path);
        await tab1.waitForURL((u: URL) => u.pathname === path, {
          timeout: 15_000,
        });
        await pillUp(tab1);
      };
      await appGoesTo("/customers");
      await appGoesTo("/settings");
      await sleep(PAST_GRACE_MS);
      const during = await recorded(page);
      expect(
        during.length > 0 && !during.some((s) => /waiting|accept/i.test(s)),
        `demo-lifecycle-m1: the staff pill never said waiting through two page changes (${
          JSON.stringify(during)
        })`,
      );
      expect.eq(await statusOf(page), "Live", "and it is live after them");
    } finally {
      await userCtx.close();
    }
  }));

Deno.test("REQ-232 (B3): a second customer tab is followed; a click in the first takes the stage back; closing the second leaves the stage live on the first — never frozen on waiting — and the first tab's pointer still moves there", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { userCtx, tab1 } = await liveDemo(page, http, baseUrl);
    try {
      await until(
        "the stage shows tab 1's screen (420 × 800)",
        async () => (await screenOf(page)).includes("420 × 800"),
      );
      // a second tab, another size, is the one the customer uses now: the stage follows it
      const tab2 = await userCtx.newPage();
      await tab2.setViewportSize({ width: 640, height: 760 });
      await tab2.goto(`${baseUrl}/settings`);
      await pillUp(tab2);
      await until(
        "the stage follows tab 2 (640 × 760)",
        async () => (await screenOf(page)).includes("640 × 760"),
      );
      // the customer clicks in tab 1: the stage follows tab 1 again
      await tab1.locator("[data-cy='demo-pill'] strong").click();
      await until(
        "B3: a click in tab 1 takes the stage back (420 × 800)",
        async () => (await screenOf(page)).includes("420 × 800"),
      );
      // … and in tab 2 again; then tab 2 closes: the stage falls back to tab 1, stays live
      await tab2.locator("[data-cy='demo-pill'] strong").click();
      await until(
        "tab 2 again (640 × 760)",
        async () => (await screenOf(page)).includes("640 × 760"),
      );
      await recordStatus(page);
      await tab2.close();
      await until(
        "B3: tab 2 closed — the stage falls back to tab 1 (420 × 800)",
        async () => (await screenOf(page)).includes("420 × 800"),
      );
      await sleep(PAST_GRACE_MS);
      const after = await recorded(page);
      expect(
        !after.some((s) => /waiting|accept/i.test(s)),
        `B3: closing tab 2 never froze the stage on waiting (${
          JSON.stringify(after)
        })`,
      );
      expect.eq(await statusOf(page), "Live", "B3: still live on tab 1");
      // tab 1's pointer still reaches the stage, and moves there as it moves
      const pointerAt = () =>
        page.locator("[data-cy='demo-pointer']").first().evaluate(
          (el: Element) => {
            const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
            return { x: m.m41, y: m.m42 };
          },
        ) as Promise<{ x: number; y: number }>;
      await tab1.mouse.move(60, 200);
      await tab1.mouse.move(80, 220);
      await page.locator("[data-cy='demo-pointer']").first().waitFor({
        timeout: 10_000,
      });
      await sleep(600);
      const p1 = await pointerAt();
      await tab1.mouse.move(300, 600);
      await tab1.mouse.move(320, 620);
      await until(
        "B3: tab 1's pointer moves on the stage",
        async () => {
          const p2 = await pointerAt();
          return Math.hypot(p2.x - p1.x, p2.y - p1.y) > 20;
        },
        10_000,
      );
      await page.locator("[data-cy='demo-end']").click();
      await tab1.locator("[data-cy='demo-pill']").waitFor({
        state: "hidden",
        timeout: 15_000,
      });
    } finally {
      await userCtx.close();
    }
  }));

Deno.test("REQ-232 (demo-lifecycle-m3): a second window of the same staff account stays on /admin and offers Back to the demo; taking over moves it onto the stage and tells the first window", (t) =>
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
      // the customer's app has joined (its pill is up); the wording is story 1's business
      await pillUp(tab);
      await sleep(1_500);

      // window 2: Hans logs in again in another window and opens /admin
      const again = await verify(http, adminPhone);
      const win2 = await win2Ctx.newPage();
      await useCookie(win2Ctx, baseUrl, again.cookie);
      await win2.goto(`${baseUrl}/admin`);
      await sleep(POLL_AND_ROOM_MS);
      expect.eq(
        new URL(win2.url()).pathname,
        "/admin",
        "demo-lifecycle-m3: window 2 never moved itself onto the stage",
      );
      const pill2 = await win2.locator("[data-cy='demo-pill']").innerText();
      expect(
        pill2.includes("Guiding Ana Torres"),
        `window 2 says what is going on ("${pill2}")`,
      );
      await win2.locator("[data-cy='demo-rejoin']").waitFor({
        timeout: 5_000,
      });
      expect.eq(await statusOf(page), "Live", "window 1 is untouched");

      // window 2 takes the demo over: window 1 says so plainly
      await win2.locator("[data-cy='demo-rejoin']").click();
      await win2.waitForURL((u: URL) => u.pathname === "/demo/stage", {
        timeout: 20_000,
      });
      await win2.locator("[data-cy='demo-status']").filter({
        hasText: /^\s*Live\s*$/,
      }).waitFor({ timeout: 20_000 });
      await page.locator("[data-cy='demo-status']").filter({
        hasText: "In another window",
      }).waitFor({ timeout: 15_000 });
      await page.locator("[data-cy='demo-use-here']").waitFor({
        timeout: 5_000,
      });
      // the customer sees ONE pointer for Hans, and it is window 2's (the customer's screen sits
      // centred on the stage, so the middle of the window is over it)
      await win2.mouse.move(630, 380);
      await win2.mouse.move(650, 400);
      await tab.locator("[data-cy='demo-pointer']").first().waitFor({
        timeout: 10_000,
      });
      expect.eq(
        await tab.locator("[data-cy='demo-pointer']").count(),
        1,
        "one pointer for Hans on the customer's screen",
      );

      await win2.locator("[data-cy='demo-end']").click();
      await tab.locator("[data-cy='demo-pill']").waitFor({
        state: "hidden",
        timeout: 15_000,
      });
    } finally {
      await userCtx.close();
      await win2Ctx.close();
    }
  }));

Deno.test("REQ-232 (M21): Return to your account on the stage asks first, leaves the demo (it ends for the customer — Hans was its only presenter) and lands on /admin, where it stays", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const { user, admin, userPhone } = await people(http);
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 420, height: 800 },
    });
    try {
      const tab = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await tab.goto(`${baseUrl}/dashboard`);
      await useCookie(page.context(), baseUrl, admin.cookie);
      await openDemo(page, baseUrl, userPhone);
      await tab.reload();
      // the customer's app has joined (its pill is up); the wording is story 1's business
      await pillUp(tab);
      await sleep(1_500);

      // every page the staff window lands on from here
      const navs: string[] = [];
      // deno-lint-ignore no-explicit-any
      page.on("framenavigated", (f: any) => {
        if (f === page.mainFrame()) navs.push(new URL(f.url()).pathname);
      });
      await page.locator("[data-cy='imp-banner'] button", {
        hasText: "Return to your account",
      }).click();
      const ask = page.locator("[data-cy='imp-leave-demo']");
      const asked = await ask.waitFor({ timeout: 5_000 }).then(
        () => true,
        () => false,
      );
      if (asked) {
        const banner = await page.locator("[data-cy='imp-banner']")
          .innerText();
        expect(
          banner.includes("Ana Torres"),
          `the question names the customer ("${banner}")`,
        );
        // REQ-298 — Hans is the only presenter: the question says leaving ends the demo
        expect(
          banner.includes(
            "You are the only presenter — leaving ends the demo for Ana Torres.",
          ),
          `REQ-298: the only presenter is told leaving ends the demo ("${banner}")`,
        );
        await ask.click();
      }
      await until(
        "the staff window lands on /admin",
        () => navs.includes("/admin"),
        20_000,
      );
      await sleep(POLL_AND_ROOM_MS);
      const after = navs.slice(navs.indexOf("/admin"));
      expect(
        !after.includes("/demo/stage") &&
          new URL(page.url()).pathname === "/admin",
        `M21: Return to your account stays returned — never bounced back to the stage (pages after it: ${
          after.join(" → ")
        })`,
      );
      expect(asked, "M21: during a demo, Return to your account asks first");
      await tab.locator("[data-cy='demo-pill']").waitFor({
        state: "hidden",
        timeout: 15_000,
      });
      const active = await http("/api/demo-mode/active", {
        headers: user.auth,
      });
      expect.eq(
        (await active.json()).session,
        null,
        "the demo is over: Hans was its only presenter",
      );
    } finally {
      await userCtx.close();
    }
  }));
