/**
 * REQ-820 AMENDMENT 5 (demo-loop run 16, m4; by hand) — the customer at 1024×768 (ES, /settings):
 * the right-docked tab's peek, End, the question (671 px wide, kept where it came up), then
 * "Seguir". The pill shrank back to 444 px — and GLIDED 226 px to its box over ~280 ms
 * (`transition: transform 0.25s`), against REQ-820 AMENDMENT 2 ("another form jumps to its box").
 * place() had recorded no size for the asking form (its early return), so the shrink looked like
 * the same size as before the question. The asking form's size is recorded: the shrunk pill is
 * painted at its box in the frame it shrinks.
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
    { name: "pm_lang", value: "es", domain, path: "/" },
  ]));
}

const state = () => {
  const pill = document.querySelector<HTMLElement>("[data-cy='demo-pill']");
  const r = pill?.getBoundingClientRect();
  const cs = pill ? getComputedStyle(pill) : null;
  return {
    box: r ? [r.left, r.top, r.width, r.height].map(Math.round) : null,
    tucked: pill?.hasAttribute("data-tucked") ?? null,
    tf: cs?.transform ?? null,
    tr: cs ? cs.transitionProperty + " " + cs.transitionDuration : null,
    asking: !!document.querySelector("[data-cy='demo-end-ask']"),
  };
};
type Sample = ReturnType<typeof state> & { at: number };

Deno.test("REQ-820 AMENDMENT 5 (demo-loop run 16, m4): 1024×768, ES /settings — End asks on the right-docked peek; 'Seguir' shrinks the pill back, and every frame of the shrunk pill is at its box: no glide from where the question sat", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    const userPhone = `+1512${digits()}`;
    const adminPhone = `+1843${digits()}`;
    const user = await verify(http, userPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: user.auth,
      body: JSON.stringify({ language: "es", name: "Maria Lopez" }),
    })).body?.cancel();
    await answerQuestions(http, user.auth, {
      name: "Maria Lopez",
      businessName: "Lopez Roofing",
    });
    const admin = await verify(http, adminPhone);
    await (await http("/api/me", {
      method: "PUT",
      headers: admin.auth,
      body: JSON.stringify({ language: "es", name: "Alex" }),
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
      viewport: { width: 1024, height: 768 },
    });
    try {
      const tab = await userCtx.newPage();
      await useCookie(userCtx, baseUrl, user.cookie);
      await tab.goto(`${baseUrl}/settings?lang=es`);
      await useCookie(page.context(), baseUrl, admin.cookie);
      await page.goto(`${baseUrl}/admin?lang=es`);
      await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
      await page.locator("[data-cy='adm-search']").click();
      await page.locator("[data-cy='adm-demo']").first().waitFor({
        timeout: 15_000,
      });
      await page.locator("[data-cy='adm-demo']").first().click();
      await page.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
      await tab.locator("[data-cy='demo-pill']").waitFor({ timeout: 20_000 });
      await tab.locator("[data-cy='demo-pill'][data-tucked]").waitFor({
        timeout: 30_000,
      });
      await tab.waitForTimeout(500);
      const tb = (await tab.evaluate(state)).box!;
      const mx = tb[0] + 20, my = tb[1] + 16;
      await tab.mouse.move(mx, my + 100);
      await tab.mouse.move(mx, my);
      await tab.waitForTimeout(600);
      const endBox = await tab.locator("[data-cy='demo-end']").boundingBox();
      if (!endBox) {
        throw new Error(
          "no End on the peek: " + JSON.stringify(await tab.evaluate(state)),
        );
      }
      // a deliberate move onto End (past the approach, REQ-890 AMENDMENT 6), then the click
      await tab.waitForTimeout(400);
      await tab.mouse.move(
        endBox.x + endBox.width / 2,
        endBox.y + endBox.height / 2,
        { steps: 3 },
      );
      await tab.mouse.down();
      await tab.mouse.up();
      await tab.locator("[data-cy='demo-end-ask']").waitFor({ timeout: 5_000 });
      await tab.waitForTimeout(600);
      const askBox = (await tab.evaluate(state)).box;
      const no = await tab.locator("[data-cy='demo-end-cancel']").boundingBox();
      if (!no) throw new Error("no Seguir");
      await tab.mouse.move(no.x + no.width / 2, no.y + no.height / 2, {
        steps: 3,
      });
      // Seguir, sampled every ~8 ms for 1.2 s
      const seen: Sample[] = [];
      const t0 = Date.now();
      const run = (async () => {
        while (Date.now() - t0 < 1_200) {
          seen.push({ at: Date.now() - t0, ...(await tab.evaluate(state)) });
          await tab.waitForTimeout(8);
        }
      })();
      await tab.mouse.down();
      await tab.mouse.up();
      await run;
      await tab.screenshot({ path: `${folder}/after-seguir-1024.png` });
      await Deno.writeTextFile(
        `${folder}/shrink-samples.json`,
        JSON.stringify({ tb, askBox, seen }, null, 1),
      );
      const shrunk = seen.filter((s) => !s.asking && s.box && !s.tucked);
      expect(shrunk.length >= 10, `the shrunk pill was sampled (${seen.length} samples)`);
      const last = shrunk[shrunk.length - 1];
      expect(
        askBox !== null && last.box![2] < askBox[2],
        `the pill shrank from the question's ${askBox?.[2]} px to ${last.box?.[2]} px`,
      );
      const away = shrunk.filter((s) => Math.abs(s.box![0] - last.box![0]) > 4);
      expect(
        away.length === 0,
        `m4: every frame of the shrunk pill is at its box ${
          JSON.stringify(last.box)
        } — no glide from the question's spot ${JSON.stringify(askBox)}: ${
          JSON.stringify(away.slice(0, 6).map((s) => [s.at, s.box, s.tr]))
        }`,
      );
    } finally {
      await userCtx.close();
    }
  }));
