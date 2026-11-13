/**
 * REQ-789 — Raphael (hotfix, 2026-11-13): "look at this in demo view — this flickers my cursor
 * and the flicker is in the wrong place."
 *
 * Two browsers through the server's relay (no data channel) with 250 ms of latency on the
 * customer's link, the customer on a desktop with a modal open whose layout is NOT the replica's
 * (their device lays the page out with other fonts: emulated by a style the mirror never records,
 * `data-demo-skip`). The presenter sweeps his mouse over the modal in one continuous move: the
 * ghost of his arrow (REQ-642: drawn where the customer's screen reported it) is never drawn
 * while his hand moves — before, every move cleared it and the next report drew it again, a
 * flash beside his cursor somewhere else on the frame. At rest it appears once, where the
 * customer's screen has his arrow (their arrow mapped onto the frame), and stays; his next move
 * takes it away at once.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const CUSTOMER = { width: 1280, height: 720 };
/** the customer's link: the relay's round trip, as on the road */
const LATENCY_MS = 250;
/** a move step closer than this to a sample is "still moving": no ghost may show then (the rest
 *  is GHOST_REST_MS = 500; the slack is for a loaded machine's late sample) */
const MOVING_MS = 400;

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
  timeout = 25_000,
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
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// deno-lint-ignore no-explicit-any
type Page = any;
type Pt = { x: number; y: number };
type Sample = {
  t: number;
  sinceStep: number;
  ghost: Pt | null;
  own: Pt | null;
  cust: Pt | null;
};

/** the stage's own marker and ghost (the drawn position), and the customer's arrow on their screen */
const sample = async (
  stage: Page,
  cust: Page,
): Promise<Omit<Sample, "t" | "sinceStep">> => {
  const s = await stage.evaluate(() => {
    const tr = (el: Element | null) => {
      if (!el) return null;
      const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
      return { x: Math.round(m.e), y: Math.round(m.f) };
    };
    return {
      own: tr(document.querySelector("[data-cy='demo-pointer-own']")),
      ghost: tr(document.querySelector("[data-cy='demo-pointer-ghost']")),
    };
  });
  const c = await cust.evaluate(() => {
    const el = document.querySelector("[data-cy='demo-pointer']");
    if (!el) return null;
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: Math.round(m.e), y: Math.round(m.f) };
  });
  return { ...s, cust: c };
};

Deno.test("REQ-789: through the relay with 250 ms of latency and a customer whose modal is laid out unlike the replica, the presenter's continuous sweep never draws the ghost of his arrow; at rest it appears once, where the customer's screen has his arrow, and stays; his next move takes it away", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
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
    expect.eq(boot.status, 200, "the admin phone is a super admin");
    await boot.body?.cancel();

    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    // no data channel on either side: every pointer message rides the server's relay
    const noDirect = () => {
      Object.defineProperty(globalThis, "RTCPeerConnection", {
        value: undefined,
        configurable: true,
      });
    };
    await page.context().addInitScript(noDirect);
    const userCtx = await browser.newContext({ viewport: CUSTOMER });
    await userCtx.addInitScript(noDirect);
    try {
      const cust = await userCtx.newPage();
      const cdp = await userCtx.newCDPSession(cust);
      await cdp.send("Network.enable");
      await cdp.send("Network.emulateNetworkConditions", {
        offline: false,
        latency: LATENCY_MS,
        downloadThroughput: -1,
        uploadThroughput: -1,
      });
      await useCookie(userCtx, baseUrl, user.cookie);
      await cust.goto(`${baseUrl}/field/subscriptions`);
      await cust.locator("[data-cy='subs-new']").first().click();
      await cust.locator("[data-cy='subs-form']").waitFor({ timeout: 15_000 });
      await cust.evaluate(() =>
        document.querySelector("[data-cy='subs-days']")?.scrollIntoView({
          block: "start",
        })
      );
      await sleep(600);

      // the presenter lands on the stage, Live on the customer's page
      await useCookie(page.context(), baseUrl, admin.cookie);
      await page.goto("/admin");
      await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
      await page.locator("[data-cy='adm-search']").click();
      await page.locator("[data-cy='adm-demo']").first().waitFor({
        timeout: 25_000,
      });
      await page.locator("[data-cy='adm-demo']").first().click();
      await page.waitForURL((u: URL) => u.pathname === "/demo/stage", {
        timeout: 25_000,
      });
      await page.locator("[data-cy='demo-pill']").waitFor({ timeout: 25_000 });
      await until(
        "the stage is Live on /field/subscriptions",
        async () =>
          (await page.locator("[data-cy='demo-status']").innerText()).trim() ===
            "Live" &&
          (await page.locator("[data-cy='demo-frame']").getAttribute(
              "data-path",
            )) === "/field/subscriptions",
      );
      await sleep(1500);
      /** the weekday row as the replica has it (and the customer's screen, until the style) */
      const rowOf = () =>
        cust.evaluate(() => {
          const r = document.querySelector("[data-cy='subs-days']")
            ?.getBoundingClientRect();
          return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
        });
      const row = await rowOf();
      if (!row) throw new Error("the customer's weekday row is not there");

      // the customer's device lays the modal out unlike the replica (other fonts): a style the
      // mirror never records moves the weekday row down
      await cust.evaluate(() => {
        const st = document.createElement("style");
        st.setAttribute("data-demo-skip", "");
        st.textContent = ".modal .hint{display:block;margin:0 0 14px}";
        document.head.appendChild(st);
      });
      await sleep(600);
      const shifted = await rowOf();
      expect.eq(
        !!shifted && shifted.y - row.y >= 30,
        true,
        `their weekday row moved down (${row.y} → ${shifted?.y})`,
      );
      const frame = await page.evaluate(() => {
        const r = document.querySelector("[data-cy='demo-frame']")
          ?.getBoundingClientRect();
        return r ? { x: r.left, y: r.top, w: r.width, h: r.height } : null;
      });
      if (!frame) throw new Error("no frame on the stage");
      const sx = frame.w / CUSTOMER.width;
      const sy = frame.h / CUSTOMER.height;
      const from = {
        x: frame.x + (row.x - 60) * sx,
        y: frame.y + (row.y - 80) * sy,
      };
      // the sweep ends ON the replica's weekday row (a day chip): their screen has that chip lower
      const to = {
        x: frame.x + (row.x + row.w * 0.5) * sx,
        y: frame.y + (row.y + row.h * 0.5) * sy,
      };

      // 1. one continuous sweep (a pointer event every few ms, as a hand makes them), sampled
      //    as it goes: no ghost while the hand moves
      await page.mouse.move(from.x, from.y);
      await sleep(1200);
      const log: Sample[] = [];
      let lastStep = Date.now();
      let moving = true;
      const t0 = Date.now();
      const mover = (async () => {
        const steps = 160;
        for (let i = 1; i <= steps; i++) {
          await page.mouse.move(
            from.x + (to.x - from.x) * i / steps,
            from.y + (to.y - from.y) * i / steps,
          );
          lastStep = Date.now();
          await sleep(12);
        }
        moving = false;
      })();
      const sampler = (async () => {
        while (moving) {
          const s = await sample(page, cust);
          log.push({
            t: Date.now() - t0,
            sinceStep: Date.now() - lastStep,
            ...s,
          });
          await sleep(25);
        }
      })();
      await Promise.all([mover, sampler]);
      const whileMoving = log.filter((s) => s.sinceStep < MOVING_MS);
      const flashed = whileMoving.filter((s) => s.ghost);
      expect.eq(
        flashed.length,
        0,
        `no ghost while the hand moves (${whileMoving.length} samples in motion; it showed at ${
          flashed.map((s) => `${s.t}ms`).join(", ")
        })`,
      );
      expect.eq(
        whileMoving.length >= 10,
        true,
        `the sweep was sampled in motion (${whileMoving.length} samples)`,
      );

      // 2. at rest: the ghost appears once, where the customer's screen has his arrow, and stays
      const restAt = Date.now();
      const rest: Sample[] = [];
      while (Date.now() - restAt < 2_500) {
        const s = await sample(page, cust);
        rest.push({ t: Date.now() - restAt, sinceStep: 0, ...s });
        await sleep(50);
      }
      const first = rest.findIndex((s) => s.ghost);
      expect.eq(
        first > -1 && rest[first].t <= 2_000,
        true,
        `the ghost appears at rest (${
          first > -1 ? `after ${rest[first].t} ms` : "never"
        })`,
      );
      const after = rest.slice(first);
      const gone = after.filter((s) => !s.ghost);
      expect.eq(
        gone.length,
        0,
        `once there it stays (${after.length} samples; missing at ${
          gone.map((s) => `${s.t}ms`).join(", ")
        })`,
      );
      const last = rest[rest.length - 1];
      if (!last.ghost || !last.cust) {
        throw new Error("no ghost or no arrow at the end");
      }
      const custOnStage = {
        x: frame.x + last.cust.x / CUSTOMER.width * frame.w,
        y: frame.y + last.cust.y / CUSTOMER.height * frame.h,
      };
      const apart = Math.hypot(
        last.ghost.x - custOnStage.x,
        last.ghost.y - custOnStage.y,
      );
      expect.eq(
        apart <= 4,
        true,
        `the ghost is where the customer's screen has his arrow (${
          apart.toFixed(1)
        } px apart; ghost ${
          JSON.stringify(last.ghost)
        }, their arrow on the frame ${JSON.stringify(custOnStage)})`,
      );
      expect.eq(
        !!last.own &&
          Math.hypot(last.own.x - last.ghost.x, last.own.y - last.ghost.y) > 6,
        true,
        "and it is apart from his own marker (the layouts differ)",
      );

      // 3. his next move takes it away at once
      await page.mouse.move(to.x + 30, to.y + 10);
      await sleep(150);
      const moved = await sample(page, cust);
      expect.eq(moved.ghost, null, "the ghost goes with his next move");
    } finally {
      await userCtx.close();
    }
  }));
