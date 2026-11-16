/**
 * REQ-850 — Raphael: "fix every issue the demo found, loop until there are none." Demo-loop cycle
 * dm3 (run r02524ccd), issue p10: "After the customer narrows the window, the stage draws the
 * customer's cursor past the frame's edge; its label turns from ML to the full name."
 *
 * The customer (desktop, 1280 × 860) rests her mouse near the right of her window until the
 * stage's tag for her pointer is at rest (initials). She narrows the window to a phone's 390 px,
 * past her still cursor, with no pointerleave: her cursor is not on her screen any more. Once the
 * stage shows 390 × 844, her pointer is gone from the stage — never drawn on or past the frame's
 * right edge, never woken back to her full name.
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


/** the customer's pointer as the stage draws it: its box, whether it is at rest, its tag */
const customerOnStage = (page: Page, name: string) =>
  page.evaluate((n) => {
    const el = Array.from(document.querySelectorAll("[data-cy='demo-pointer']"))
      .find((e) => e.getAttribute("data-presenter") === n) as HTMLElement | undefined;
    if (!el) return null;
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    const tag = el.querySelector("[data-cy='demo-pointer-tag']") as HTMLElement | null;
    return {
      x: m.m41,
      y: m.m42,
      idle: el.getAttribute("data-idle") === "1",
      tag: tag?.innerText.trim() ?? "",
    };
  }, name);

Deno.test("REQ-850 (demo-loop cycle dm3, p10): the customer narrows her window past her still cursor — her pointer leaves the stage, never drawn past the frame's right edge or woken to her full name", (t) =>
  story(t, async (tools) => {
    const { page, expect } = tools;
    const d = await demoOn(tools, { width: 1280, height: 860 }, "/dashboard");
    const { userPage } = d;
    try {
      // her mouse rests near the right of her window (two moves: a real pointer event)
      await userPage.mouse.move(1180, 400);
      await userPage.mouse.move(1200, 400);
      await until(
        "the stage draws her pointer, its tag at rest",
        async () => (await customerOnStage(page, "Ana Torres"))?.idle === true,
        15_000,
      );
      // she narrows the window past her still cursor, with no pointerleave: a real narrowing drag
      // often sends none (the fleet's run had none), while headless Chromium fakes one on the
      // re-layout — held back here, so the page sees what her browser saw
      await userPage.evaluate(() =>
        globalThis.addEventListener(
          "pointerleave",
          (e) => e.stopImmediatePropagation(),
          { capture: true },
        )
      );
      await userPage.setViewportSize({ width: 390, height: 844 });
      await until(
        "the stage mirrors her narrowed window (390 × 844)",
        async () =>
          ((await page.locator("[data-cy='demo-screen']").innerText()) ?? "")
            .includes("390 × 844"),
        30_000,
      );
      // her cursor is off her narrowed screen: the stage draws no pointer of hers (the frame may
      // refit a moment before her leave lands — a pointer drawn past the edge that STAYS is the bug)
      let last: Awaited<ReturnType<typeof customerOnStage>> = null;
      let frameRight = 0;
      await until(
        "REQ-850: her pointer leaves the stage once her window is narrower than her cursor",
        async () => {
          last = await customerOnStage(page, "Ana Torres");
          const fb = await page.locator(FRAME).boundingBox();
          frameRight = fb ? fb.x + fb.width : 0;
          if (last === null) return true;
          throw new Error(
            `still drawn: arrow ${last.x}–${last.x + 24} (frame right ${frameRight}), idle ${last.idle}, tag "${last.tag}"`,
          );
        },
        5_000,
      );
      // and it stays gone: no re-send of the old spot (a clamped edge fraction) brings it back
      const t0 = Date.now();
      while (Date.now() - t0 < 3_000) {
        const at = await customerOnStage(page, "Ana Torres");
        expect(
          at === null,
          `REQ-850: no pointer of hers comes back while her cursor is off her screen (${
            JSON.stringify(at)
          }, frame right ${frameRight})`,
        );
        await sleep(200);
      }
    } finally {
      await d.userCtx.close();
    }
  }));
