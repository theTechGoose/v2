/**
 * REQ-437 — demo issues m3 and p8-pair3-a (demo-loop cycle 3), in two browsers: the admin
 * ("Alex") on the stage, the customer on their own pages.
 *
 *   1. m3 — the presenter rests at the CENTRE of a button of the frame (as Playwright hovers): on
 *      the customer's screen his arrow is on that button and his name tag covers none of it (it
 *      sits past the button's edge with the most room), inside the window.
 *   2. p8-pair3-a — the presenter glides from the right of the frame to its very left edge: on
 *      every painted frame of the glide, and at rest, his tag on the customer's screen is fully
 *      inside the window (never clipped to "ex"); the customer's own pointer at the left edge of
 *      their window shows on the stage with its tag inside the frame.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

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

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  body: unknown,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) {
    throw new Error(
      `POST ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
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
    await new Promise((r) => setTimeout(r, 120));
  }
  throw new Error(`timed out: ${what}${last ? ` (last error: ${last})` : ""}`);
}

type Page = StoryTools["page"];
const FRAME = "[data-cy='demo-frame']";
const VIEW = { width: 420, height: 800 };

/** the demo on the customer's account: the admin on the stage, the customer's page on `start` */
async function demoOn(
  tools: StoryTools,
  start: (q: { id: string }) => string,
) {
  const { page, expect, http, baseUrl } = tools;
  await page.setViewportSize({ width: 1280, height: 860 });
  const userPhone = `+1512${digits()}`;
  const adminPhone = `+1843${digits()}`;
  const user = await verify(http, userPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: user.auth,
    body: JSON.stringify({ language: "en", name: "Ana Torres" }),
  })).body?.cancel();
  await answerQuestions(http, user.auth, {
    name: "Ana Torres",
    businessName: "Torres Plumbing",
  });
  // the customer's own quote, sent: its public page is long enough to scroll
  const customer = await post(http, user.auth, "/api/customers", {
    name: "Hans Hansen",
    email: "hans@blackhole.postmarkapp.com",
    address: "725 Frederick Rd, Rockingham, VA",
  });
  const quote = await post(http, user.auth, "/api/quotes", {
    customerId: customer.id,
    summary: "Deck rebuild — Hans Hansen",
    jobName: "Deck rebuild",
    description:
      "Tear out and rebuild the back deck: footings, framing, decking, rails and stairs.",
    lineItems: [
      { description: "Demolition", quantity: 1, unit: "job", price: 20000 },
      { description: "Framing", quantity: 1, unit: "job", price: 40000 },
      { description: "Decking", quantity: 1, unit: "job", price: 30000 },
      {
        description: "Rails and stairs",
        quantity: 1,
        unit: "job",
        price: 10000,
      },
    ],
    estimatedTotal: 100000,
    status: "draft",
  });
  await (await http(`/api/quotes/${quote.id}`, {
    method: "PUT",
    headers: user.auth,
    body: JSON.stringify({ status: "sent" }),
  })).body?.cancel();
  const admin = await verify(http, adminPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: admin.auth,
    body: JSON.stringify({ language: "en", name: "Alex" }),
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
  const userCtx = await browser.newContext({ viewport: VIEW });
  await useCookie(userCtx, baseUrl, user.cookie);
  const userPage = await userCtx.newPage();

  // the admin opens the demo and lands on the stage
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
  await page.locator("[data-cy='demo-connecting']").waitFor({
    timeout: 15_000,
  });

  // the customer opens their start page; the stage mirrors it
  const startPath = start(quote);
  await userPage.goto(`${baseUrl}${startPath}`);
  await until(
    `the stage's mirror is on the customer's ${startPath}`,
    async () =>
      (await page.locator(FRAME).getAttribute("data-path")) === startPath,
    25_000,
  );

  // the frame's box on the stage and its scale: a stage point ↔ a point of the customer's screen
  const fb = await page.locator(FRAME).boundingBox();
  if (!fb) throw new Error("no frame box");
  const s = fb.width / VIEW.width;
  const toFrame = (p: { x: number; y: number }) => ({
    x: (p.x - fb.x) / s,
    y: (p.y - fb.y) / s,
  });
  const toStage = (p: { x: number; y: number }) => ({
    x: fb.x + p.x * s,
    y: fb.y + p.y * s,
  });

  /** the mirror's document is laid out like the customer's (its stylesheets are in) */
  const mirrorAsTall = (what: string) =>
    until(
      `${what}: the mirror is laid out like the customer's page`,
      async () => {
        const theirs = await userPage.evaluate(() =>
          document.scrollingElement?.scrollHeight ?? 0
        );
        const mine = await page.evaluate(
          `(() => { const d = document.querySelector(${
            JSON.stringify(FRAME)
          }).contentDocument; return d.scrollingElement.scrollHeight; })()`,
        ) as number;
        return Math.abs(theirs - mine) <= 2;
      },
      15_000,
    );
  return {
    userCtx,
    userPage,
    quote,
    startPath,
    toFrame,
    toStage,
    fb,
    mirrorAsTall,
  };
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}
const overlaps = (a: Box, b: Box) =>
  a.left < b.left + b.width - 0.5 && b.left < a.left + a.width - 0.5 &&
  a.top < b.top + b.height - 0.5 && b.top < a.top + a.height - 0.5;
const within = (a: Box, b: Box) =>
  a.left >= b.left - 0.5 && a.top >= b.top - 0.5 &&
  a.left + a.width <= b.left + b.width + 0.5 &&
  a.top + a.height <= b.top + b.height + 0.5;

/** a named pointer's tip and its tag's box, as drawn on that page */
const pointerAndTag = (page: Page, name: string) =>
  page.evaluate((n) => {
    const el = Array.from(document.querySelectorAll("[data-cy='demo-pointer']"))
      .find((e) => e.getAttribute("data-presenter") === n);
    if (!el) return null;
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    const tag = el.querySelector("[data-cy='demo-pointer-tag']");
    if (!tag) return null;
    const r = tag.getBoundingClientRect();
    return {
      x: m.m41,
      y: m.m42,
      outside: el.hasAttribute("data-outside"),
      side: tag.getAttribute("data-tag-side"),
      tag: { left: r.left, top: r.top, width: r.width, height: r.height },
    };
  }, name);

Deno.test("REQ-437 (demo m3): the presenter rests at the centre of a button — on the customer's screen his name tag covers none of it and stays in the window", (t) =>
  story(t, async (tools) => {
    const { page } = tools;
    const d = await demoOn(tools, (q) => `/q/${q.id}`);
    const { userPage, toStage } = d;
    try {
      await d.mirrorAsTall("the quote page");
      // a button of the customer's page, in view (the quote page's sign / accept controls)
      const btn = await userPage.evaluate(() => {
        const vw = innerWidth, vh = innerHeight;
        for (const el of Array.from(document.querySelectorAll("button, a"))) {
          if (el.closest("[data-demo-overlay]")) continue;
          const r = el.getBoundingClientRect();
          if (
            r.width >= 60 && r.height >= 28 && r.left >= 0 && r.top >= 60 &&
            r.right <= vw && r.bottom <= vh - 60
          ) {
            return {
              left: r.left,
              top: r.top,
              width: r.width,
              height: r.height,
            };
          }
        }
        return null;
      });
      if (!btn) throw new Error("no button in view on the customer's page");
      const centre = {
        x: btn.left + btn.width / 2,
        y: btn.top + btn.height / 2,
      };
      const at = toStage(centre);
      await page.mouse.move(at.x - 40, at.y - 20);
      await page.mouse.move(at.x, at.y);
      await until(
        `Alex's tag on the customer's screen is off the button ${
          JSON.stringify(btn)
        } and inside the window`,
        async () => {
          const p = await pointerAndTag(userPage, "Alex");
          if (!p) {
            throw new Error("no presenter pointer on the customer's screen");
          }
          const view = { left: 0, top: 0, width: 420, height: 800 };
          const onBtn = Math.abs(p.x - centre.x) <= 3 &&
            Math.abs(p.y - centre.y) <= 3;
          if (
            p.outside || !onBtn || overlaps(p.tag, btn) || !within(p.tag, view)
          ) {
            throw new Error(JSON.stringify(p));
          }
          return true;
        },
        10_000,
      );
    } finally {
      await d.userCtx.close();
    }
  }));

Deno.test("REQ-437 (demo p8-pair3-a): a glide to the frame's left edge never draws the presenter's tag past the customer's window; the customer's tag at their left edge stays inside the stage's frame", (t) =>
  story(t, async (tools) => {
    const { page, expect } = tools;
    const d = await demoOn(tools, () => "/customers");
    const { userPage, toStage, fb } = d;
    try {
      await d.mirrorAsTall("the customers page");
      // 1. the presenter rests on the right of the frame
      const r = toStage({ x: 380, y: 400 });
      await page.mouse.move(r.x - 10, r.y);
      await page.mouse.move(r.x, r.y);
      await until("Alex's arrow rests on the right", async () => {
        const p = await pointerAndTag(userPage, "Alex");
        return !!p && Math.abs(p.x - 380) <= 2;
      });
      // 2. sample his tag on every painted frame of the customer's page while he glides left
      await userPage.evaluate(() => {
        const w = globalThis as unknown as { __tagMin: number; __tagN: number };
        w.__tagMin = Infinity;
        w.__tagN = 0;
        const t0 = performance.now();
        const tick = () => {
          const el = Array.from(
            document.querySelectorAll("[data-cy='demo-pointer']"),
          )
            .find((e) => e.getAttribute("data-presenter") === "Alex");
          const tag = el?.querySelector("[data-cy='demo-pointer-tag']");
          if (tag) {
            w.__tagMin = Math.min(w.__tagMin, tag.getBoundingClientRect().left);
            w.__tagN++;
          }
          if (performance.now() - t0 < 2_500) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      const l = toStage({ x: 1, y: 400 });
      await page.mouse.move(l.x, l.y);
      await until("Alex's arrow rests at the left edge", async () => {
        const p = await pointerAndTag(userPage, "Alex");
        return !!p && p.x <= 3;
      });
      await userPage.waitForTimeout(2_600);
      const sampled = await userPage.evaluate(() => {
        const w = globalThis as unknown as { __tagMin: number; __tagN: number };
        return { min: w.__tagMin, n: w.__tagN };
      });
      expect(
        sampled.n > 10,
        `the tag was sampled on many frames (${sampled.n})`,
      );
      expect(
        sampled.min >= -0.5,
        `the tag's left edge never left the window during the glide (min ${sampled.min})`,
      );
      const rest = await pointerAndTag(userPage, "Alex");
      expect(
        !!rest && rest.tag.left >= -0.5 && rest.tag.width > 20,
        `at rest the whole tag shows: ${JSON.stringify(rest)}`,
      );

      // 3. the customer's own pointer at the left edge of their window, on the stage
      await userPage.mouse.move(40, 300);
      await userPage.mouse.move(1, 300);
      await until(
        "the customer's tag on the stage is inside the frame",
        async () => {
          const p = await pointerAndTag(page, "Ana Torres");
          if (!p) throw new Error("no customer pointer on the stage");
          const frame = {
            left: fb.x,
            top: fb.y,
            width: fb.width,
            height: fb.height,
          };
          if (p.x > fb.x + 3 || !within(p.tag, frame)) {
            throw new Error(
              `${JSON.stringify(p)} · frame ${JSON.stringify(frame)}`,
            );
          }
          return true;
        },
        10_000,
      );
    } finally {
      await d.userCtx.close();
    }
  }));

/** REQ-543 — the distance from the tip to the nearest point of the tag */
const reachOf = (p: { x: number; y: number }, t: Box) =>
  Math.hypot(
    Math.max(t.left - p.x, 0, p.x - (t.left + t.width)),
    Math.max(t.top - p.y, 0, p.y - (t.top + t.height)),
  );

Deno.test("REQ-543 (demo m6, cycle 4): the presenter's tag sits next to his arrow (≤ 40 px), off the button and every other control, and 4 px clear of the window's right edge", (t) =>
  story(t, async (tools) => {
    const { page } = tools;
    const d = await demoOn(tools, (q) => `/q/${q.id}`);
    const { userPage, toStage } = d;
    const view = { left: 0, top: 0, width: VIEW.width, height: VIEW.height };
    try {
      await d.mirrorAsTall("the quote page");
      // 1. at rest on the centre of a button of the customer's page
      const btn = await userPage.evaluate(() => {
        const vw = innerWidth, vh = innerHeight;
        for (const el of Array.from(document.querySelectorAll("button, a"))) {
          if (el.closest("[data-demo-overlay]")) continue;
          const r = el.getBoundingClientRect();
          if (
            r.width >= 60 && r.height >= 28 && r.left >= 0 && r.top >= 60 &&
            r.right <= vw && r.bottom <= vh - 60
          ) {
            return {
              left: r.left,
              top: r.top,
              width: r.width,
              height: r.height,
            };
          }
        }
        return null;
      });
      if (!btn) throw new Error("no button in view on the customer's page");
      const centre = {
        x: btn.left + btn.width / 2,
        y: btn.top + btn.height / 2,
      };
      const at = toStage(centre);
      await page.mouse.move(at.x - 40, at.y - 20);
      await page.mouse.move(at.x, at.y);
      await until(
        `Alex's tag is within 40 px of his arrow on ${
          JSON.stringify(btn)
        }, off it and off every other control, inside the window`,
        async () => {
          const p = await pointerAndTag(userPage, "Alex");
          if (!p) {
            throw new Error("no presenter pointer on the customer's screen");
          }
          const onBtn = Math.abs(p.x - centre.x) <= 3 &&
            Math.abs(p.y - centre.y) <= 3;
          // the tag is pointer-events:none: the hit-test sees the page under it
          const other = await userPage.evaluate(
            ({ r, tip }) => {
              const sel =
                "button,a[href],input,select,textarea,summary,label,[role=button],[role=link],[role=option],[role=tab],[role=radio],[role=checkbox],[role=menuitem]";
              const pts = [
                [r.left + r.width / 2, r.top + r.height / 2],
                [r.left + 2, r.top + 2],
                [r.left + r.width - 2, r.top + 2],
                [r.left + 2, r.top + r.height - 2],
                [r.left + r.width - 2, r.top + r.height - 2],
              ];
              for (const [x, y] of pts) {
                const c = document.elementFromPoint(x, y)?.closest(sel);
                if (!c) continue;
                const b = c.getBoundingClientRect();
                const holdsTip = tip.x >= b.left && tip.x <= b.right &&
                  tip.y >= b.top && tip.y <= b.bottom;
                if (!holdsTip) return c.outerHTML.slice(0, 80);
              }
              return null;
            },
            { r: p.tag, tip: { x: p.x, y: p.y } },
          );
          const reach = reachOf(p, p.tag);
          if (
            p.outside || !onBtn || overlaps(p.tag, btn) || reach > 40.5 ||
            other !== null ||
            !within(p.tag, {
              left: 4,
              top: 4,
              width: view.width - 8,
              height: view.height - 8,
            })
          ) {
            throw new Error(JSON.stringify({ ...p, reach, other }));
          }
          return true;
        },
        10_000,
      );
      // 2. pair 3: 'my Alex tag runs off the right edge (x 350–390)' — at the frame's right edge
      const r = toStage({ x: VIEW.width - 2, y: 300 });
      await page.mouse.move(r.x - 30, r.y);
      await page.mouse.move(r.x, r.y);
      await until(
        "Alex's tag at the window's right edge is 4 px clear of it",
        async () => {
          const p = await pointerAndTag(userPage, "Alex");
          if (!p || Math.abs(p.x - (VIEW.width - 2)) > 3) {
            throw new Error(`not there yet: ${JSON.stringify(p)}`);
          }
          if (p.tag.left + p.tag.width > view.width - 4 + 0.5) {
            throw new Error(`flush: ${JSON.stringify(p)}`);
          }
          return true;
        },
        10_000,
      );
    } finally {
      await d.userCtx.close();
    }
  }));
