/**
 * REQ-645 — demo-loop cycle 5 (run r37f88707): M1, M2, m36, c4-M6, in two browsers. The
 * presenter's pointer is found again by WHAT he pointed at, never by where his still mouse is.
 *
 *   1. M1 — a card swap under his still mouse. The customer's page re-renders the button he points
 *      at (a new node, the same button): the arrow is on the new one. The button is swapped for
 *      ANOTHER control at the same spot ("or a person?"): no arrow on it (REQ-538 put the arrow
 *      on whatever came under his mouse), and the stage says his pointer isn't on their screen.
 *      He points again; the control is pushed 120 px down under his still mouse: the arrow rides
 *      with it, faded — no longer where he points.
 *   2. c4-M6 — on a phone (the window scrolls, the topbar is sticky) the element he points at
 *      scrolls up under the topbar: a chevron at the top edge of where the page can be seen —
 *      under the topbar, never on it — with "Hans is pointing above — scroll ↑"; no arrow, no
 *      dashed ring. Scrolled back, the arrow is on it again.
 *   3. M2 (start) — a desktop customer: the stage opens with nothing of his on her screen and
 *      asks him to move ("isn't on Ana Torres's screen — move to show it"); his move puts the
 *      arrow there and the prompt goes.
 *   4. M2 (page change) — he points at her topbar's ES; she goes to another page: the arrow is
 *      back on ES within 1.5 s of the stage showing that page, with no move.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Page = StoryTools["page"];
const FRAME = "[data-cy='demo-frame']";

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

/** the customer (Ana Torres, past onboarding: the app's pages) and a super admin (Hans) */
async function people(http: StoryTools["http"]) {
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

/** the demo: the customer's page on `path` at `view`, the admin on the stage (Demo clicked on
 *  /admin), the stage mirroring that page */
async function demoOn(
  tools: StoryTools,
  view: { width: number; height: number },
  path: string,
) {
  const { page, http, baseUrl } = tools;
  await page.setViewportSize({ width: 1280, height: 860 });
  const who = await people(http);
  const browser = page.context().browser();
  if (!browser) throw new Error("no browser behind the story page");
  const userCtx = await browser.newContext({ viewport: view });
  await useCookie(userCtx, baseUrl, who.user.cookie);
  const userPage = await userCtx.newPage();
  await useCookie(page.context(), baseUrl, who.admin.cookie);
  await page.goto(`${baseUrl}/admin`);
  await page.locator("[data-cy='adm-q']").fill(who.userPhone.slice(2));
  await page.locator("[data-cy='adm-search']").click();
  const demo = page.locator("[data-cy='adm-demo']").first();
  await demo.waitFor({ timeout: 15_000 });
  await demo.click();
  await page.waitForURL((u: URL) => u.pathname === "/demo/stage", {
    timeout: 20_000,
  });
  await page.locator("[data-cy='demo-connecting']").waitFor({
    timeout: 15_000,
  });
  // the customer opens the page: it joins the demo, and the stage mirrors it
  await userPage.goto(`${baseUrl}${path}`);
  await until(
    `the stage mirrors the customer's ${path} (${view.width} × ${view.height})`,
    async () => {
      const { shown, size } = await page.evaluate((f) => ({
        shown: document.querySelector(f)?.getAttribute("data-path") ?? null,
        size: (document.querySelector("[data-cy='demo-screen']") as
          | HTMLElement
          | null)?.innerText ?? "",
      }), FRAME);
      if (shown === path && size.includes(`${view.width} × ${view.height}`)) {
        return true;
      }
      throw new Error(
        `the stage shows ${shown} "${size}"; her page is ${userPage.url()}`,
      );
    },
    60_000,
  );
  return { ...who, userCtx, userPage };
}

/** a point of the mirrored page (the customer's CSS px) on the stage, from the frame's box now */
async function onStage(page: Page, width: number, p: { x: number; y: number }) {
  const fb = await page.locator(FRAME).boundingBox();
  if (!fb) throw new Error("no frame box");
  const s = fb.width / width;
  return { x: fb.x + p.x * s, y: fb.y + p.y * s };
}

/** the box of a mirrored element (the customer's CSS px), from the stage page */
const mirrorBox = (page: Page, sel: string) =>
  page.evaluate(([f, s]) => {
    const d = (document.querySelector(f) as HTMLIFrameElement | null)
      ?.contentDocument;
    const r = d?.querySelector(s)?.getBoundingClientRect();
    return r && r.width > 0
      ? { x: r.left, y: r.top, width: r.width, height: r.height }
      : null;
  }, [FRAME, sel]);

/** the presenter moves onto the middle of a mirrored element (two moves: a real pointer event) */
async function pointAt(page: Page, width: number, sel: string) {
  let b: Awaited<ReturnType<typeof mirrorBox>> = null;
  await until(`the stage mirrors ${sel}`, async () => {
    b = await mirrorBox(page, sel);
    return !!b;
  }, 15_000);
  const box = b!;
  const at = await onStage(page, width, {
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
  });
  await page.mouse.move(at.x - 24, at.y - 12);
  await page.mouse.move(at.x, at.y);
  return at;
}

/** Hans's pointer on the customer's screen: where it is drawn and how — and what of the page is
 *  under that point (the data-cy of the nearest marked element) */
const pointerOn = (pg: Page) =>
  pg.evaluate(() => {
    const el = Array.from(document.querySelectorAll("[data-cy='demo-pointer']"))
      .find((e) => e.getAttribute("data-presenter") === "Hans");
    if (!el) return null;
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    const x = m.m41;
    const y = m.m42;
    const under = document.elementsFromPoint(x + 1, y + 1)
      .find((e) => !e.closest("[data-demo-overlay]"));
    const mark = el.querySelector("[data-cy='demo-pointer-off-mark']");
    const mb = mark?.getBoundingClientRect();
    return {
      x,
      y,
      under: under?.closest("[data-cy]")?.getAttribute("data-cy") ?? null,
      twin: !!under?.closest("[data-e2e-twin]"),
      outside: el.hasAttribute("data-outside"),
      cue: el.hasAttribute("data-cue"),
      faded: el.hasAttribute("data-faded"),
      pending: el.hasAttribute("data-pending"),
      tag: el.querySelector("[data-cy='demo-pointer-tag']") !== null,
      cueText: (el.querySelector("[data-cy='demo-pointer-cue']") as
        | HTMLElement
        | null)?.innerText.trim() ?? null,
      markTop: mb ? mb.top : null,
    };
  });
/** an ARROW of his on the customer's screen (not the "pointing…" placeholder, not a chevron) */
const arrowOf = async (pg: Page) => {
  const p = await pointerOn(pg);
  return p && !p.pending && !p.cue ? p : null;
};

/** his arrow on the customer's screen once it has come to rest (two reads 300 ms apart agree) */
async function restingArrow(pg: Page, what: string) {
  let last = await arrowOf(pg);
  for (let i = 0; i < 30; i++) {
    await sleep(300);
    const now = await arrowOf(pg);
    if (
      now && last && Math.abs(now.x - last.x) < 0.5 &&
      Math.abs(now.y - last.y) < 0.5
    ) return now;
    last = now;
  }
  throw new Error(`${what}: no arrow came to rest (${JSON.stringify(last)})`);
}

const stageSays = (page: Page, cy: string) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    return el ? el.innerText.trim() : null;
  }, `[data-cy='${cy}']`);

Deno.test("REQ-645 (demo cycle 5 M1): a card swapped under his still mouse — the same button re-rendered gets the arrow; another control at that spot never does (the stage says his pointer isn't on their screen); a control pushed away under his still mouse takes the arrow along, faded", (t) =>
  story(t, async (tools) => {
    const { page, expect } = tools;
    const view = { width: 420, height: 800 };
    const d = await demoOn(tools, view, "/customers");
    const { userPage } = d;
    try {
      // a card of the customer's page, at a fixed spot (the assistant's cards are re-rendered
      // by Preact: a new node for the same button)
      await userPage.evaluate(() => {
        const box = document.createElement("div");
        box.setAttribute("data-cy", "e2e-cards");
        box.style.cssText =
          "position:fixed;left:40px;top:300px;width:300px;display:flex;flex-direction:column;z-index:20";
        const b = document.createElement("button");
        b.setAttribute("data-cy", "e2e-card");
        b.textContent = "Lock it in";
        b.style.cssText = "height:64px;font-size:18px";
        box.appendChild(b);
        document.body.appendChild(box);
      });
      await pointAt(page, view.width, "[data-cy='e2e-card']");
      await until(
        "the customer's screen has his arrow on the card",
        async () => (await arrowOf(userPage))?.under === "e2e-card",
        10_000,
      );
      const onCard = await restingArrow(userPage, "his arrow on the card");

      // 1. the same button, re-rendered: a new node with the same print — the arrow is on it, at
      //    the same spot (its own node gone, her page hid it until the stage found the new one)
      await userPage.evaluate(() => {
        const old = document.querySelector("[data-cy='e2e-card']")!;
        const twin = old.cloneNode(true) as HTMLElement;
        twin.setAttribute("data-e2e-twin", "");
        old.replaceWith(twin);
      });
      await sleep(1_500);
      await until(
        "REQ-645: the re-rendered button (a new node, the same button) has his arrow, where it was, with no move",
        async () => {
          const a = await arrowOf(userPage);
          if (!a) throw new Error("no arrow");
          if (
            a.under !== "e2e-card" || !a.twin ||
            Math.abs(a.x - onCard.x) > 2 || Math.abs(a.y - onCard.y) > 2
          ) {
            throw new Error(
              `arrow ${JSON.stringify(a)} (on the card it was at ${
                JSON.stringify(onCard)
              })`,
            );
          }
          return true;
        },
        3_000,
      );

      // 2. ANOTHER control at that spot: never the arrow on it (REQ-538 put it on whatever came
      //    under his still mouse: "or a person?" where "Lock it in" was)
      await userPage.evaluate(() => {
        const old = document.querySelector("[data-cy='e2e-card']") as
          | HTMLElement
          | null;
        if (!old) throw new Error("no card");
        const other = document.createElement("button");
        other.setAttribute("data-cy", "e2e-other");
        other.textContent = "or a person?";
        other.style.cssText = old.style.cssText;
        old.replaceWith(other);
      });
      // her page hides the arrow whose button went (a frame or two later)
      await until(
        "the arrow on the swapped-out button leaves her screen",
        async () => (await arrowOf(userPage)) === null,
        5_000,
      );
      const t0 = Date.now();
      while (Date.now() - t0 < 3_500) {
        const a = await arrowOf(userPage);
        if (a?.under === "e2e-other") {
          throw new Error(
            `REQ-645: his arrow is on the control swapped in under his still mouse ${
              JSON.stringify(a)
            }`,
          );
        }
        await sleep(150);
      }
      expect.eq(
        await arrowOf(userPage),
        null,
        "REQ-645: what he pointed at is gone — no arrow on the customer's screen",
      );
      await until(
        "REQ-645: the stage says his pointer isn't on her screen",
        async () =>
          (await stageSays(page, "demo-pointer-absent")) ===
            "Your pointer isn't on Ana Torres's screen — move to show it",
        5_000,
      );

      // 3. he points again (at the new control); it is pushed 120 px down under his still mouse:
      //    the arrow rides with it, faded — what he pointed at, no longer where he points
      await pointAt(page, view.width, "[data-cy='e2e-other']");
      await until(
        "his move puts the arrow on the control under his cursor, not faded",
        async () => {
          const a = await arrowOf(userPage);
          return a?.under === "e2e-other" && !a.faded;
        },
        10_000,
      );
      const before = await restingArrow(userPage, "his arrow on the control");
      await userPage.evaluate(() => {
        const s = document.createElement("div");
        s.style.cssText = "height:120px";
        document.querySelector("[data-cy='e2e-other']")!.before(s);
      });
      await until(
        "REQ-645: the arrow rides 120 px down with its control and is faded",
        async () => {
          const a = await arrowOf(userPage);
          if (!a) throw new Error("no arrow");
          if (a.under !== "e2e-other" || !a.faded) {
            throw new Error(`arrow ${JSON.stringify(a)}`);
          }
          return Math.abs(a.y - before.y - 120) <= 3;
        },
        5_000,
      );
    } finally {
      await d.userCtx.close();
    }
  }));

Deno.test("REQ-645 (demo c4-M6): on a phone, what he points at scrolled up under the sticky topbar is a chevron at the top of where the page can be seen — never on the topbar — saying 'Hans is pointing above — scroll ↑'; scrolled back, the arrow", (t) =>
  story(t, async (tools) => {
    const { page, expect } = tools;
    const view = { width: 420, height: 800 };
    const d = await demoOn(tools, view, "/customers");
    const { userPage } = d;
    try {
      // a target at the top of the page's content, and room to scroll it away
      await userPage.evaluate(() => {
        const content = document.querySelector(".content");
        if (!content) throw new Error("no .content on the customer's page");
        const b = document.createElement("button");
        b.setAttribute("data-cy", "e2e-target");
        b.textContent = "Pick me";
        b.style.cssText = "height:48px;font-size:16px";
        content.prepend(b);
        const room = document.createElement("div");
        room.style.cssText = "height:1600px";
        content.append(room);
        scrollTo(0, 0);
      });
      const bar = await userPage.evaluate(() => {
        const r = document.querySelector(".topbar")?.getBoundingClientRect();
        return r ? { top: r.top, bottom: r.bottom } : null;
      });
      if (!bar || bar.top !== 0) {
        throw new Error(`the topbar is not at the top: ${JSON.stringify(bar)}`);
      }
      await pointAt(page, view.width, "[data-cy='e2e-target']");
      await until(
        "the customer's screen has his arrow on the target",
        async () => (await arrowOf(userPage))?.under === "e2e-target",
        10_000,
      );

      // the customer scrolls: the target goes up under her sticky topbar
      const target = await userPage.evaluate(() =>
        document.querySelector("[data-cy='e2e-target']")!
          .getBoundingClientRect().top
      );
      await userPage.evaluate((y) => scrollTo(0, y), Math.round(target - 10));
      await until(
        "REQ-645 (c4-M6): a chevron under the topbar with the way to it — no arrow over the topbar, no dashed ring",
        async () => {
          const p = await pointerOn(userPage);
          if (!p) throw new Error("no pointer of his on her screen");
          if (
            !p.cue || p.outside || p.tag || p.markTop === null ||
            p.markTop < bar.bottom - 1 ||
            p.cueText !== "Hans is pointing above — scroll ↑"
          ) {
            throw new Error(
              `pointer ${JSON.stringify(p)} (the topbar ends at ${bar.bottom})`,
            );
          }
          return true;
        },
        8_000,
      );
      expect.eq(
        await arrowOf(userPage),
        null,
        "REQ-645: no arrow while it is out of view",
      );

      // scrolled back: the arrow is on it again
      await userPage.evaluate(() => scrollTo(0, 0));
      await until(
        "scrolled back, the arrow is on the target again",
        async () => (await arrowOf(userPage))?.under === "e2e-target",
        8_000,
      );
    } finally {
      await d.userCtx.close();
    }
  }));

Deno.test("REQ-645 (demo cycle 5 M2, start): a desktop customer — the stage opens with nothing of his on her screen, and it asks him to move there; his move puts the arrow on her screen and the prompt goes", (t) =>
  story(t, async (tools) => {
    const { page, expect } = tools;
    const view = { width: 1280, height: 800 };
    const d = await demoOn(tools, view, "/dashboard");
    const { userPage } = d;
    try {
      // the start: /admin's hand-off is a hint only (REQ-539: on a desktop customer's frame) —
      // nothing of his on her screen, and the stage asks him to move
      await until(
        "REQ-645 (M2): at the start the stage asks him to move onto her screen",
        async () =>
          (await stageSays(page, "demo-pointer-absent")) ===
            "Your pointer isn't on Ana Torres's screen — move to show it",
        10_000,
      );
      expect.eq(
        await pointerOn(userPage),
        null,
        "REQ-539: no pointer of his on her screen before he moves",
      );
      await pointAt(page, view.width, "[data-cy='topbar-lang-es']");
      await until(
        "his move puts his arrow on her screen (her ES)",
        async () => (await arrowOf(userPage))?.under === "topbar-lang-es",
        10_000,
      );
      expect.eq(
        await stageSays(page, "demo-pointer-absent"),
        null,
        "REQ-645 (M2): the stage's prompt is gone once his arrow is on her screen",
      );
    } finally {
      await d.userCtx.close();
    }
  }));

Deno.test("REQ-645 (demo cycle 5 M2, page change): a desktop customer — he points at the topbar's ES; her next page has the arrow back on ES within 1.5 s of the stage showing it, with no move", (t) =>
  story(t, async (tools) => {
    const { page, expect, baseUrl } = tools;
    const view = { width: 1280, height: 800 };
    const d = await demoOn(tools, view, "/dashboard");
    const { userPage, userCtx } = d;
    try {
      // he points at the topbar's ES
      await pointAt(page, view.width, "[data-cy='topbar-lang-es']");
      await until(
        "his arrow is on her ES",
        async () => (await arrowOf(userPage))?.under === "topbar-lang-es",
        10_000,
      );

      // her next page: when the stage shows it, and when her screen has his arrow on ES again
      await page.evaluate((f) => {
        const frame = document.querySelector(f)!;
        // deno-lint-ignore no-explicit-any
        const w = globalThis as any;
        w.__e2ePathAt = null;
        new MutationObserver(() => {
          if (
            w.__e2ePathAt === null &&
            frame.getAttribute("data-path") === "/customers"
          ) w.__e2ePathAt = Date.now();
        }).observe(frame, { attributes: true });
      }, FRAME);
      await userCtx.addInitScript(() => {
        // deno-lint-ignore no-explicit-any
        const w = globalThis as any;
        w.__e2eArrowAt = null;
        const iv = setInterval(() => {
          if (location.pathname !== "/customers") return;
          const el = Array.from(
            document.querySelectorAll("[data-cy='demo-pointer']"),
          ).find((e) => e.getAttribute("data-presenter") === "Hans");
          if (
            !el || el.hasAttribute("data-pending") ||
            el.hasAttribute("data-cue")
          ) return;
          const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
          const under = document.elementsFromPoint(m.m41 + 1, m.m42 + 1)
            .find((e) => !e.closest("[data-demo-overlay]"));
          if (under?.closest("[data-cy='topbar-lang-es']")) {
            w.__e2eArrowAt = Date.now();
            clearInterval(iv);
          }
        }, 20);
      });
      await userPage.goto(`${baseUrl}/customers`);
      let pathAt = 0;
      await until(
        "the stage mirrors her /customers",
        async () => {
          pathAt = await page.evaluate(() =>
            // deno-lint-ignore no-explicit-any
            (globalThis as any).__e2ePathAt
          );
          return pathAt > 0;
        },
        30_000,
      );
      let arrowAt = 0;
      await until(
        "REQ-645 (M2): her next page has his arrow back on ES, with no move",
        async () => {
          arrowAt = await userPage.evaluate(() =>
            // deno-lint-ignore no-explicit-any
            (globalThis as any).__e2eArrowAt ?? 0
          );
          return arrowAt > 0;
        },
        10_000,
      );
      const late = arrowAt - pathAt;
      expect(
        late <= 1_500,
        `REQ-645 (M2): the arrow is back ${late} ms after the stage showed her page (at most 1500)`,
      );
    } finally {
      await d.userCtx.close();
    }
  }));
