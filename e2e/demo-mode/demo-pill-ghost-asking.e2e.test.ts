/**
 * REQ-822 — demo-loop cycle dm1, issue m1: while the customer's pill asked "End the demo with
 * Alex? Yes, end it / Keep going", the stage's ghost of it still read "Demo mode · Alex is guiding
 * you · Connected · End demo …" — the presenter never learned the customer was about to end the
 * demo. The face now carries the question; the ghost draws it with disabled answers and the
 * stage's own pill says the customer is deciding.
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

Deno.test("REQ-822 (demo-loop cycle dm1, m1): while the customer's End asks \"End the demo with …?\", the stage's ghost draws that question with disabled Yes / Keep going chips (no End chip) and the stage's pill says the customer is deciding; Keep going puts End back on both", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
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
      viewport: { width: 1280, height: 800 },
    });
    try {
      const userPage = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await userPage.goto(`${baseUrl}/customers`);

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
      await until("the customer's pill says Connected", async () => {
        const s = await userPage.locator("[data-cy='demo-pill']")
          .getAttribute("data-status").catch(() => null);
        return s === "live" ? null : `status ${s}`;
      }, 25_000);
      const ghost = page.locator("[data-cy='demo-pill-ghost']");
      await ghost.waitFor({ state: "attached", timeout: 15_000 });

      // the customer taps End — the whole pill's, or (folded to its mini-pill: REQ-637/REQ-821)
      // the mini-pill's x, which brings the whole pill out already asking. Their pill asks
      const folded = await userPage.locator("[data-cy='demo-pill-tab-end']")
        .isVisible().catch(() => false);
      await userPage.locator(
        folded
          ? "[data-cy='demo-pill-tab-end']"
          : "[data-cy='demo-pill'] [data-cy='demo-end']",
      ).click();
      await userPage.locator("[data-cy='demo-pill'] [data-cy='demo-end-ask']")
        .waitFor({ state: "visible", timeout: 5_000 });
      const asked = (await userPage.locator(
        "[data-cy='demo-pill'] [data-cy='demo-end-ask'] > span",
      ).first().textContent())?.trim() ?? "";
      expect(
        /^End the demo with Alex\?$/.test(asked),
        `the customer's pill asks "End the demo with Alex?" — got ${asked}`,
      );
      await userPage.screenshot({ path: `${folder}/customer-asking.png` });

      // the stage's ghost draws the same question, word for word, with both answers disabled
      await until("the stage's ghost draws the question", async () => {
        const g = await ghost.evaluate((el) => ({
          ask: el.querySelector("[data-cy='demo-pill-ghost-ask']")
            ?.textContent?.trim() ?? null,
          yes: el.querySelector("[data-cy='demo-pill-ghost-yes']")
            ?.getAttribute("aria-disabled") ?? null,
          yesText: el.querySelector("[data-cy='demo-pill-ghost-yes']")
            ?.textContent?.trim() ?? null,
          noText: el.querySelector("[data-cy='demo-pill-ghost-no']")
            ?.textContent?.trim() ?? null,
          end: el.querySelector("[data-cy='demo-pill-ghost-end']") !== null,
          text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
        })).catch((e) => ({ err: String(e) }));
        return "ask" in g && g.ask === asked && g.yes === "true" &&
            g.yesText === "Yes, end it" && g.noText === "Keep going" &&
            !g.end
          ? null
          : JSON.stringify(g);
      }, 8_000).catch(async (e) => {
        await page.screenshot({ path: `${folder}/stage-ghost-RED.png` });
        throw e;
      });
      // and the stage's own pill tells the presenter, wherever the ghost is
      const badge = page.locator("[data-cy='demo-customer-asking-end']");
      await badge.waitFor({ state: "visible", timeout: 5_000 });
      expect(
        /Ana Torres is deciding whether to end the demo/.test(
          (await badge.textContent()) ?? "",
        ),
        `the stage's pill says the customer is deciding — ${await badge
          .textContent()}`,
      );
      await page.screenshot({ path: `${folder}/stage-asking.png` });

      // Keep going: End is back on the customer's pill, and on the ghost; the badge goes
      // (Escape is Keep going: the focus sits on it — REQ-235 — and the widened pill can run past
      // the window's right edge, where a click cannot reach it)
      await userPage.keyboard.press("Escape");
      await userPage.locator("[data-cy='demo-end-ask']").waitFor({
        state: "detached",
        timeout: 5_000,
      });
      // End is back on the ghost (or the pill folded again: the ghost is its mini-pill)
      await page.locator(
        "[data-cy='demo-pill-ghost-end'], [data-cy='demo-pill-ghost'][data-tucked]",
      ).first().waitFor({ state: "attached", timeout: 8_000 });
      await page.locator("[data-cy='demo-pill-ghost-ask']").waitFor({
        state: "detached",
        timeout: 8_000,
      });
      await badge.waitFor({ state: "detached", timeout: 8_000 });
    } finally {
      await userCtx.close();
    }
  }));
