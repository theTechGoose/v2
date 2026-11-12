/**
 * REQ-153 + REQ-179 + REQ-180 + REQ-181 + REQ-187 + REQ-188 — demo mode end to end on the real
 * shell, two browsers: the super admin clicks Demo on a user's row on /admin and their browser
 * lands AT ONCE on the stage (/demo/stage), as the user, the pill waiting for the user's app; End
 * while waiting clears the user's pill. Again: the user's own browser joins on its own (no
 * prompt), both connect; the stage's frame is the user's exact viewport (420 × 800), on the user's
 * page, with no banner and no demo pill inside, the same layout pixel for pixel; the presenter's
 * pointer and click wave land on the user's screen at the same fraction and the user's pointer
 * glides onto the frame; the user scrolls, opens the drawer, changes page and pans the map — the
 * frame follows each; End from the presenter clears both and hands the presenter their own
 * account back.
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

/** wait for a condition, polling; throws with `what` when it never comes */
async function until(
  what: string,
  cond: () => boolean | Promise<boolean>,
  timeout = 10_000,
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

type Box = { x: number; y: number; width: number; height: number };
/** an element's box, evaluated in its own page (no closure — Playwright serialises the function) */
const rectOf = (el: Element) => {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, width: r.width, height: r.height };
};

Deno.test("REQ-153 + REQ-179 + REQ-180 + REQ-181 + REQ-187 + REQ-188: the admin clicks Demo on /admin — Opening… at once — and lands on the stage at once, waiting; End clears the user's pill; again, the user's app joins on its own and both connect; the frame is the user's exact screen; the presenter's pointer and click wave land on the user's screen; the user's move glides onto the frame; scroll, drawer, page and map follow; End clears both", (t) =>
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
    expect.eq(
      boot.status,
      200,
      "the admin phone is bootstrapped as a super admin",
    );
    await boot.body?.cancel();

    // the user's browser: its own context, a phone, already on the dashboard
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 420, height: 800 },
    });
    try {
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await userPage.goto(`${baseUrl}/dashboard`);

      // 1. the admin clicks Demo on the user's row and lands AT ONCE on the stage, as the user, waiting
      await useCookie(page.context(), baseUrl, admin.cookie);
      await page.goto("/admin");
      await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
      await page.locator("[data-cy='adm-search']").click();
      await page.locator("[data-cy='adm-demo']").first().waitFor({
        timeout: 15_000,
      });
      const customerPath = new URL(userPage.url()).pathname;
      // REQ-179 — instant feedback: with the server's answer held back, the button and the pill
      // already say Opening… before anything comes back; then the hold is released
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      const continued = new Promise<void>((resolve) => {
        void page.route("**/api/demo-mode/sessions", async (route) => {
          await held;
          await route.continue();
          resolve();
        }, { times: 1 });
      });
      await page.locator("[data-cy='adm-demo']").first().click();
      await page.locator("[data-cy='demo-opening']").waitFor({
        timeout: 1_000,
      });
      expect.eq(
        (await page.locator("[data-cy='adm-demo']").first().innerText()).trim(),
        "Opening…",
        "the button says so at once",
      );
      expect.eq(
        new URL(page.url()).pathname,
        "/admin",
        "nothing has moved yet — the answer is still held",
      );
      release();
      await continued;
      await page.waitForURL((u) => u.pathname === "/demo/stage", {
        timeout: 20_000,
      });
      await page.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
      await expect.see("Waiting for Ana Torres to accept");
      // REQ-153 AMENDMENT — same screen at once: the frame already shows the customer's page
      await until(
        "the frame shows the customer's last reported page",
        () => {
          const f = page.frame({ name: FRAME });
          return !!f && new URL(f.url()).pathname === customerPath;
        },
        15_000,
      );

      // 2a. End while waiting: the user's pill goes away on its own, the admin is back on /admin
      await userPage.reload();
      await userPage.locator("[data-cy='demo-pill']").waitFor({
        timeout: 15_000,
      });
      // REQ-235 — End asks first: End, then Yes
      await page.locator("[data-cy='demo-end']").click();
      await page.locator("[data-cy='demo-end-confirm']").click();
      await userPage.locator("[data-cy='demo-pill']").waitFor({
        state: "hidden",
        timeout: 15_000,
      });
      await page.waitForURL(/\/admin/, { timeout: 20_000 });
      await page.locator("[data-cy='adm-q']").waitFor({ timeout: 20_000 });

      // 2b. again — the customer's app joins on its own, nothing to accept (AMENDMENT — auto-join)
      await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
      await page.locator("[data-cy='adm-search']").click();
      await page.locator("[data-cy='adm-demo']").first().waitFor({
        timeout: 15_000,
      });
      await page.locator("[data-cy='adm-demo']").first().click();
      await page.waitForURL((u) => u.pathname === "/demo/stage", {
        timeout: 20_000,
      });
      await userPage.reload();
      await userPage.locator("[data-cy='demo-status']").waitFor({
        timeout: 15_000,
      });
      expect.eq(
        await userPage.locator("[data-cy='demo-accept']").count(),
        0,
        "the customer is never asked to accept",
      );
      expect(
        (await userPage.locator("[data-cy='demo-pill']").innerText()).includes(
          "Hans is guiding you",
        ),
        "the customer's pill names the presenter",
      );
      await page.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
      await expect.see("Guiding Ana Torres");
      await page.locator("[data-cy='demo-status']").filter({
        hasText: /direct|relay/,
      }).waitFor({ timeout: 20_000 });
      await userPage.locator("[data-cy='demo-status']").filter({
        hasText: /direct|relay/,
      }).waitFor({ timeout: 20_000 });

      // REQ-181 — the staff page has the impersonation banner; the stage starts below it
      const room = await page.evaluate(() => {
        const b = document.querySelector("[data-demo-skip]")
          ?.getBoundingClientRect();
        const s = document.querySelector("[data-cy='demo-stage']")
          ?.getBoundingClientRect();
        return {
          bannerBottom: b ? b.bottom : null,
          stageTop: s ? s.top : null,
        };
      });
      expect(
        room.bannerBottom !== null && room.stageTop !== null &&
          room.stageTop >= room.bannerBottom - 0.5,
        `REQ-181: the stage (top ${room.stageTop}) starts below the banner (bottom ${room.bannerBottom})`,
      );

      // 3. REQ-187 — the frame IS the user's screen: the user's exact viewport, on the user's page,
      //    no banner and no demo pill inside it, and the same layout
      const frameEl = page.locator("[data-cy='demo-frame']");
      await until(
        "the frame is sized to the user's viewport",
        async () =>
          (await frameEl.getAttribute("width")) === "420" &&
          (await frameEl.getAttribute("height")) === "800",
        15_000,
      );
      const frame = () => {
        const f = page.frame({ name: FRAME });
        if (!f) throw new Error("no replica frame on the stage");
        return f;
      };
      await until(
        "the frame is on the user's page",
        () => new URL(frame().url()).pathname === customerPath,
        15_000,
      );
      const link = "[data-legal-link='privacy']";
      await frame().locator(link).waitFor({ timeout: 15_000 });
      const inner = await frame().evaluate(() => ({
        w: innerWidth,
        h: innerHeight,
        banner: document.querySelectorAll("[data-demo-skip]").length,
        pill: document.querySelectorAll("[data-cy='demo-pill']").length,
        overlay: document.querySelectorAll("[data-demo-overlay]").length,
        sb: document.querySelector(".sb")?.getBoundingClientRect().width,
      }));
      expect.eq(
        inner.w,
        420,
        "REQ-187: the frame's layout viewport is the user's width",
      );
      expect.eq(inner.h, 800, "REQ-187: … and height");
      expect.eq(
        inner.banner,
        0,
        "REQ-187: no impersonation banner inside the frame",
      );
      expect.eq(
        inner.pill,
        0,
        "REQ-187: no demo pill inside the frame (it runs no demo of its own)",
      );
      const usb = await userPage.evaluate(() =>
        document.querySelector(".sb")?.getBoundingClientRect().width
      );
      expect.eq(
        inner.sb,
        usb,
        "REQ-187: the sidebar is the same width on both",
      );

      // the user scrolls the privacy link into view; the frame scrolls the same element the same
      // amount, so the link sits at the same place in both. The page's scroller is whatever
      // scrolls the link (an inner panel, or the window).
      const scrollOf = (el: Element) => {
        let n: HTMLElement | null = el.parentElement;
        while (n) {
          const oy = getComputedStyle(n).overflowY;
          if (
            (oy === "auto" || oy === "scroll") &&
            n.scrollHeight > n.clientHeight + 1
          ) return n.scrollTop;
          n = n.parentElement;
        }
        return scrollY;
      };
      await userPage.locator(link).scrollIntoViewIfNeeded();
      const ub = await userPage.locator(link).evaluate(rectOf) as Box;
      await until(
        "the frame's privacy link sits where the user's does",
        async () => {
          const fb = await frame().locator(link).evaluate(rectOf) as Box;
          return Math.abs(fb.x - ub.x) <= 1 && Math.abs(fb.y - ub.y) <= 1 &&
            Math.abs(fb.width - ub.width) <= 1;
        },
        10_000,
      );
      const fscroll = await frame().locator(link).evaluate(scrollOf);
      const uscroll = await userPage.locator(link).evaluate(scrollOf);
      expect(
        Math.abs(fscroll - uscroll) <= 1,
        `REQ-187: the frame's scroller sits like the user's (${fscroll} vs ${uscroll})`,
      );

      // the frame's box on the stage and its scale: a point inside the frame projects onto the stage
      const fb = await frameEl.boundingBox();
      if (!fb) throw new Error("no frame box");
      const s = fb.width / 420;
      expect(
        Math.abs(fb.height / 800 - s) < 0.01,
        `REQ-187: the frame keeps the user's aspect (scale ${s.toFixed(3)})`,
      );
      const project = (p: { x: number; y: number }) => ({
        x: fb.x + p.x * s,
        y: fb.y + p.y * s,
      });
      const pointerAt = (pg: typeof page | typeof userPage) =>
        pg.locator("[data-cy='demo-pointer']").evaluate((el) => {
          const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
          return { x: m.m41, y: m.m42 };
        });
      const inside = (at: { x: number; y: number }, b: Box, tol = 1.5) =>
        at.x >= b.x - tol && at.x <= b.x + b.width + tol &&
        at.y >= b.y - tol && at.y <= b.y + b.height + tol;

      // 4. REQ-188 — the presenter rests over the frame's privacy link: the user's pointer sits on
      //    the user's privacy link; a click there is a wave on the user's screen, never an action
      const flink = await frame().locator(link).evaluate(rectOf) as Box;
      const target = project({
        x: flink.x + flink.width / 2,
        y: flink.y + flink.height / 2,
      });
      await page.mouse.move(target.x - 40, target.y - 20);
      await page.mouse.move(target.x, target.y);
      await userPage.locator("[data-cy='demo-pointer']").waitFor({
        timeout: 10_000,
      });
      await new Promise((r) => setTimeout(r, 500));
      const uAt = await pointerAt(userPage);
      expect(
        inside(uAt, ub),
        `REQ-188: presenter over the frame's privacy link → the user's pointer (${
          uAt.x.toFixed(1)
        },${uAt.y.toFixed(1)}) sits on the user's link ${JSON.stringify(ub)}`,
      );
      await page.mouse.click(target.x, target.y);
      await userPage.locator("[data-cy='demo-wave']").waitFor({
        timeout: 10_000,
      });
      expect.eq(
        new URL(page.url()).pathname,
        "/demo/stage",
        "the presenter's click was a wave, not an action (the stage stayed)",
      );
      expect.eq(
        new URL(frame().url()).pathname,
        customerPath,
        "… and the frame did not navigate",
      );
      expect.eq(
        new URL(userPage.url()).pathname,
        customerPath,
        "… nor did the user's page",
      );

      // 5. REQ-188 + REQ-180 — the user sweeps to their privacy link: the presenter's pointer GLIDES
      //    (many positions, never a step back) and rests on the frame's privacy link
      const endX = ub.x + ub.width / 2;
      const endY = ub.y + ub.height / 2;
      const startX = Math.max(20, endX - 310);
      const stepX = (endX - 80 - startX) / 29;
      await userPage.mouse.move(startX, endY);
      await userPage.mouse.move(startX + 1, endY);
      await page.locator("[data-cy='demo-pointer']").waitFor({
        timeout: 10_000,
      });
      await page.evaluate(() => {
        const w = globalThis as unknown as {
          __pmXs: number[];
          __pmStop: boolean;
        };
        w.__pmXs = [];
        w.__pmStop = false;
        const tick = () => {
          const el = document.querySelector("[data-cy='demo-pointer']");
          if (el) {
            const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
            w.__pmXs.push(m.m41);
          }
          if (!w.__pmStop) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
      for (let i = 1; i <= 29; i++) {
        await userPage.mouse.move(startX + i * stepX, endY);
        await new Promise((r) => setTimeout(r, 8));
      }
      await new Promise((r) => setTimeout(r, 60));
      await userPage.mouse.move(endX - 79, endY);
      await userPage.mouse.move(endX, endY);
      await new Promise((r) => setTimeout(r, 600));
      const xs = await page.evaluate(() => {
        const w = globalThis as unknown as {
          __pmXs: number[];
          __pmStop: boolean;
        };
        w.__pmStop = true;
        return w.__pmXs;
      });
      const distinct = new Set(xs.map((x) => Math.round(x * 10))).size;
      expect(
        distinct >= 12,
        `REQ-180: the presenter's pointer glided through ${distinct} positions (≥ 12)`,
      );
      const back = xs.findIndex((x, i) => i > 0 && x < xs[i - 1] - 0.5);
      expect.eq(
        back,
        -1,
        "REQ-180: the presenter's pointer never stepped back",
      );
      const pAt = await pointerAt(page);
      const plink = project(flink);
      const pbox = {
        x: plink.x,
        y: plink.y,
        width: flink.width * s,
        height: flink.height * s,
      };
      expect(
        inside(pAt, pbox),
        `REQ-188: user on their privacy link → the presenter's pointer (${
          pAt.x.toFixed(1)
        },${pAt.y.toFixed(1)}) sits on the frame's link ${
          JSON.stringify(pbox)
        }`,
      );

      // 6. REQ-187 — the customer's screen is the truth: a page, the drawer, the map, a scroll
      await userPage.goto(`${baseUrl}/customers`);
      await until(
        "the frame follows to /customers",
        () => new URL(frame().url()).pathname === "/customers",
        20_000,
      );
      expect.eq(
        new URL(page.url()).pathname,
        "/demo/stage",
        "the stage itself never navigates",
      );
      // the drawer (a phone-wide shell page): opened and closed on the user's side, mirrored
      await userPage.locator(".sb").waitFor({ timeout: 15_000 });
      await frame().locator(".sb").waitFor({ timeout: 15_000 });
      await userPage.evaluate(() =>
        globalThis.dispatchEvent(new CustomEvent("pm:sb-toggle"))
      );
      await userPage.locator(".sb--open").waitFor({ timeout: 5_000 });
      await until(
        "the frame's drawer opens",
        async () => (await frame().locator(".sb--open").count()) === 1,
      );
      // REQ-187 AMENDMENT — a folder opened in the drawer: the frame's sidebar opens the same one
      await userPage.locator(".sb--open .nav-item:has(.nav-item__chev)").first()
        .click();
      await userPage.locator(".sb .nav-item--back").waitFor({ timeout: 5_000 });
      await until(
        "the frame's sidebar opens the folder (Back row)",
        async () =>
          (await frame().locator(".sb .nav-item--back").count()) === 1,
      );
      await userPage.locator(".sb .nav-item--back").click();
      await until(
        "the frame's sidebar is back at the top level",
        async () =>
          (await frame().locator(".sb .nav-item--back").count()) === 0,
      );
      await userPage.evaluate(() =>
        globalThis.dispatchEvent(new CustomEvent("pm:sb-toggle"))
      );
      await until(
        "the frame's drawer closes",
        async () => (await frame().locator(".sb--open").count()) === 0,
      );

      // the map: the user pans; the frame's map shows the same ground at its centre
      await userPage.goto(`${baseUrl}/field/assignments`);
      await until(
        "the frame follows to /field/assignments",
        () => new URL(frame().url()).pathname === "/field/assignments",
        20_000,
      );
      const tile = "img.leaflet-tile-loaded";
      await userPage.locator(tile).first().waitFor({ timeout: 30_000 });
      await frame().locator(tile).first().waitFor({ timeout: 30_000 });
      await new Promise((r) => setTimeout(r, 1000));
      const mapSel = ".leaflet-container";
      await userPage.locator(mapSel).scrollIntoViewIfNeeded();
      const um = await userPage.locator(mapSel).boundingBox();
      if (!um) throw new Error("no map box on the user's page");
      const cx = um.x + um.width / 2;
      const cy = um.y + um.height / 2;
      await userPage.mouse.move(cx, cy);
      await userPage.mouse.down();
      for (let i = 1; i <= 8; i++) {
        await userPage.mouse.move(cx + i * 10, cy + i * 5);
        await new Promise((r) => setTimeout(r, 20));
      }
      await userPage.mouse.up();
      await new Promise((r) => setTimeout(r, 800));
      // the ground under a client point: the tile under it (z/x/y from its URL) and the offset inside
      const groundIn = (
        target: typeof page | ReturnType<typeof frame>,
        x: number,
        y: number,
      ) =>
        target.evaluate(([x, y]) => {
          for (const img of document.querySelectorAll("img.leaflet-tile")) {
            const b = img.getBoundingClientRect();
            if (x < b.left || x >= b.right || y < b.top || y >= b.bottom) {
              continue;
            }
            const m = (img as HTMLImageElement).src.match(
              /\/(\d+)\/(\d+)\/(\d+)\.png/,
            );
            if (!m) continue;
            const [, z, tx, ty] = m.map(Number);
            return {
              z,
              wx: tx * 256 + (x - b.left) * 256 / b.width,
              wy: ty * 256 + (y - b.top) * 256 / b.height,
            };
          }
          return null;
        }, [x, y] as [number, number]);
      const truth = await groundIn(userPage, cx, cy);
      await until(
        "the frame's map shows the user's ground at the centre",
        async () => {
          const fm = await frame().locator(mapSel).evaluate(rectOf) as Box;
          const got = await groundIn(
            frame(),
            fm.x + fm.width / 2,
            fm.y + fm.height / 2,
          );
          return !!truth && !!got && got.z === truth.z &&
            Math.hypot(got.wx - truth.wx, got.wy - truth.wy) <= 3;
        },
        10_000,
      );

      // a scroll: the page's main scroller (the window, or the first panel that overflows — the
      // same element on both, the DOMs being identical) is scrolled on the user's side; the frame
      // scrolls the same element to the same place
      const mainScroller = () => {
        const se = document.scrollingElement;
        if (se && se.scrollHeight > se.clientHeight + 1) {
          return se as HTMLElement;
        }
        for (const el of Array.from(document.querySelectorAll("*"))) {
          const oy = getComputedStyle(el).overflowY;
          if (
            (oy === "auto" || oy === "scroll") &&
            el.scrollHeight > el.clientHeight + 1
          ) return el as HTMLElement;
        }
        return null;
      };
      const after = await userPage.evaluate(
        `(() => { const el = (${mainScroller})(); if (!el) return null; el.scrollTop = 150; return el.scrollTop; })()`,
      ) as number | null;
      expect(
        after !== null && after >= 100,
        `the user's page scrolls (scrollTop ${after} after asking for 150)`,
      );
      await until(
        "the frame's main scroller follows to the same place",
        async () =>
          Math.abs(
            ((await frame().evaluate(
              `(${mainScroller})()?.scrollTop ?? -1`,
            )) as number) - (after ?? 150),
          ) <= 1,
      );

      // 7. End from the presenter clears both (REQ-235: End, then Yes)
      await page.locator("[data-cy='demo-end']").click();
      await page.locator("[data-cy='demo-end-confirm']").click();
      await page.locator("[data-cy='demo-pill']").waitFor({
        state: "hidden",
        timeout: 15_000,
      });
      await userPage.locator("[data-cy='demo-pill']").waitFor({
        state: "hidden",
        timeout: 15_000,
      });
      // the presenter is handed their own account back: /admin, not impersonating
      await page.waitForURL(/\/admin/, { timeout: 20_000 });
      await page.locator("[data-cy='adm-q']").waitFor({ timeout: 20_000 });
      const active = await http("/api/demo-mode/active", {
        headers: user.auth,
      });
      expect.eq(
        (await active.json()).session,
        null,
        "the demo is over on the server",
      );
    } finally {
      await userCtx.close();
    }
  }));
