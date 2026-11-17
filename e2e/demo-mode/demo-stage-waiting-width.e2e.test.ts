/**
 * REQ-846 AMENDMENT (demo-loop run 13, p3; by hand) — the stage's signed-out banner
 * ([data-cy=demo-waiting]) was clipped to the FRAME's width: a 390 px customer on a 1280 px stage
 * read "Maria Lopez cerró sesión Su última pantalla se…" (scrollWidth 571 in 316 px) with the dark
 * stage empty on both sides. It is clipped to the window now, like the row's other badges.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
let LANG = "en";
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
    { name: "pm_lang", value: LANG, domain, path: "/" },
  ]));
}


// deno-lint-ignore no-explicit-any
async function demoOn(page: any, http: StoryTools["http"], baseUrl: string, path: string, lang: "en" | "es", onboarded: boolean) {
  await page.setViewportSize({ width: 1280, height: 800 });
  LANG = lang;
  const userPhone = `+1512${digits()}`;
  const adminPhone = `+1843${digits()}`;
  const user = await verify(http, userPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: user.auth,
    body: JSON.stringify({ language: lang, name: "Maria Lopez" }),
  })).body?.cancel();
  if (onboarded) {
    await answerQuestions(http, user.auth, { name: "Maria Lopez", businessName: "Lopez Roofing" });
  }
  const admin = await verify(http, adminPhone);
  await (await http("/api/me", {
    method: "PUT",
    headers: admin.auth,
    body: JSON.stringify({ language: lang, name: "Alex" }),
  })).body?.cancel();
  const boot = await http("/api/admin/bootstrap", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: adminPhone }),
  });
  await boot.body?.cancel();
  if (boot.status !== 200) throw new Error(`bootstrap: ${boot.status}`);
  const browser = page.context().browser();
  if (!browser) throw new Error("no browser behind the story page");
  const userCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const tab = await userCtx.newPage();
  await useCookie(userCtx, baseUrl, user.cookie);
  await tab.goto(`${baseUrl}${path}?lang=${lang}`);
  await useCookie(page.context(), baseUrl, admin.cookie);
  await page.goto(`${baseUrl}/admin?lang=${lang}`);
  await page.locator("[data-cy='adm-q']").fill(userPhone.slice(2));
  await page.locator("[data-cy='adm-search']").click();
  await page.locator("[data-cy='adm-demo']").first().waitFor({ timeout: 15_000 });
  await page.locator("[data-cy='adm-demo']").first().click();
  await page.locator("[data-cy='demo-pill']").waitFor({ timeout: 15_000 });
  await tab.locator("[data-cy='demo-pill']").waitFor({ timeout: 20_000 });
  return { userCtx, tab };
}

Deno.test("REQ-846 AMENDMENT (demo-loop run 13, p3): a 390×844 customer signs out — the Spanish stage's banner shows the whole sentence in its row, never cut to the phone-sized frame", (t) =>
  story(t, async ({ page, expect, http, baseUrl, folder }) => {
    const { userCtx, tab } = await demoOn(page, http, baseUrl, "/welcome", "es", false);
    try {
      await tab.waitForTimeout(1_500);
      // her sign-out, the tester's way: the API, then /login by hand
      await tab.evaluate(() => fetch("/api/auth/logout", { method: "POST" }).then(() => undefined));
      await tab.goto(`${baseUrl}/login?lang=es`);
      await page.locator("[data-cy='demo-waiting']").waitFor({ timeout: 20_000 });
      await page.waitForTimeout(500);
      await page.screenshot({ path: `${folder}/stage-signed-out-banner.png` });
      const b = await page.evaluate(() => {
        const e = document.querySelector<HTMLElement>("[data-cy='demo-waiting']")!;
        const r = e.getBoundingClientRect();
        const f = document.querySelector<HTMLElement>("[data-cy='demo-frame']")?.getBoundingClientRect();
        return {
          text: (e.textContent ?? "").trim(),
          scrollWidth: e.scrollWidth,
          clientWidth: e.clientWidth,
          box: [r.left, r.top, r.width, r.height].map(Math.round),
          frameW: f ? Math.round(f.width) : null,
          inWindow: r.left >= 0 && r.right <= innerWidth,
        };
      });
      expect(/cerró sesión/.test(b.text), `the banner says she signed out (${b.text})`);
      expect(
        b.scrollWidth <= b.clientWidth + 1,
        `p3: the whole sentence fits its badge, nothing clipped (${JSON.stringify(b)})`,
      );
      expect(b.inWindow, `the badge stays inside the window (${JSON.stringify(b)})`);
      expect(
        b.frameW === null || b.box[2] > b.frameW,
        `the badge is wider than the phone-sized frame it would have been cut to (${JSON.stringify(b)})`,
      );
    } finally {
      await userCtx.close();
    }
  }));
