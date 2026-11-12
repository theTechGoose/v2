/**
 * REQ-633 — demo-loop cycle 5 (run r37f88707), issues m2, m35 and the cycle-4 backlog c4-S12b, in
 * two browsers: the admin ("Alex") on the stage, the customer on their own pages.
 *
 *   1. m35 — the customer is on /dashboard with the first-visit coach mark open (its 74 % dark
 *      scrim over the page). The presenter rests over the scrim: on the customer's screen his
 *      arrow is drawn ABOVE the coach mark (the stacking: the arrow's z-index beats the coach
 *      mark's, and a pixel sample of the arrow's fill is his full colour, not the scrim's dark),
 *      and his resting tag is fully opaque — its pixels are his colour, not darkened — shrunk to
 *      his initial.
 *   2. m2 / c4-S12b — the presenter rests on a button of the customer's quote page: his tag hides
 *      no text and no other control of the page under it (hit-tested at its sample points
 *      against the laid-out text boxes).
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
  view: { width: number; height: number } = VIEW,
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
  const userCtx = await browser.newContext({ viewport: view });
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
  let seenPath: string | null = null;
  await until(
    `the stage's mirror is on the customer's ${startPath}`,
    async () => {
      seenPath = await page.locator(FRAME).getAttribute("data-path");
      if (seenPath !== startPath) {
        throw new Error(
          `the frame shows ${seenPath}, the customer is on ${
            new URL(userPage.url()).pathname
          }`,
        );
      }
      return true;
    },
    40_000,
  );

  // the frame's box on the stage and its scale: a stage point ↔ a point of the customer's screen
  const fb = await page.locator(FRAME).boundingBox();
  if (!fb) throw new Error("no frame box");
  const s = fb.width / view.width;
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

/** the pixel colour at (x, y) of a page, from a real screenshot (what the user sees) */
async function pixel(p: Page, x: number, y: number) {
  const png = await p.screenshot({
    clip: { x: Math.round(x) - 1, y: Math.round(y) - 1, width: 3, height: 3 },
  });
  let bin = "";
  for (const b of new Uint8Array(png)) bin += String.fromCharCode(b);
  const b64 = btoa(bin);
  return await p.evaluate(async (data) => {
    const blob = await (await fetch(`data:image/png;base64,${data}`)).blob();
    const bmp = await createImageBitmap(blob);
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const g = c.getContext("2d")!;
    g.drawImage(bmp, 0, 0);
    const [r, gg, b] = g.getImageData(
      Math.floor(bmp.width / 2),
      Math.floor(bmp.height / 2),
      1,
      1,
    ).data;
    return { r, g: gg, b };
  }, b64);
}
const hex = (h: string) => {
  const m = h.replace("#", "");
  return {
    r: parseInt(m.slice(0, 2), 16),
    g: parseInt(m.slice(2, 4), 16),
    b: parseInt(m.slice(4, 6), 16),
  };
};
const rgbOf = (css: string) => {
  const m = css.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  return m ? { r: +m[1], g: +m[2], b: +m[3] } : hex(css);
};
const near = (
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
  tol = 28,
) =>
  Math.abs(a.r - b.r) <= tol && Math.abs(a.g - b.g) <= tol &&
  Math.abs(a.b - b.b) <= tol;

Deno.test("REQ-633 (demo m35, cycle 5): over the dashboard's coach mark the presenter's arrow and resting tag are drawn above its dark scrim, in full colour", (t) =>
  story(t, async (tools) => {
    const { page, expect } = tools;
    // a desktop window: on a phone the coach mark is skipped (its spotlight is in the drawer)
    const d = await demoOn(tools, () => "/dashboard", {
      width: 1280,
      height: 800,
    });
    const { userPage, toStage } = d;
    try {
      const coach = userPage.locator("[role='dialog'][aria-label]").first();
      await coach.waitFor({ state: "visible", timeout: 15_000 });
      // a spot of the customer's screen under the scrim (not in its spotlight hole)
      const spot = { x: 640, y: 520 };
      const at = toStage(spot);
      await page.mouse.move(at.x - 30, at.y - 10);
      await page.mouse.move(at.x, at.y);
      let tip = spot;
      await until(
        "Alex's arrow rests over the scrim, his tag resting",
        async () => {
          const p = await pointerAndTag(userPage, "Alex");
          const idle = await userPage.evaluate(() =>
            Array.from(document.querySelectorAll("[data-cy='demo-pointer']"))
              .find((e) => e.getAttribute("data-presenter") === "Alex")
              ?.getAttribute("data-idle") ?? null
          );
          // the stage maps a 1280-wide window into its frame: the point lands within a few dozen px
          if (
            !p || Math.abs(p.x - spot.x) > 40 || Math.abs(p.y - spot.y) > 40 ||
            idle !== "1"
          ) {
            throw new Error(JSON.stringify({ p, idle }));
          }
          tip = { x: p.x, y: p.y };
          return true;
        },
        20_000,
      );
      // the tag has rested for 600 ms without a re-placement (past its .3 s transition)
      await userPage.evaluate(() =>
        new Promise<void>((done, fail) => {
          const t0 = performance.now();
          let since = -1;
          const tick = () => {
            const idle = Array.from(
              document.querySelectorAll("[data-cy='demo-pointer']"),
            ).find((e) => e.getAttribute("data-presenter") === "Alex")
              ?.getAttribute("data-idle") === "1";
            const now = performance.now();
            if (!idle) since = -1;
            else if (since < 0) since = now;
            if (since >= 0 && now - since >= 600) return done();
            if (now - t0 > 20_000) {
              return fail(new Error("the tag never rested"));
            }
            setTimeout(tick, 40);
          };
          tick();
        })
      );
      // the coach mark is still open over the page, its scrim painted
      expect(await coach.isVisible(), "the coach mark is still open");
      const seen = await userPage.evaluate(() => {
        const el = Array.from(
          document.querySelectorAll("[data-cy='demo-pointer']"),
        )
          .find((e) =>
            e.getAttribute("data-presenter") === "Alex"
          ) as HTMLElement;
        const tag = el.querySelector(
          "[data-cy='demo-pointer-tag']",
        ) as HTMLElement;
        const coach = document.querySelector(
          "[role='dialog'][aria-label]",
        ) as HTMLElement;
        const fill = el.querySelectorAll("svg path")[1]?.getAttribute("fill") ??
          "";
        const r = tag.getBoundingClientRect();
        // the stacking: every ancestor of the pointer up to the body, none a stacking context
        // below the coach mark's 9999
        const z = Number(getComputedStyle(el).zIndex);
        return {
          idle: el.getAttribute("data-idle"),
          // declared (what it settles at) and computed (what is painted now)
          tagDeclared: tag.style.opacity || "1",
          fill,
          tagBg: getComputedStyle(tag).backgroundColor,
          tagOpacity: getComputedStyle(tag).opacity,
          tagText: (tag.textContent ?? "").trim(),
          compact: tag.hasAttribute("data-compact"),
          tag: { left: r.left, top: r.top, width: r.width, height: r.height },
          z,
          coachZ: Number(getComputedStyle(coach).zIndex),
          // the scrim is under this point: the page's own hit-test (pointer-events:none layers
          // aside) lands in the page, and the coach mark covers it
          coachCovers: (() => {
            const b = coach.getBoundingClientRect();
            return b.left <= 640 && b.right >= 640 && b.top <= 520 &&
              b.bottom >= 520;
          })(),
          stack: document.elementsFromPoint(r.left + 4, r.top + r.height / 2)
            .slice(0, 4).map((e) => e.tagName.toLowerCase()),
        };
      });
      expect(seen.coachCovers, "the coach mark's scrim spans the arrow's spot");
      expect(
        seen.z > seen.coachZ,
        `the pointer's z-index (${seen.z}) is above the coach mark's (${seen.coachZ})`,
      );
      const saw = JSON.stringify(seen);
      expect.eq(seen.idle, "1", `sampled at rest: ${saw}`);
      expect.eq(
        seen.tagDeclared,
        "1",
        `the resting tag is declared fully opaque: ${saw}`,
      );
      expect.eq(
        seen.tagOpacity,
        "1",
        `the resting tag is painted fully opaque: ${saw}`,
      );
      expect(seen.compact, `the resting tag is compact: ${saw}`);
      expect.eq(seen.tagText, "A", "the resting tag shows Alex's initial");
      // pixels: the arrow's fill (inside its body, 6.5 × 13 px from the tip) is Alex's colour
      const colour = rgbOf(seen.fill);
      const arrowPx = await pixel(userPage, tip.x + 6.5, tip.y + 13);
      expect(
        near(arrowPx, colour),
        `the arrow's fill pixel ${JSON.stringify(arrowPx)} is Alex's colour ${
          JSON.stringify(colour)
        } (not darkened by the scrim)`,
      );
      const bg = rgbOf(seen.tagBg);
      const tagPx = await pixel(
        userPage,
        seen.tag.left + 4,
        seen.tag.top + seen.tag.height / 2,
      );
      expect(
        near(tagPx, bg),
        `the resting tag's pixel ${JSON.stringify(tagPx)} is its full colour ${
          JSON.stringify(bg)
        } (stack under it: ${seen.stack.join(" > ")})`,
      );
    } finally {
      await d.userCtx.close();
    }
  }));

Deno.test("REQ-633 (demo m2 + c4-S12b, cycle 5): the presenter rests on a button of the quote page — his tag hides no text and no other control", (t) =>
  story(t, async (tools) => {
    const { page } = tools;
    const d = await demoOn(tools, (q) => `/q/${q.id}`);
    const { userPage, toStage } = d;
    try {
      await d.mirrorAsTall("the quote page");
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
      // the line of copy right above it ('started!' over the 'I know my price' chip), 8 px up
      await userPage.evaluate((b) => {
        const p = document.createElement("p");
        p.setAttribute("data-cy", "req633-line");
        p.textContent = "Great — let's get you started! Pick how you price";
        p.setAttribute(
          "style",
          `position:fixed;left:0;width:100vw;top:${
            b.top - 8 - 20
          }px;height:20px;margin:0;font:14px/20px sans-serif;text-align:center;background:#fff;color:#111;z-index:1000`,
        );
        document.body.appendChild(p);
      }, btn);
      const centre = {
        x: btn.left + btn.width / 2,
        y: btn.top + btn.height / 2,
      };
      const at = toStage(centre);
      await page.mouse.move(at.x - 40, at.y - 20);
      await page.mouse.move(at.x, at.y);
      for (const phase of ["arrived", "resting"] as const) {
        await until(
          `${phase}: Alex's tag on ${
            JSON.stringify(btn)
          } hides no text and no other control`,
          async () => {
            const p = await pointerAndTag(userPage, "Alex");
            if (!p) {
              throw new Error("no presenter pointer on the customer's screen");
            }
            if (Math.abs(p.x - centre.x) > 8 || Math.abs(p.y - centre.y) > 8) {
              throw new Error(`not there yet: ${JSON.stringify(p)}`);
            }
            const hidden = await userPage.evaluate(({ r, tip, phase }) => {
              const el = Array.from(
                document.querySelectorAll("[data-cy='demo-pointer']"),
              )
                .find((e) => e.getAttribute("data-presenter") === "Alex");
              // first as soon as he is there (whole name, or already resting), then at rest
              if (
                phase === "resting" && el?.getAttribute("data-idle") !== "1"
              ) {
                return "phase";
              }
              const sel =
                "button,a[href],input,select,textarea,summary,label,[role=button],[role=link],[role=option],[role=tab],[role=radio],[role=checkbox],[role=menuitem]";
              const xs = [
                r.left + 2,
                r.left + r.width / 2,
                r.left + r.width - 2,
              ];
              const ys = [
                r.top + 2,
                r.top + r.height / 2,
                r.top + r.height - 2,
              ];
              for (const y of ys) {
                for (const x of xs) {
                  const hit = document.elementFromPoint(x, y);
                  if (!hit) continue;
                  const c = hit.closest(sel);
                  if (c) {
                    const b = c.getBoundingClientRect();
                    const holdsTip = tip.x >= b.left && tip.x <= b.right &&
                      tip.y >= b.top && tip.y <= b.bottom;
                    if (!holdsTip) return `control ${c.outerHTML.slice(0, 80)}`;
                  }
                  // a laid-out text box under the point
                  const range = document.createRange();
                  for (const n of Array.from(hit.childNodes)) {
                    if (n.nodeType !== 3 || !(n.textContent ?? "").trim()) {
                      continue;
                    }
                    range.selectNodeContents(n);
                    for (const tb of Array.from(range.getClientRects())) {
                      if (
                        x >= tb.left && x <= tb.right && y >= tb.top &&
                        y <= tb.bottom
                      ) {
                        return `text "${
                          (n.textContent ?? "").trim().slice(0, 40)
                        }"`;
                      }
                    }
                  }
                }
              }
              return null;
            }, { r: p.tag, tip: { x: p.x, y: p.y }, phase });
            if (hidden === "phase") return false;
            if (hidden) throw new Error(`${hidden} under ${JSON.stringify(p)}`);
            return true;
          },
          10_000,
        );
      }
    } finally {
      await d.userCtx.close();
    }
  }));
