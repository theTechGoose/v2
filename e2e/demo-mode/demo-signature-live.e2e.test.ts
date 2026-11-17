/**
 * REQ-644 (demo-loop cycle 5, m32) — a signature drawn on /q's pad shows on the stage WHILE it is
 * drawn, on the path the demo took: the business owner, already on his dashboard (the stage has
 * shown a page before), opens his quote's public page (the preview), takes "Customer here with
 * you? Sign in person" — the pad mounts in place (REQ-405: replaceState, no reload, so the stage's
 * canvas is built by a child-list op, never by a snapshot) — and draws a squiggle with a real
 * pointer drag. The stage's mirrored pad must have inked pixels within 500 ms of the drag's end,
 * and keep them.
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

/** the inked pixels of a canvas: the customer's own, or the stage's mirrored one */
const inkOn = (page: Page, inFrame: boolean) =>
  page.evaluate(([f, mirrored]) => {
    const d = mirrored
      ? (document.querySelector(f as string) as HTMLIFrameElement | null)
        ?.contentDocument
      : document;
    const c = d?.querySelector("canvas") as HTMLCanvasElement | null;
    if (!c || !c.width || !c.height) return -1;
    const ctx = c.getContext("2d");
    if (!ctx) return -1;
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let k = 3; k < px.length; k += 4) if (px[k] > 0) n++;
    return n;
  }, [FRAME, inFrame] as const);

const STATS = "[data-cy='demo-mirror-stats']";

/** REQ-644 — the ink the stage SHOWS: its mirrored pad, as the presenter's screen paints it (a
 *  screenshot of the frame's canvas box), counted as the pen's teal (#144852: low red — the pad's
 *  pink grid, baseline and cross never count). The bitmap alone (`inkOn`) is not enough: the
 *  frame is sandboxed without scripts, and there a canvas shows its fallback content, never its
 *  bitmap — measured, a bitmap with 8,000+ inked pixels on a pad that looked empty. */
async function shownInk(page: Page): Promise<number> {
  const clip = await page.evaluate((f) => {
    const fr = document.querySelector(f) as HTMLIFrameElement | null;
    const c = fr?.contentDocument?.querySelector("canvas");
    if (!fr || !c) return null;
    const a = fr.getBoundingClientRect();
    const s = a.width / (fr.offsetWidth || a.width);
    const r = c.getBoundingClientRect();
    return {
      x: a.left + r.left * s,
      y: a.top + r.top * s,
      width: r.width * s,
      height: r.height * s,
    };
  }, FRAME);
  if (!clip || clip.width < 2 || clip.height < 2) return -1;
  const png = await page.screenshot({ clip });
  let bin = "";
  for (const b of png) bin += String.fromCharCode(b);
  return await page.evaluate(async (b64) => {
    const img = new Image();
    await new Promise((ok, no) => {
      img.onload = ok;
      img.onerror = no;
      img.src = `data:image/png;base64,${b64}`;
    });
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const px = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let k = 0; k < px.length; k += 4) {
      if (px[k + 1] > px[k] + 20 && px[k + 2] > px[k] + 20) n++;
    }
    return n;
  }, btoa(bin));
}

Deno.test("REQ-644 (demo c5 m32): a signature drawn on the pad after 'Sign in person' (no reload) shows on the stage within 500 ms of the drag", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "en", name: "Tom Baker" }),
    })).body?.cancel();
    await answerQuestions(http, user.auth, {
      name: "Tom Baker",
      businessName: "Baker Roofing",
    });
    const customer = await post(http, user.auth, "/api/customers", {
      name: "Mike Dunn",
      email: "mike@blackhole.postmarkapp.com",
    });
    const quote = await post(http, user.auth, "/api/quotes", {
      customerId: customer.id,
      summary: "Roof replacement",
      jobName: "Roof replacement",
      lineItems: [{
        description: "Roof replacement",
        quantity: 1,
        unit: "job",
        price: 1680000,
      }],
      estimatedTotal: 1680000,
      terms: [{ stepId: "payment_terms", value: "Due Now" }],
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
    const userCtx = await browser.newContext({
      viewport: { width: 1000, height: 800 },
    });
    try {
      await useCookie(userCtx, baseUrl, user.cookie);
      const userPage = await userCtx.newPage();

      // 1. the presenter opens the demo on Tom's account
      await useCookie(page.context(), baseUrl, admin.cookie);
      await page.goto("/admin", { timeout: 60_000 });
      await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
      await page.locator("[data-cy='adm-search']").click();
      await page.locator("[data-cy='adm-demo']").first().waitFor({
        timeout: 15_000,
      });
      await page.locator("[data-cy='adm-demo']").first().click();
      await page.waitForURL((u) => u.pathname === "/demo/stage", {
        timeout: 20_000,
      });

      // 2. Tom is on his dashboard first: the stage has a page on show
      await userPage.goto(`${baseUrl}/dashboard`, { timeout: 60_000 });
      await until(
        "the stage shows Tom's dashboard",
        async () =>
          await page.locator(FRAME).isVisible().catch(() => false) &&
          await page.evaluate((f) => {
            const d = (document.querySelector(f) as HTMLIFrameElement | null)
              ?.contentDocument;
            return !!d?.body && d.body.childElementCount > 0;
          }, FRAME),
        30_000,
      );

      // 3. he opens the quote's public page — the preview — and takes "Sign in person": the pad
      //    mounts in place, no reload
      await userPage.goto(`${baseUrl}/q/${quote.id}`, { timeout: 60_000 });
      const inPerson = userPage.locator("[data-cy='quote-sign-in-person']");
      await inPerson.waitFor({ timeout: 20_000 });
      const pad = userPage.locator("canvas");
      await until("the pad mounts", async () => {
        if (await pad.count() > 0) return true;
        await inPerson.click({ timeout: 2_000 }).catch(() => {});
        return await pad.count() > 0;
      }, 20_000);
      await pad.scrollIntoViewIfNeeded();
      await until(
        "the stage mirrors the pad",
        async () => (await inkOn(page, true)) >= 0,
        30_000,
      );
      await userPage.waitForTimeout(1_500); // its setupCanvas ran; the smooth scroll ended

      // 4. a squiggle, drawn with a real pointer drag
      const box = await pad.boundingBox();
      if (!box) throw new Error("the pad has no box");
      const y0 = box.y + box.height / 2;
      await userPage.mouse.move(box.x + 40, y0);
      await userPage.mouse.down();
      for (let k = 1; k <= 12; k++) {
        await userPage.mouse.move(
          box.x + 40 + k * 30,
          y0 + (k % 2 ? -40 : 40),
        );
      }
      await userPage.mouse.up();
      const upAt = Date.now();
      const drawn = await inkOn(userPage, false);
      expect.eq(drawn > 200, true, `Tom's pad has ink (${drawn} px)`);

      // 5. the stage's pad SHOWS the ink within 500 ms
      let shown = 0;
      while (Date.now() - upAt < 500) {
        shown = await shownInk(page);
        if (shown > 50) break;
      }
      const took = Date.now() - upAt;
      const bitmap = await inkOn(page, true);
      const stats = await page.locator(STATS).textContent().catch(() => "");
      await page.screenshot({ path: `${folder}/sig-c5-stage-drawn.png` });
      expect.eq(
        shown > 50,
        true,
        `REQ-644: the stage's pad shows the squiggle within 500 ms of the drag (${shown} teal px on screen after ${took} ms; its canvas bitmap has ${bitmap} inked px; ${stats})`,
      );

      // 6. and keeps showing it
      await userPage.waitForTimeout(2_500);
      const later = await shownInk(page);
      await page.screenshot({ path: `${folder}/sig-c5-stage-later.png` });
      expect.eq(
        later > 50,
        true,
        `REQ-644: the stage's pad still shows the squiggle (${later} teal px)`,
      );
    } finally {
      await userCtx.close();
    }
  }));
