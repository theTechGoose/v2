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
 *
 * REQ-451 AMENDMENT (demo M1 + M14, cycle 3) — his pointer is what he POINTED AT:
 *   1. the cursor handed over from /admin counts only on the frame: the Demo button sits beside
 *      the phone frame, so the phone shows no arrow (and the stage no "off" hint) until he moves;
 *      his mouse beside the frame is a small translucent marker on the phone's edge — no arrow,
 *      no name tag over its controls — where his mouse meets the frame as it is now (a frame
 *      that moves under his still mouse moves the marker); back on the frame, the arrow and its
 *      tag; the stage reloaded under his still mouse on the frame starts there (the hand-off
 *      counts there) — on the element under it once the replay has settled, never on one a
 *      half-built replay put there (its logo or fonts not in: the Continue button).
 *   2. a tab the stage newly follows shows no arrow while his mouse is still (he pointed at the
 *      other tab's page); a tab followed again, its page unchanged, gets the arrow he left there;
 *      his move puts it on the followed tab only.
 *
 * REQ-538 AMENDMENT (demo M1, cycle 4) — a tab the stage newly follows is a new page load, where
 * what he pointed at is dead: once its mirror has settled his still mouse is looked up again ONCE,
 * so the arrow comes to that tab with no move (it used to stay gone until he moved); a tab
 * followed again gets it back on the same element; his move still reaches the followed tab only.
 *
 * REQ-539 AMENDMENT (demo m24, cycle 4) — the cursor handed over from /admin is where his mouse
 * IS, not what he points at: for a desktop customer the fitted frame covers most of the stage and
 * the Demo button's spot falls on it — the arrow sat on her mic button from the start. Only the
 * stage's own hand-off (a reload) is sent; /admin's, on the frame or beside it, puts nothing on
 * the customer's screen until he moves (beside the frame the stage may say he is off it).
 *
 * REQ-645 AMENDMENT (demo m36, cycle 5) — supersedes REQ-538's look-up on a tab the stage newly
 * follows: "he pointed at 'ES' on /customers; the arrow appeared on Linda's /q tab". Another of
 * her browser tabs followed gets NO arrow while his mouse is still — what he pointed at was on
 * the other tab — and the stage says which tab it shows now ("Now showing Ana Torres's other tab
 * (/settings) — move to point there"); a tab followed again with its page unchanged still gets
 * back the arrow he left there; his move still reaches the followed tab only.
 */
import { story, type StoryTools } from "#shots";
import { pillUp } from "../_shared/demo-pill.ts";

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

/** the presenter's arrow on a customer tab: where it is drawn, whether it points outside, whether
 *  it is REQ-451's small off-screen marker, whether its name tag is drawn, and whether it is the
 *  element marked `old` before (a pointer drawn afresh is a new element) */
const arrowOn = (pg: Page) =>
  pg.evaluate(() => {
    const el = Array.from(document.querySelectorAll("[data-cy='demo-pointer']"))
      .find((e) => e.getAttribute("data-presenter") === "Hans");
    if (!el) return null;
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return {
      x: m.m41,
      y: m.m42,
      outside: el.hasAttribute("data-outside"),
      off: el.hasAttribute("data-off"),
      tag: el.querySelector("[data-cy='demo-pointer-tag']") !== null,
      old: el.hasAttribute("data-e2e-old"),
    };
  }) as Promise<
    | {
      x: number;
      y: number;
      outside: boolean;
      off: boolean;
      tag: boolean;
      old: boolean;
    }
    | null
  >;

/** the presenter's arrow on a tab once it has come to rest (two reads apart agree) */
async function settledArrow(pg: Page) {
  let last = await arrowOn(pg);
  for (let i = 0; i < 40; i++) {
    await sleep(150);
    const now = await arrowOn(pg);
    if (
      now && last && Math.abs(now.x - last.x) < 0.5 &&
      Math.abs(now.y - last.y) < 0.5
    ) return now;
    last = now;
  }
  throw new Error(
    `the presenter's arrow never came to rest (${JSON.stringify(last)})`,
  );
}

/** REQ-451 — mark the page's element under a point (the demo's own chrome skipped) */
const markPointed = (p: { x: number; y: number }) => {
  const el = document.elementsFromPoint(p.x, p.y)
    .find((e) => !e.closest("[data-demo-overlay]"));
  el?.setAttribute("data-e2e-pointed", "");
  return !!el;
};
/** REQ-451 — true when the page's element under a point is the one marked; else what it is */
const pointedAt = (p: { x: number; y: number }) => {
  const el = document.elementsFromPoint(p.x, p.y)
    .find((e) => !e.closest("[data-demo-overlay]"));
  return el?.hasAttribute("data-e2e-pointed")
    ? true
    : el
    ? `${el.tagName}.${el.className}`
    : null;
};

/** REQ-451 — no presenter arrow on a tab for `ms` (none comes while he does not move) */
async function noArrowFor(what: string, pg: Page, ms: number) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const at = await arrowOn(pg);
    if (at) {
      throw new Error(
        `${what}: the presenter's arrow showed with no move ${
          JSON.stringify(at)
        }`,
      );
    }
    await sleep(150);
  }
}

/** REQ-645 (m36) — the stage's "now showing her other tab" notice, when it shows */
const tabNote = (pg: Page) =>
  pg.evaluate(() => {
    const el = document.querySelector("[data-cy='demo-tab-switched']");
    return el ? (el as HTMLElement).innerText.trim() : null;
  }) as Promise<string | null>;

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

/** the frame's box once it has stopped moving (the staff banner mounts after whoami, the pill's
 *  height follows its status: each moves the frame) — two reads 300 ms apart agree */
async function steadyFrame(pg: Page) {
  let last = await frameBox(pg);
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    const now = await frameBox(pg);
    if (
      Math.abs(now.x - last.x) < 0.5 && Math.abs(now.y - last.y) < 0.5 &&
      Math.abs(now.width - last.width) < 0.5 &&
      Math.abs(now.height - last.height) < 0.5
    ) return now;
    last = now;
  }
  throw new Error(`the frame never stopped moving (${JSON.stringify(last)})`);
}

Deno.test("REQ-393 (demo M8) + REQ-451 (demo M14): the cursor handed over from /admin counts only on the frame — beside it the phone shows nothing until he moves; his mouse beside the phone frame is a small marker on the phone's edge with no name tag, and the stage says so; back on the frame the arrow and the tag, the hint gone; a stage reloaded under his still mouse on the frame starts there", (t) =>
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
      await pillUp(phone);
      await until(
        "the stage shows the customer's phone (390 × 844)",
        async () => (await screenOf(page)).includes("390 × 844"),
        25_000,
      );

      // 1. REQ-451 (M14) start — the admin's mouse has not moved since the click on Demo: the
      //    phone shows no arrow — never one pinned to its edge over its controls. REQ-539
      //    AMENDMENT (m24) — /admin's hand-off is never sent, on the frame or beside it; beside
      //    it, the stage says his pointer is off their screen (it is: the Demo button's spot)
      const fb = await steadyFrame(page);
      const beside = clickedAt.x < fb.x || clickedAt.x > fb.x + fb.width ||
        clickedAt.y < fb.y || clickedAt.y > fb.y + fb.height;
      await noArrowFor(
        `M14/m24: /admin's hand-off (his mouse at ${
          JSON.stringify(clickedAt)
        }, the frame ${JSON.stringify(fb)})`,
        phone,
        2_500,
      );
      if (beside) {
        await until(
          "REQ-539: the stage's off hint for /admin's hand-off beside the frame",
          async () =>
            (await offHint(page)) ===
              "Your pointer is off Ana Torres's screen",
          10_000,
        );
      }

      // 2. M8 + REQ-451 (M14) — his mouse beside the phone frame (the stage's dark margin): a
      //    small translucent marker on the phone's left edge at the same height — no arrow, no
      //    name tag over the phone's controls, never gone — and the stage says so
      const fb2 = await steadyFrame(page);
      const besideLeft = { x: fb2.x - 140, y: fb2.y + fb2.height * 0.4 };
      await page.mouse.move(besideLeft.x - 20, besideLeft.y - 10);
      await page.mouse.move(besideLeft.x, besideLeft.y);
      await until(
        "M14: beside the frame, the small marker is on the phone's left edge at 40 % of its height — no name tag",
        async () => {
          const at = await arrowOn(phone);
          if (!at) throw new Error("no presenter pointer: it vanished");
          // where his mouse meets the frame's edge — on the frame as it is now (REQ-451: a frame
          // that moved under his still mouse moves the marker with it)
          const f = await frameBox(page);
          const want = (besideLeft.y - f.y) / f.height * 844;
          if (
            !at.off || at.tag || !at.outside || at.x > 2 ||
            Math.abs(at.y - want) > 4
          ) {
            throw new Error(
              `pointer ${JSON.stringify(at)} (want y ${want.toFixed(1)})`,
            );
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
        still !== null && still.off && !still.tag,
        `M8/M14: the marker stays on the edge while his mouse is beside the frame (${
          JSON.stringify(still)
        })`,
      );
      await page.screenshot({
        path: `${Deno.env.get("SHOTS_DIR") ?? "."}/req-393-off-frame.png`,
      }).catch(() => {});

      // 3. back on the frame: on the screen, the hint gone
      const fb3 = await steadyFrame(page);
      const onFrame = { x: fb3.x + fb3.width / 2, y: fb3.y + fb3.height / 2 };
      await page.mouse.move(onFrame.x - 10, onFrame.y - 10);
      await page.mouse.move(onFrame.x, onFrame.y);
      await until(
        "back on the frame: the arrow (with its name tag) is on the phone's screen, at its middle",
        async () => {
          const at = await arrowOn(phone);
          if (!at) throw new Error("no presenter arrow");
          if (
            at.outside || at.off || !at.tag || Math.abs(at.x - 195) > 4 ||
            Math.abs(at.y - 422) > 4
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

      // 4. REQ-451 — on the frame the hand-off counts: the stage reloads under his still mouse
      //    (a page loaded under a still mouse hears no pointer event) and the phone's arrow, gone
      //    with the old stage, is drawn afresh where it was — with no move
      const was = await arrowOn(phone);
      if (!was) throw new Error("no presenter arrow before the stage's reload");
      await phone.evaluate(() => {
        const el = Array.from(
          document.querySelectorAll("[data-cy='demo-pointer']"),
        ).find((e) => e.getAttribute("data-presenter") === "Hans");
        el?.setAttribute("data-e2e-old", "");
      });
      await page.reload();
      await page.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
      await until(
        "REQ-451: after the stage's reload the phone shows his arrow afresh where it was, with no move",
        async () => {
          const at = await arrowOn(phone);
          if (!at) throw new Error("no presenter arrow on the phone");
          if (
            at.old || at.off || at.outside || Math.abs(at.x - was.x) > 4 ||
            Math.abs(at.y - was.y) > 4
          ) {
            throw new Error(
              `arrow ${JSON.stringify(at)} (before the reload ${
                JSON.stringify(was)
              })`,
            );
          }
          return true;
        },
        25_000,
      );

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

Deno.test("REQ-539 (demo m24): a desktop customer — the click on Demo lands on the fitted frame, and her screen shows no presenter arrow until he moves; his move puts it where he points", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    const who = await people(http);
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    // the customer is on a desktop, as in pairs 7, 8 and 10
    const userCtx = await browser.newContext({
      viewport: { width: 1280, height: 720 },
    });
    try {
      const desk = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, who.user.cookie);
      await desk.goto(`${baseUrl}/dashboard`);
      await useCookie(page.context(), baseUrl, who.admin.cookie);
      const clickedAt = await openDemo(page, baseUrl, who.userPhone);
      // her app picks the demo up where she is (no reload: as in the demo, the page she is on)
      await desk.locator("[data-cy='demo-status']").waitFor({
        timeout: 30_000,
      });
      await until(
        "the stage shows the customer's desktop (1280 × 720)",
        async () => (await screenOf(page)).includes("1280 × 720"),
        25_000,
      );

      // 1. the demo's case: the Demo button's spot is ON the fitted frame (the frame covers most
      //    of the stage); the admin's mouse has not moved since the click — no arrow on her
      //    screen (it sat on her mic button), no off hint
      const fb = await steadyFrame(page);
      const onFrame = clickedAt.x >= fb.x && clickedAt.x <= fb.x + fb.width &&
        clickedAt.y >= fb.y && clickedAt.y <= fb.y + fb.height;
      if (!onFrame) {
        throw new Error(
          `the story's premise: the Demo click ${
            JSON.stringify(clickedAt)
          } should be on the desktop frame ${JSON.stringify(fb)}`,
        );
      }
      await noArrowFor(
        `m24: /admin's hand-off on the desktop frame (his mouse at ${
          JSON.stringify(clickedAt)
        })`,
        desk,
        3_000,
      );
      expect.eq(await offHint(page), null, "m24: no off hint on the frame");

      // 2. his real move puts the arrow where he points: the middle of her screen
      const mid = { x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 };
      await page.mouse.move(mid.x - 10, mid.y - 10);
      await page.mouse.move(mid.x, mid.y);
      await until(
        "m24: after his move, the arrow (with its tag) is on her screen at its middle",
        async () => {
          const at = await arrowOn(desk);
          if (!at) throw new Error("no presenter arrow");
          if (
            at.outside || at.off || !at.tag || Math.abs(at.x - 640) > 6 ||
            Math.abs(at.y - 360) > 6
          ) throw new Error(`arrow ${JSON.stringify(at)}`);
          return true;
        },
        10_000,
      );

      await page.locator("[data-cy='demo-end']").click();
      await page.locator("[data-cy='demo-end-confirm']").click().catch(
        () => {},
      );
    } finally {
      await userCtx.close();
    }
  }));

Deno.test("REQ-393 (demo M2 tab switch) + REQ-451 (demo M1) + REQ-645 (cycle 5 m36): the tab the stage leaves loses the presenter's arrow; a tab it newly follows gets none while his mouse is still, and the stage says which tab it shows; a tab followed again with its page unchanged gets back the arrow he left there; his moves reach the followed tab only", (t) =>
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
      await pillUp(tab1);
      await until(
        "the stage shows tab 1 (420 × 800)",
        async () => (await screenOf(page)).includes("420 × 800"),
        25_000,
      );
      // the presenter rests in the middle of the frame (inside tab 2's wider frame too)
      const fb = await steadyFrame(page);
      const rest = { x: fb.x + fb.width / 2, y: fb.y + fb.height / 2 };
      await page.mouse.move(rest.x - 30, rest.y - 15);
      await page.mouse.move(rest.x, rest.y);
      await until(
        "tab 1 shows the presenter's arrow",
        async () => (await arrowOn(tab1))?.outside === false,
        10_000,
      );

      // where it comes to rest (it glides from his first move to his second)
      const onTab1 = await settledArrow(tab1);
      // the element his arrow is on in tab 1 (tab 1's page stays as it is: a mark on it holds)
      expect(
        await tab1.evaluate(markPointed, onTab1),
        "tab 1 has an element under the presenter's arrow",
      );

      // 1. a second tab is the one the customer uses now: the stage follows it. REQ-451 (M1) —
      //    he pointed at tab 1's page (never the spot under his mouse over an unsettled tab 2).
      //    REQ-645 AMENDMENT (cycle 5 m36) — supersedes REQ-538's look-up of his still mouse on
      //    tab 2: no arrow there until he moves, and the stage says which tab it shows now
      const tab2 = await userCtx.newPage();
      await tab2.setViewportSize({ width: 640, height: 760 });
      await tab2.goto(`${baseUrl}/settings`);
      await pillUp(tab2);
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
        "REQ-645 (m36): the stage says it shows her other tab now, and to move to point there",
        async () =>
          (await tabNote(page)) ===
            "Now showing Ana Torres's other tab (/settings) — move to point there",
        10_000,
      );
      await noArrowFor(
        "REQ-645 (m36): the tab the stage newly follows (tab 2), his mouse still",
        tab2,
        2_500,
      );

      // 2. REQ-451 — the customer uses tab 1 again (any pointerdown claims the stage; this one
      //    changes nothing on tab 1's page, so the arrow's spot can be compared): the stage
      //    follows it back; tab 1's page is unchanged and he has not moved — the arrow he left
      //    there is back, on the same element, at the same spot
      await tab1.evaluate(() =>
        document.dispatchEvent(new PointerEvent("pointerdown"))
      );
      await until(
        "tab 1 takes the stage back (420 × 800)",
        async () => (await screenOf(page)).includes("420 × 800"),
        20_000,
      );
      await until(
        "REQ-451: tab 1, followed again with its page unchanged, gets back the arrow he left there — on the same element, with no move",
        async () => {
          const at = await arrowOn(tab1);
          if (!at || at.off) {
            throw new Error(`tab 1's arrow ${JSON.stringify(at)}`);
          }
          const under = await tab1.evaluate(pointedAt, at);
          if (
            under !== true || Math.abs(at.x - onTab1.x) > 2 ||
            Math.abs(at.y - onTab1.y) > 2
          ) {
            throw new Error(
              `tab 1's arrow ${JSON.stringify(at)} (before ${
                JSON.stringify(onTab1)
              }) is on ${under}, not the element it was on`,
            );
          }
          return true;
        },
        10_000,
      );

      // 3. tab 2 again: REQ-645 (m36) — he never pointed at tab 2's page: no arrow there with his
      //    mouse still (REQ-538 put one under it), the stage says which tab it shows; his move
      //    reaches tab 2 only
      await pillUp(tab2);
      await tab2.locator("[data-cy='demo-more']").click();
      await until(
        "a click in tab 2 takes the stage (640 × 760)",
        async () => (await screenOf(page)).includes("640 × 760"),
        20_000,
      );
      await until(
        "M2: tab 1, left, loses the arrow",
        async () => (await arrowOn(tab1)) === null,
        10_000,
      );
      await until(
        "REQ-645 (m36): the stage says it shows her other tab again",
        async () =>
          (await tabNote(page)) ===
            "Now showing Ana Torres's other tab (/settings) — move to point there",
        10_000,
      );
      await noArrowFor(
        "REQ-645 (m36): tab 2 followed again (his last arrow on tab 1's page), his mouse still",
        tab2,
        2_500,
      );
      await page.mouse.move(rest.x + 25, rest.y + 20);
      await until(
        "his move reaches tab 2",
        async () => (await arrowOn(tab2))?.off === false,
        10_000,
      );
      expect.eq(
        await tabNote(page),
        null,
        "REQ-645 (m36): he points again — the stage's tab notice is gone",
      );
      await sleep(1_500);
      expect.eq(
        await arrowOn(tab1),
        null,
        "M2: tab 1 (not followed) never gets his moves",
      );

      // 4. the customer clicks in tab 1: the stage follows it again; tab 2 loses the arrow; his
      //    last arrow was on tab 2's page — REQ-645 (m36): tab 1's page is unchanged, so it gets
      //    back the arrow he left there (kept for that page load), with his mouse still
      await pillUp(tab1);
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
        "REQ-645 (m36): tab 1, followed again with its page unchanged, gets back the arrow he left there, his mouse still",
        async () => (await arrowOn(tab1))?.off === false,
        10_000,
      );
      await page.mouse.move(rest.x, rest.y);
      await until(
        "his move reaches tab 1",
        async () => (await arrowOn(tab1))?.off === false,
        10_000,
      );
      expect(true, "the arrow follows the stage only as he points");

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
