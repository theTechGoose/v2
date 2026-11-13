/**
 * REQ-765 — demo-loop cycle 5v2, issue p18-3d "Send modal dim layer doesn't cover the demo pill",
 * re-opened after REQ-643. The verifier's situation, exactly: a live demo, the customer on a
 * 390×844 phone with the Send dialog open — its `.send-dialog__backdrop` inside
 * `.quote-review__send-split` inside the transformed mobile `.app`, so it is fixed 0 → 780 of 844 —
 * and the STAGE showing the bottom 64 px pill band (beige strip + "DocuMonster · Connected · End
 * demo") at full brightness. REQ-643 dimmed only the customer's own band; the stage draws the band
 * and the pill itself (the mirror skips the overlay), from a pill message with no dim.
 *
 *   1. On the stage the band ghost is painted in the backdrop's dim and the pill ghost is softened.
 *   2. On her screen the band under the dialog is dimmed, and her pill is softened (still
 *      clickable).
 *   3. The dialog closes: both back to full brightness.
 *
 * REQ-781 (demo-loop cycle dv1, d7) AMENDMENT — no band is kept under the page any more, so there
 * is no strip to dim: the dialog's backdrop reaches the window's foot on her screen, the stage
 * draws no band ghost, and the pill (hers and the stage's ghost) is softened under the dim.
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

/** wait for a condition, polling; throws with `what` (and the last detail) when it never comes */
async function until(
  what: string,
  cond: () => Promise<string | null>,
  timeout = 10_000,
) {
  const t0 = Date.now();
  let last: string | null = "never asked";
  while (Date.now() - t0 < timeout) {
    try {
      last = await cond();
      if (last === null) return;
    } catch (e) {
      last = String(e);
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`timed out: ${what} — ${last}`);
}

const DIM = "rgba(20, 44, 48, 0.45)";

/** the customer's bottom strip and pill under the dialog */
const customerProbe = () => {
  const bd = document.querySelector<HTMLElement>(".send-dialog__backdrop");
  const band = document.querySelector<HTMLElement>("[data-cy='demo-band']");
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  const r = bd?.getBoundingClientRect();
  return {
    backdrop: r
      ? { top: Math.round(r.top), bottom: Math.round(r.bottom) }
      : null,
    vh: innerHeight,
    band: band ? getComputedStyle(band).backgroundImage : null,
    bandH: band ? Math.round(band.getBoundingClientRect().height) : 0,
    pillOpacity: pill ? Number(getComputedStyle(pill).opacity) : null,
  };
};

/** the stage's band ghost and pill ghost */
const stageProbe = () => {
  const band = document.querySelector<HTMLElement>(
    "[data-cy='demo-band-ghost']",
  );
  const pill = document.querySelector<HTMLElement>(
    "[data-cy='demo-pill-ghost']",
  );
  return {
    band: band ? getComputedStyle(band).backgroundImage : null,
    bandBg: band ? getComputedStyle(band).backgroundColor : null,
    pill: pill !== null,
    pillOpacity: pill ? Number(getComputedStyle(pill).opacity) : null,
  };
};

Deno.test("REQ-765 (demo-loop cycle 5v2, p18-3d): with the Send dialog open on a 390×844 customer phone, the dialog's dim covers the demo pill and its band — on her screen and on the presenter's stage", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "en", name: "Maria Castro" }),
    })).body?.cancel();
    await answerQuestions(http, user.auth, {
      name: "Maria Castro",
      businessName: "Castro Painting",
    });
    const admin = await verify(http, adminPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: admin.auth,
      body: JSON.stringify({ language: "en", name: "Alex from DocuMonster" }),
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
      viewport: { width: 390, height: 844 },
    });
    try {
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await userPage.goto(`${baseUrl}/assistant`, { timeout: 180_000 });

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
      await userPage.reload({ timeout: 120_000 });
      await userPage.locator("[data-cy='demo-pill'][data-status='live']")
        .waitFor({ timeout: 90_000 });
      // REQ-781 — the stage draws the pill's ghost, and no band ghost (no band is kept)
      await until("the stage draws the pill (and no band)", async () => {
        const s = await page.evaluate(stageProbe);
        return s.band === null && s.pill ? null : JSON.stringify(s);
      }, 60_000);

      // the Send dialog as the app renders it: the backdrop inside .quote-review__send-split,
      // inside the transformed mobile .app (REQ-781: the app reaches the window's foot now)
      await userPage.evaluate(() => {
        const app = document.querySelector(".app") ?? document.body;
        const split = document.createElement("div");
        split.className = "quote-review__send-split";
        split.setAttribute("data-cy", "t-split");
        const bd = document.createElement("div");
        bd.className = "send-dialog__backdrop";
        const card = document.createElement("div");
        card.setAttribute("role", "dialog");
        card.setAttribute("aria-modal", "true");
        card.style.cssText =
          "background:#fff;width:300px;height:220px;border-radius:12px";
        card.textContent = "How do you want to send it?";
        bd.appendChild(card);
        split.appendChild(bd);
        app.appendChild(split);
      });

      // 1. the stage: no band ghost (REQ-781), the pill ghost softened (the verifier's view)
      await until(
        "stage: no band ghost and the pill ghost softened",
        async () => {
          const s = await page.evaluate(stageProbe);
          return s.band === null && s.pillOpacity !== null &&
              s.pillOpacity < 1
            ? null
            : JSON.stringify(s);
        },
        15_000,
      );
      await page.screenshot({ path: `${folder}/stage-dialog.png` });

      // 2. her screen: no band (REQ-781) — the backdrop dims down to the window's foot — and the
      //    pill softens
      await until(
        "customer: the dim reaches the window's foot, no band, the pill softened",
        async () => {
          const c = await userPage.evaluate(customerProbe);
          return c.backdrop !== null && c.backdrop.bottom >= c.vh - 1 &&
              c.bandH === 0 && c.pillOpacity !== null && c.pillOpacity < 1
            ? null
            : JSON.stringify(c);
        },
        15_000,
      );
      await userPage.screenshot({ path: `${folder}/customer-dialog.png` });

      // 3. the dialog closes: both bright again
      await userPage.evaluate(() =>
        document.querySelector("[data-cy='t-split']")?.remove()
      );
      await until("dialog gone: the band and pill bright again", async () => {
        const c = await userPage.evaluate(customerProbe);
        const s = await page.evaluate(stageProbe);
        return c.pillOpacity === 1 && !(c.band ?? "").includes(DIM) &&
            s.pillOpacity === 1 && !(s.band ?? "").includes(DIM)
          ? null
          : JSON.stringify({ c, s });
      }, 15_000);
    } finally {
      await userCtx.close();
    }
  }));
