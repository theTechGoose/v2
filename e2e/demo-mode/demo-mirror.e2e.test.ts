/**
 * REQ-242 — the stage is a live mirror of the customer's actual screen, end to end in two
 * browsers: before the customer's app joins, the stage says it is connecting (no phone frame);
 * then its one frame — sandboxed, no script in it — is the customer's exact viewport. The
 * customer types in the assistant's composer and sends it, reloads the same URL, opens Settings →
 * Transfer account and types a number, switches to Spanish, and embeds an app page in a frame;
 * the stage shows each (the typed text, the bubble, the fresh page, the dialog with the number,
 * the Spanish page) and the embedded page never joins. The presenter's resting pointer comes back
 * on the customer's next page with no new movement; the customer's pointer leaves the stage on a
 * new page. All along the staff browser sends no write to /api and its frame loads no script.
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

/** read the stage's mirror through the parent page (the frame is same-origin and runs no script) */
const mirror = {
  value: (page: Page, sel: string) =>
    page.evaluate(([f, s]) => {
      const d = (document.querySelector(f) as HTMLIFrameElement | null)
        ?.contentDocument;
      const el = d?.querySelector(s) as HTMLInputElement | null;
      return el ? el.value : null;
    }, [FRAME, sel]),
  count: (page: Page, sel: string) =>
    page.evaluate(([f, s]) => {
      const d = (document.querySelector(f) as HTMLIFrameElement | null)
        ?.contentDocument;
      return d ? d.querySelectorAll(s).length : -1;
    }, [FRAME, sel]),
  texts: (page: Page, sel: string) =>
    page.evaluate(([f, s]) => {
      const d = (document.querySelector(f) as HTMLIFrameElement | null)
        ?.contentDocument;
      return d
        ? Array.from(d.querySelectorAll(s)).map((e) =>
          (e.textContent ?? "").replace(/\s+/g, " ").trim()
        )
        : [];
    }, [FRAME, sel]),
  attr: (page: Page, sel: string, name: string) =>
    page.evaluate(([f, s, n]) => {
      const d = (document.querySelector(f) as HTMLIFrameElement | null)
        ?.contentDocument;
      return d?.querySelector(s)?.getAttribute(n) ?? null;
    }, [FRAME, sel, name]),
  box: (page: Page, sel: string) =>
    page.evaluate(([f, s]) => {
      const d = (document.querySelector(f) as HTMLIFrameElement | null)
        ?.contentDocument;
      const r = d?.querySelector(s)?.getBoundingClientRect();
      return r
        ? { x: r.left, y: r.top, width: r.width, height: r.height }
        : null;
    }, [FRAME, sel]),
};
const texts = (page: Page, sel: string) =>
  page.evaluate(
    (s) =>
      Array.from(document.querySelectorAll(s)).map((e) =>
        (e.textContent ?? "").replace(/\s+/g, " ").trim()
      ),
    sel,
  );
const pointerAt = (page: Page, name: string) =>
  page.evaluate((n) => {
    const el = Array.from(document.querySelectorAll("[data-cy='demo-pointer']"))
      .find((e) => e.getAttribute("data-presenter") === n);
    if (!el) return null;
    const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
    return { x: m.m41, y: m.m42 };
  }, name);

Deno.test("REQ-242: the stage mirrors the customer's actual screen — connecting first, then their exact viewport; typed text, the assistant's bubble, a same-URL reload, a dialog with a typed number and Spanish all reach it; a nested app frame never joins; pointers come back and go away with pages; the staff browser writes nothing and runs no app code", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
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
    const userCtx = await browser.newContext({
      viewport: { width: 420, height: 800 },
    });
    try {
      await useCookie(userCtx, baseUrl, user.cookie);
      const userPage = await userCtx.newPage();

      // 1. the admin opens the demo while the customer's app is not open yet
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
      // from here on, everything the staff browser asks for
      const asked: {
        method: string;
        url: string;
        type: string;
        main: boolean;
      }[] = [];
      page.on("request", (r) => {
        let main = true;
        try {
          main = r.frame() === page.mainFrame();
        } catch { /* a worker's request */ }
        asked.push({
          method: r.method(),
          url: r.url(),
          type: r.resourceType(),
          main,
        });
      });

      // M10 — no invented phone: the stage says it is connecting, no frame is shown
      await page.locator("[data-cy='demo-connecting']").waitFor({
        timeout: 15_000,
      });
      await expect.see("Connecting to Ana Torres");
      expect.eq(
        await page.locator(FRAME).isVisible().catch(() => false),
        false,
        "M10: no frame before the customer's first snapshot",
      );

      // 2. the customer opens the assistant: the stage shows their exact viewport, no script inside
      await userPage.goto(`${baseUrl}/assistant`);
      await userPage.locator(".composer__input").waitFor({ timeout: 20_000 });
      // REQ-309 (demo m26) — the pill and the frame tell ONE story: the pill never says Live
      // while the frame still says it is connecting; both turn with the first snapshot
      const STATUS = "[data-cy='demo-status']";
      const liveWhileConnecting: string[] = [];
      await until(
        "the frame is in",
        async () => {
          const connecting = await page.locator("[data-cy='demo-connecting']")
            .isVisible().catch(() => false);
          const status = (await page.locator(STATUS).innerText().catch(() =>
            ""
          ))
            .trim();
          if (connecting && /^(Live|En vivo)$/.test(status)) {
            liveWhileConnecting.push(status);
          }
          return await page.locator(FRAME).isVisible().catch(() => false);
        },
        25_000,
      );
      expect.eq(
        liveWhileConnecting.length,
        0,
        "REQ-309 (m26): the pill never says Live over 'Connecting to…'",
      );
      await until(
        "the pill says Live once the frame is in",
        async () => (await page.locator(STATUS).innerText()).trim() === "Live",
      );
      // REQ-309 — on localhost the pill counts the mirror's frames (how a lost frame gets pinned)
      await until(
        "the stats chip counts frames",
        async () =>
          /\bf[1-9]/.test(
            await page.locator("[data-cy='demo-mirror-stats']").innerText()
              .catch(() => ""),
          ),
      );
      await until(
        "the frame is the customer's viewport, 420 × 800",
        async () =>
          (await page.locator(FRAME).getAttribute("width")) === "420" &&
          (await page.locator(FRAME).getAttribute("height")) === "800",
      );
      expect.eq(
        await page.locator(FRAME).getAttribute("sandbox"),
        "allow-same-origin",
        "REQ-242: sandboxed, and scripts are not allowed",
      );
      await expect.see("Ana Torres's screen");
      await until(
        "the mirror has the composer",
        async () => (await mirror.count(page, ".composer__input")) === 1,
      );
      expect.eq(
        await mirror.count(page, "script"),
        0,
        "no script in the mirror",
      );
      expect.eq(
        await mirror.count(page, "[data-demo-overlay],[data-cy='demo-pill']"),
        0,
        "the customer's own demo pill is never mirrored",
      );

      // 3. B1/M1 — typed text, then the assistant's bubble
      const said = `Mirror check ${digits()}: replace the kitchen sink`;
      await userPage.locator(".composer__input").fill(said);
      await until(
        "the stage shows what the customer typed",
        async () => (await mirror.value(page, ".composer__input")) === said,
      );
      await userPage.locator("button.composer__send").click();
      await until(
        "the customer's chat shows the bubble",
        async () =>
          (await texts(userPage, ".msg")).some((x) => x.includes(said)),
        30_000,
      );
      await until(
        "the stage shows the same bubble",
        async () =>
          (await mirror.texts(page, ".msg")).some((x) => x.includes(said)),
      );
      await until(
        "and the same conversation, bubble for bubble",
        async () =>
          JSON.stringify(await mirror.texts(page, ".msg")) ===
            JSON.stringify(await texts(userPage, ".msg")),
        20_000,
      );

      // evidence: the two screens side by side
      await page.screenshot({ path: `${folder}/mirror-1-stage-assistant.png` });
      await userPage.screenshot({
        path: `${folder}/mirror-1-customer-assistant.png`,
      });

      // 4. M12 — the same URL, reloaded: the stage takes the fresh page
      await userPage.evaluate(() =>
        document.body.setAttribute("data-mirror-mark", "before-reload")
      );
      await until(
        "the stage sees the mark",
        async () =>
          (await mirror.attr(page, "body", "data-mirror-mark")) ===
            "before-reload",
      );
      const sameUrl = userPage.url();
      await userPage.reload();
      expect.eq(userPage.url(), sameUrl, "the same URL");
      await userPage.locator(".composer__input").waitFor({ timeout: 20_000 });
      await until(
        "the stage shows the reloaded page (the mark is gone)",
        async () =>
          (await mirror.count(page, "body")) === 1 &&
          (await mirror.attr(page, "body", "data-mirror-mark")) === null,
        20_000,
      );

      // 5. M1 — a dialog, and the number typed in it
      await userPage.goto(`${baseUrl}/settings`);
      const open = userPage.locator("[data-cy='transfer-open']");
      await open.waitFor({ timeout: 20_000 });
      for (
        let i = 0;
        i < 10 &&
        (await userPage.locator("[data-cy='transfer-modal']").count()) === 0;
        i++
      ) {
        await open.click().catch(() => {});
        await userPage.waitForTimeout(300);
      }
      await userPage.locator("[data-cy='transfer-phone']").fill("5125550123");
      await until(
        "the stage shows the dialog",
        async () =>
          (await mirror.count(page, "[data-cy='transfer-modal']")) === 1,
      );
      await until(
        "… and the number typed in it",
        async () =>
          ((await mirror.value(page, "[data-cy='transfer-phone']")) ?? "")
            .replace(/\D/g, "") === "5125550123",
      );

      await page.screenshot({ path: `${folder}/mirror-2-stage-dialog.png` });
      await userPage.screenshot({
        path: `${folder}/mirror-2-customer-dialog.png`,
      });

      // M4 — the presenter points at the mirrored Cancel: the customer's pointer lands on their Cancel
      const cancelSel = "[data-cy='transfer-cancel']";
      const fb = await page.locator(FRAME).boundingBox();
      const mc = await mirror.box(page, cancelSel);
      if (!fb || !mc) throw new Error("no frame or no mirrored Cancel");
      const s = fb.width / 420;
      const target = {
        x: fb.x + (mc.x + mc.width / 2) * s,
        y: fb.y + (mc.y + mc.height / 2) * s,
      };
      await page.mouse.move(target.x - 30, target.y - 10);
      await page.mouse.move(target.x, target.y);
      const ub = await userPage.locator(cancelSel).boundingBox();
      if (!ub) throw new Error("no Cancel on the customer's page");
      await until(
        "the presenter's pointer sits on the customer's Cancel",
        async () => {
          const at = await pointerAt(userPage, "Hans");
          return !!at && at.x >= ub.x - 2 && at.x <= ub.x + ub.width + 2 &&
            at.y >= ub.y - 2 && at.y <= ub.y + ub.height + 2;
        },
      );
      await userPage.locator(cancelSel).click();
      await until(
        "the dialog closes on the stage too",
        async () =>
          (await mirror.count(page, "[data-cy='transfer-modal']")) === 0,
      );

      // 6. M7 — Spanish on the customer's screen is Spanish on the stage
      await userPage.locator("[data-cy='topbar-lang-es']").click();
      await until(
        "the customer's page is Spanish",
        async () =>
          (await userPage.evaluate(() => document.documentElement.lang)) ===
            "es",
      );
      await until(
        "the stage's mirror is Spanish",
        async () => (await mirror.attr(page, "html", "lang")) === "es",
      );
      await until(
        "the toggle's state crossed too",
        async () =>
          (await mirror.attr(
            page,
            "[data-cy='topbar-lang-es']",
            "aria-pressed",
          )) === "true",
      );

      // 7. M5 — an app page embedded on the customer's page never joins the demo
      await userPage.evaluate(() => {
        const f = document.createElement("iframe");
        f.src = "/customers";
        f.setAttribute("data-cy", "nested-app");
        f.style.cssText = "width:300px;height:220px;border:0";
        document.body.appendChild(f);
      });
      const nested = userPage.frameLocator("[data-cy='nested-app']");
      await nested.locator("body").waitFor({ timeout: 20_000 });
      await userPage.waitForTimeout(7_000); // longer than a poll of /demo-mode/active
      expect.eq(
        await nested.locator("[data-cy='demo-pill']").count(),
        0,
        "M5: no second pill inside the nested page",
      );
      expect.eq(
        await userPage.locator("[data-cy='demo-pill']").count(),
        1,
        "M5: the customer has one pill",
      );
      expect.eq(
        await page.locator(FRAME).getAttribute("width"),
        "420",
        "M5: the stage still shows the customer's own screen",
      );
      expect.eq(
        await mirror.attr(page, "[data-cy='nested-app']", "src"),
        null,
        "the embedded page is an empty box on the stage, never loaded",
      );

      // 8. pointer-m1 — the presenter rests; the customer changes page; the pointer comes back by itself
      await userPage.goto(`${baseUrl}/customers`);
      await until(
        "the presenter's resting pointer is on the customer's new page",
        async () => (await pointerAt(userPage, "Hans")) !== null,
      );

      // 9. pointer-m2 — the customer's pointer on the stage goes away on their next page
      await userPage.mouse.move(120, 300);
      await userPage.mouse.move(140, 320);
      await until(
        "the stage shows the customer's pointer",
        async () => (await pointerAt(page, "Ana Torres")) !== null,
      );
      await userPage.goto(`${baseUrl}/settings`);
      await until(
        "the stage's mirror follows to /settings",
        async () =>
          (await page.locator(FRAME).getAttribute("data-path")) === "/settings",
        20_000,
      );
      await until(
        "the customer's old pointer is gone from the stage",
        async () => (await pointerAt(page, "Ana Torres")) === null,
      );

      // 10. M6 / pair 4 — the staff browser wrote nothing to /api and its frame ran no app code
      const writes = asked.filter((r) =>
        r.method !== "GET" && /\/api\//.test(r.url) &&
        !/\/api\/(demo-mode|admin)\//.test(r.url)
      );
      expect.eq(
        JSON.stringify(writes.map((r) => `${r.method} ${r.url}`)),
        "[]",
        "M6: no write as the customer from the staff browser",
      );
      const fromFrame = asked.filter((r) => !r.main);
      const bad = fromFrame.filter((r) =>
        !["image", "stylesheet", "font"].includes(r.type)
      );
      expect.eq(
        JSON.stringify(bad.map((r) => `${r.type} ${r.url}`)),
        "[]",
        "pair 4: the frame fetched images, styles and fonts only — never a script, an API call or a page",
      );
      const apiFromStage = asked.filter((r) =>
        /\/api\/(agents|quotes|cron|customers|notifications|clients)/.test(
          r.url,
        )
      );
      expect.eq(
        JSON.stringify(apiFromStage.map((r) => `${r.method} ${r.url}`)),
        "[]",
        "the stage never loads the app's data",
      );

      // 11. End from the customer clears both
      await userPage.locator("[data-cy='demo-end']").click();
      await userPage.locator("[data-cy='demo-pill']").waitFor({
        state: "hidden",
        timeout: 15_000,
      });
      await page.waitForURL(/\/admin/, { timeout: 20_000 });
    } finally {
      await userCtx.close();
    }
  }));
