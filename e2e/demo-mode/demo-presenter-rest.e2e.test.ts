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
      await phone.locator("[data-cy='demo-status']").waitFor({
        timeout: 20_000,
      });
      await until(
        "the stage shows the customer's phone (390 × 844)",
        async () => (await screenOf(page)).includes("390 × 844"),
        25_000,
      );

      // 1. REQ-451 (M14) start — the admin's mouse has not moved since the click on Demo. The
      //    hand-off counts only on the frame: beside it (the Demo button at the right of the row)
      //    the phone shows no arrow — never one pinned to its edge over its controls — and the
      //    stage does not say his pointer is off their screen; on it, the arrow is there at once
      const fb = await steadyFrame(page);
      const beside = clickedAt.x < fb.x || clickedAt.x > fb.x + fb.width ||
        clickedAt.y < fb.y || clickedAt.y > fb.y + fb.height;
      if (beside) {
        await noArrowFor(
          `M14: the hand-off beside the frame (his mouse at ${
            JSON.stringify(clickedAt)
          }, the frame ${JSON.stringify(fb)})`,
          phone,
          2_500,
        );
        expect.eq(
          await offHint(page),
          null,
          "M14: no off-screen hint for a hand-off beside the frame",
        );
      } else {
        await until(
          `the hand-off on the frame: the presenter's arrow reaches the phone with no move (his mouse at ${
            JSON.stringify(clickedAt)
          })`,
          async () => (await arrowOn(phone))?.off === false,
          15_000,
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

Deno.test("REQ-393 (demo M2 tab switch) + REQ-451 (demo M1) + REQ-538 (cycle 4 M1): the tab the stage leaves loses the presenter's arrow; a tab it newly follows gets it with his mouse still once its mirror has settled; a tab followed again with its page unchanged gets back the arrow he left there; his moves reach the followed tab only", (t) =>
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
      //    REQ-538 (cycle 4 M1): once tab 2's mirror has settled, his still mouse is looked up
      //    again — tab 2 gets the arrow with no move
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
        "REQ-538: the tab the stage newly follows (tab 2) gets the arrow with his mouse still",
        async () => (await arrowOn(tab2))?.off === false,
        10_000,
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

      // 3. tab 2 again: REQ-538 — the arrow comes back with his mouse still; his move reaches
      //    tab 2 only
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
        "REQ-538: tab 2 followed again (his last arrow on tab 1's page) gets the arrow with his mouse still",
        async () => (await arrowOn(tab2))?.off === false,
        10_000,
      );
      await page.mouse.move(rest.x + 25, rest.y + 20);
      await until(
        "his move reaches tab 2",
        async () => (await arrowOn(tab2))?.off === false,
        10_000,
      );
      await sleep(1_500);
      expect.eq(
        await arrowOn(tab1),
        null,
        "M2: tab 1 (not followed) never gets his moves",
      );

      // 4. the customer clicks in tab 1: the stage follows it again; tab 2 loses the arrow; his
      //    last arrow was on tab 2's page — REQ-538: tab 1 gets it back with his mouse still
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
        "REQ-538: tab 1 (his last arrow on tab 2's page) gets the arrow with his mouse still",
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
