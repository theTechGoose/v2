/**
 * REQ-393 — demo issues M2 and M8 (demo-loop cycle 2), in two browsers: the presenter's pointer is
 * the spot under his mouse, wherever it is on the stage.
 *
 *   1. M2 (start) + M8: the admin clicks Demo on /admin and never moves the mouse again — the
 *      customer's phone shows his pointer as soon as their screen is on the stage (the page that
 *      opened the stage handed the mouse's place over); with his mouse beside the phone frame the
 *      arrow sits on the edge of the customer's screen, marked outside — never gone — and the
 *      stage says "Your pointer is off Ana Torres's screen"; back on the frame, the arrow is on
 *      the screen and the hint goes.
 *   2. M2 (tab switch): the presenter rests on the frame; a second customer tab is followed — the
 *      first tab loses his arrow (the stage's `leave` is addressed to it) and the second shows it
 *      with no move; his next move reaches the second tab only; a click in the first tab takes the
 *      stage back, and the arrows swap again.
 *
 * (The customer scrolling under the presenter's still mouse is REQ-305's M2 story in
 * demo-scroll-pointer.e2e.test.ts, amended by REQ-393: the arrow stays under his cursor.)
 */
import { story, type StoryTools } from "#shots";

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
  let last: unknown = null;
  while (Date.now() - t0 < timeout) {
    try {
      if (await cond()) return;
    } catch (e) {
      last = e;
    }
    await sleep(120);
  }
  throw new Error(`timed out: ${what}${last ? ` (last: ${last})` : ""}`);
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
  return { user, admin, userPhone };
}

type Page = StoryTools["page"];

/** on /admin: find the customer and click Demo (the mouse stays where it clicked); the page lands
 *  on the stage. Says where the click was. */
async function openDemo(pg: Page, baseUrl: string, userPhone: string) {
  await pg.goto(`${baseUrl}/admin`);
  await pg.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
  await pg.locator("[data-cy='adm-search']").click();
  const demo = pg.locator("[data-cy='adm-demo']").first();
  await demo.waitFor({ timeout: 15_000 });
  const b = await demo.boundingBox();
  if (!b) throw new Error("no Demo button box");
  const clickedAt = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await demo.click({ position: { x: b.width / 2, y: b.height / 2 } });
  await pg.waitForURL((u: URL) => u.pathname === "/demo/stage", {
    timeout: 20_000,
  });
  await pg.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
  return clickedAt;
}

const screenOf = (pg: Page) =>
  pg.locator("[data-cy='demo-screen']").innerText() as Promise<string>;

/** the presenter's arrow on a customer tab: where it is drawn and whether it points outside */
const arrowOn = (pg: Page) =>
  pg.evaluate(() => {
    const el = Array.from(document.querySelectorAll("[data-cy='demo-pointer']"))
      .find((e) => e.getAttribute("data-presenter") === "Hans");
    if (!el) return null;
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: m.m41, y: m.m42, outside: el.hasAttribute("data-outside") };
  }) as Promise<{ x: number; y: number; outside: boolean } | null>;

/** the stage's "your pointer is off their screen" hint, when it shows */
const offHint = (pg: Page) =>
  pg.evaluate(() => {
    const el = document.querySelector("[data-cy='demo-pointer-off']");
    return el ? (el as HTMLElement).innerText.trim() : null;
  }) as Promise<string | null>;

/** the frame's box on the stage (the scaled mirror) */
async function frameBox(pg: Page) {
  const b = await pg.locator("[data-cy='demo-frame']").boundingBox();
  if (!b) throw new Error("no frame box on the stage");
  return b;
}

Deno.test("REQ-393 (demo M2 start, M8): the stage opened from /admin sends the presenter's pointer before he moves; with his mouse beside the phone frame the arrow sits on the edge of the customer's screen, marked outside, and the stage says so; back on the frame it is on the screen and the hint goes", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    const who = await people(http);
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    // the customer is on a phone
    const userCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    try {
      const phone = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, who.user.cookie);
      await phone.goto(`${baseUrl}/dashboard`);
      await useCookie(page.context(), baseUrl, who.admin.cookie);
      const clickedAt = await openDemo(page, baseUrl, who.userPhone);
      // the customer's app joins; the stage mirrors the phone
      await phone.reload();
      await phone.locator("[data-cy='demo-status']").waitFor({
        timeout: 20_000,
      });
      await until(
        "the stage shows the customer's phone (390 × 844)",
        async () => (await screenOf(page)).includes("390 × 844"),
        25_000,
      );

      // 1. M2 start — the admin's mouse has not moved since the click on Demo: the customer's
      //    phone shows his pointer anyway, on their screen or on its edge as the frame has it
      const fb = await frameBox(page);
      const beside = clickedAt.x < fb.x || clickedAt.x > fb.x + fb.width ||
        clickedAt.y < fb.y || clickedAt.y > fb.y + fb.height;
      await until(
        `M2: the presenter's pointer reaches the customer's phone with no move (his mouse at ${
          JSON.stringify(clickedAt)
        }, the frame ${JSON.stringify(fb)})`,
        async () => {
          const at = await arrowOn(phone);
          if (!at) throw new Error("no presenter arrow on the phone");
          if (at.outside !== beside) {
            throw new Error(`arrow ${JSON.stringify(at)}, beside ${beside}`);
          }
          return true;
        },
        15_000,
      );
      expect(true, "the presenter's pointer is on the phone before he moved");

      // 2. M8 — his mouse beside the phone frame (the stage's dark margin): the arrow sits on the
      //    phone's left edge at the same height, marked outside — never gone — and the stage says so
      const besideLeft = { x: fb.x - 140, y: fb.y + fb.height * 0.4 };
      await page.mouse.move(besideLeft.x - 20, besideLeft.y - 10);
      await page.mouse.move(besideLeft.x, besideLeft.y);
      await until(
        "M8: beside the frame, the arrow is on the phone's left edge at 40 % of its height, marked outside",
        async () => {
          const at = await arrowOn(phone);
          if (!at) throw new Error("no presenter arrow: it vanished");
          if (!at.outside || at.x > 2 || Math.abs(at.y - 844 * 0.4) > 4) {
            throw new Error(`arrow ${JSON.stringify(at)}`);
          }
          return true;
        },
        10_000,
      );
      await until(
        "M8: the stage says the pointer is off their screen",
        async () =>
          (await offHint(page)) === "Your pointer is off Ana Torres's screen",
        10_000,
      );
      // still there a moment later (a leave would have taken it away)
      await sleep(1_500);
      const still = await arrowOn(phone);
      expect(
        still !== null && still.outside,
        `M8: the arrow stays on the edge while his mouse is beside the frame (${
          JSON.stringify(still)
        })`,
      );
      await page.screenshot({
        path: `${Deno.env.get("SHOTS_DIR") ?? "."}/req-393-off-frame.png`,
      }).catch(() => {});

      // 3. back on the frame: on the screen, the hint gone
      const onFrame = { x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 };
      await page.mouse.move(onFrame.x - 10, onFrame.y - 10);
      await page.mouse.move(onFrame.x, onFrame.y);
      await until(
        "back on the frame: the arrow is on the phone's screen, at its middle",
        async () => {
          const at = await arrowOn(phone);
          if (!at) throw new Error("no presenter arrow");
          if (
            at.outside || Math.abs(at.x - 195) > 4 || Math.abs(at.y - 422) > 4
          ) throw new Error(`arrow ${JSON.stringify(at)}`);
          return true;
        },
        10_000,
      );
      await until(
        "the stage's off-screen hint is gone",
        async () => (await offHint(page)) === null,
        10_000,
      );
      expect.eq(await offHint(page), null, "no hint while on the frame");

      await page.locator("[data-cy='demo-end']").click();
      await page.locator("[data-cy='demo-end-confirm']").click().catch(
        () => {},
      );
      await phone.locator("[data-cy='demo-pill']").waitFor({
        state: "hidden",
        timeout: 15_000,
      });
    } finally {
      await userCtx.close();
    }
  }));

Deno.test("REQ-393 (demo M2 tab switch): the tab the stage leaves loses the presenter's arrow and the tab it follows shows it with no move; his moves reach the followed tab only; a click in the first tab swaps them back", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const who = await people(http);
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 420, height: 800 },
    });
    try {
      const tab1 = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, who.user.cookie);
      await tab1.goto(`${baseUrl}/dashboard`);
      await useCookie(page.context(), baseUrl, who.admin.cookie);
      await openDemo(page, baseUrl, who.userPhone);
      await tab1.reload();
      await tab1.locator("[data-cy='demo-status']").waitFor({
        timeout: 20_000,
      });
      await until(
        "the stage shows tab 1 (420 × 800)",
        async () => (await screenOf(page)).includes("420 × 800"),
        25_000,
      );
      // the presenter rests in the middle of the frame (inside tab 2's wider frame too)
      const fb = await frameBox(page);
      const rest = { x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 };
      await page.mouse.move(rest.x - 30, rest.y - 15);
      await page.mouse.move(rest.x, rest.y);
      await until(
        "tab 1 shows the presenter's arrow",
        async () => (await arrowOn(tab1))?.outside === false,
        10_000,
      );

      // 1. a second tab is the one the customer uses now: the stage follows it
      const tab2 = await userCtx.newPage();
      await tab2.setViewportSize({ width: 640, height: 760 });
      await tab2.goto(`${baseUrl}/settings`);
      await tab2.locator("[data-cy='demo-status']").waitFor({
        timeout: 20_000,
      });
      await until(
        "the stage follows tab 2 (640 × 760)",
        async () => (await screenOf(page)).includes("640 × 760"),
        20_000,
      );
      await until(
        "M2: the tab the stage left (tab 1) loses the presenter's arrow",
        async () => (await arrowOn(tab1)) === null,
        10_000,
      );
      await until(
        "M2: the tab the stage follows (tab 2) shows the presenter's arrow — he never moved",
        async () => (await arrowOn(tab2))?.outside === false,
        10_000,
      );
      expect(true, "the arrow moved to the followed tab with no move");

      // 2. his next move reaches tab 2 only
      const before = await arrowOn(tab2);
      await page.mouse.move(rest.x + 25, rest.y + 20);
      await until(
        "his move reaches tab 2",
        async () => {
          const at = await arrowOn(tab2);
          return !!at && !!before &&
            Math.hypot(at.x - before.x, at.y - before.y) > 10;
        },
        10_000,
      );
      await sleep(1_500);
      expect.eq(
        await arrowOn(tab1),
        null,
        "M2: tab 1 (not followed) never gets his moves",
      );

      // 3. the customer clicks in tab 1 (its pill's toggle: a 420 px pill is the compact one, no
      //    title): the stage follows it again, and the arrows swap
      await tab1.locator("[data-cy='demo-more']").click();
      await until(
        "a click in tab 1 takes the stage back (420 × 800)",
        async () => (await screenOf(page)).includes("420 × 800"),
        20_000,
      );
      await until(
        "M2: tab 2, left, loses the arrow",
        async () => (await arrowOn(tab2)) === null,
        10_000,
      );
      await until(
        "M2: tab 1, followed again, shows the arrow — he did not move",
        async () => (await arrowOn(tab1)) !== null,
        10_000,
      );
      expect(true, "the arrows swapped back with the stage");

      await page.locator("[data-cy='demo-end']").click();
      await page.locator("[data-cy='demo-end-confirm']").click().catch(
        () => {},
      );
      await tab1.locator("[data-cy='demo-pill']").waitFor({
        state: "hidden",
        timeout: 15_000,
      });
    } finally {
      await userCtx.close();
    }
  }));
