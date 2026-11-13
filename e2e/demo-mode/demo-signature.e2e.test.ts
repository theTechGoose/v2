/**
 * REQ-380 (demo-loop cycle 2, M10) — a signature drawn on /q's pad reaches the presenter's stage
 * and stays there. During a demo the business owner opens their quote's public page, takes
 * "Sign in person" (`?as=customer&confirm=1`) and draws on the pad with the mouse: the stage's
 * mirrored pad has ink. Then the customer's window is resized — PublicSignQuote's setupCanvas
 * sets the canvas's width and height again (clearing it) and redraws the same strokes, so the
 * customer's bitmap reads exactly as before: the stage's pad must still have ink (the replay
 * repaints the last bitmap after a width/height op, and the recorder re-sends it).
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

Deno.test("REQ-380 (demo M10): a signature drawn on /q's 'Sign in person' pad during a demo shows on the stage, and still does after the customer's window is resized", (t) =>
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
      name: "Dave Roof",
      email: "dave@blackhole.postmarkapp.com",
    });
    const quote = await post(http, user.auth, "/api/quotes", {
      customerId: customer.id,
      summary: "Roof replacement",
      jobName: "Roof replacement",
      lineItems: [{
        description: "Roof replacement",
        quantity: 1,
        unit: "job",
        price: 1450000,
      }],
      estimatedTotal: 1450000,
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

      // 2. Tom opens his quote's public page in person: the pad, enabled
      await userPage.goto(
        `${baseUrl}/q/${quote.id}?as=customer&confirm=1`,
      );
      const pad = userPage.locator("canvas");
      await pad.waitFor({ timeout: 20_000 });
      await pad.scrollIntoViewIfNeeded();
      await until(
        "the stage mirrors the pad",
        async () =>
          await page.locator(FRAME).isVisible().catch(() => false) &&
          (await inkOn(page, true)) >= 0,
        30_000,
      );

      // 3. he draws a signature with the mouse
      await userPage.waitForTimeout(500); // the island's setupCanvas has run
      const box = await pad.boundingBox();
      if (!box) throw new Error("the pad has no box");
      const y0 = box.y + box.height / 2;
      await userPage.mouse.move(box.x + 40, y0);
      await userPage.mouse.down();
      for (let k = 1; k <= 30; k++) {
        await userPage.mouse.move(
          box.x + 40 + k * 12,
          y0 + Math.sin(k / 2.5) * 40,
          { steps: 2 },
        );
      }
      await userPage.mouse.up();
      const drawn = await inkOn(userPage, false);
      expect.eq(drawn > 200, true, `Tom's pad has ink (${drawn} px)`);
      await until(
        "the stage's pad shows the signature",
        async () => (await inkOn(page, true)) > 200,
      );
      await page.screenshot({ path: `${folder}/sig-1-stage-drawn.png` });

      // 4. his window is resized (same width): setupCanvas sets the canvas's size again — which
      //    clears a canvas — and redraws the same strokes. The stage keeps showing them.
      await userPage.setViewportSize({ width: 1000, height: 700 });
      await userPage.waitForTimeout(300);
      expect.eq(
        (await inkOn(userPage, false)) > 200,
        true,
        "Tom's pad is redrawn after the resize",
      );
      await userPage.waitForTimeout(2_500); // > the recorder's 1 s canvas sweep and a flush
      const after = await inkOn(page, true);
      await page.screenshot({ path: `${folder}/sig-2-stage-resized.png` });
      expect.eq(
        after > 200,
        true,
        `REQ-380: the stage's pad still shows the signature after the resize (${after} px)`,
      );
    } finally {
      await userCtx.close();
    }
  }));
