/**
 * REQ-890 AMENDMENT 4 (demo-loop run 15, m2; by hand) — the customer's folded tab docked on the
 * RIGHT edge (390×844, /dashboard): a mouse resting on its "Demo" label opens the peek flush with
 * the tab, so End sits exactly where the tab was — under the pointer. The click meant for "Demo"
 * ("Connected · Show the demo controls") asked to end the demo, three times for tester 4 and
 * once (through a Playwright click) for tester 2. A click where the pointer opened the peek,
 * before the pointer has moved on, is the tab's: it shows the controls (the details) and never
 * asks. Once the pointer has moved, End is End.
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
  if (!cookie) throw new Error("sign-in: no session cookie");
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

const pillState = () => {
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  const r = pill?.getBoundingClientRect();
  const det = document.querySelector<HTMLElement>("[data-cy='demo-details']");
  return {
    box: r ? [r.left, r.top, r.width, r.height].map(Math.round) : null,
    tucked: pill?.hasAttribute("data-tucked") ?? null,
    peek: pill?.hasAttribute("data-peek") ?? null,
    asking: !!document.querySelector("[data-cy='demo-end-ask']"),
    details: det ? getComputedStyle(det).display !== "none" : false,
    text: (pill?.innerText ?? "").replace(/\s+/g, " ").slice(0, 80),
  };
};
const underPoint = ([x, y]: [number, number]) => {
  const e = document.elementFromPoint(x, y);
  const b = e?.closest("button");
  return b ? (b.getAttribute("data-cy") ?? b.textContent?.trim() ?? "") : (e?.getAttribute("data-cy") ?? e?.tagName ?? null);
};

Deno.test("REQ-890 AMENDMENT 4 (demo-loop run 15, m2): a mouse resting on the right-edge tab's 'Demo' opens the peek with End under it — the click there shows the controls and never asks to end the demo; after the mouse has moved, End asks as ever", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "en", name: "Maria Lopez" }),
    })).body?.cancel();
    await answerQuestions(http, user.auth, {
      name: "Maria Lopez",
      businessName: "Lopez Roofing",
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
    await boot.body?.cancel();
    expect.eq(boot.status, 200, "Alex is a super admin");
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const userCtx = await browser.newContext({
      viewport: { width: 390, height: 844 },
    });
    try {
      const tab = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await tab.goto(`${baseUrl}/dashboard?lang=en`);
      await useCookie(page.context(), baseUrl, admin.cookie);
      await page.goto(`${baseUrl}/admin?lang=en`);
      await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
      await page.locator("[data-cy='adm-search']").click();
      await page.locator("[data-cy='adm-demo']").first().waitFor({
        timeout: 15_000,
      });
      await page.locator("[data-cy='adm-demo']").first().click();
      await page.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
      await tab.locator("[data-cy='demo-pill']").waitFor({ timeout: 20_000 });
      // the pill folds to its tab (REQ-545): on /dashboard at 390 it docks on the right edge
      await tab.locator("[data-cy='demo-pill'][data-tucked]").waitFor({
        timeout: 30_000,
      });
      await tab.waitForTimeout(500);
      const tabBox = (await tab.evaluate(pillState)).box!;
      // the mouse comes up to the tab's "Demo" label and rests there
      const mx = tabBox[0] + 40, my = tabBox[1] + 16;
      await tab.mouse.move(mx, my + 120);
      await tab.mouse.move(mx, my + 60);
      await tab.mouse.move(mx, my);
      await tab.waitForTimeout(700);
      const hovered = await tab.evaluate(pillState);
      const under = await tab.evaluate(underPoint, [mx, my] as [number, number]);
      expect(
        hovered.peek === true,
        `the resting mouse opened the peek (${JSON.stringify(hovered)})`,
      );
      // the click aimed at "Demo": whatever the peek put under the mouse
      await tab.mouse.down();
      await tab.mouse.up();
      await tab.waitForTimeout(500);
      const clicked = await tab.evaluate(pillState);
      await tab.screenshot({ path: `${folder}/tab-hover-click-390.png` });
      expect(
        !clicked.asking,
        `m2: the click where the mouse opened the peek never asks to end the demo (under the mouse: ${under}; ${
          JSON.stringify(clicked)
        })`,
      );
      if (under === "demo-end") {
        expect(
          clicked.details,
          `the click was the tab's: it shows the controls (${JSON.stringify(clicked)})`,
        );
      }
      // the mouse moves on inside the peek, to End, and clicks: End is End again
      const endBox = await tab.locator("[data-cy='demo-end']").boundingBox();
      expect(endBox !== null, "End is on the peek");
      const ex = endBox!.x + endBox!.width / 2, ey = endBox!.y + endBox!.height / 2;
      await tab.mouse.move(mx + 30, my + 4);
      await tab.mouse.move(ex, ey);
      await tab.waitForTimeout(150);
      await tab.mouse.down();
      await tab.mouse.up();
      await tab.locator("[data-cy='demo-end-ask']").waitFor({ timeout: 5_000 });
      await tab.locator("[data-cy='demo-end-cancel']").click();
    } finally {
      await userCtx.close();
    }
  }));
