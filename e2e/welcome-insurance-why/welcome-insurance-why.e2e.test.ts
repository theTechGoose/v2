/**
 * REQ-1151 (LOOP-007 q3, q3-83) — the onboarding insurance step's "why" line
 * said "Lets you attach proof of insurance to your quotes." / "Te permite
 * adjuntar comprobante de seguro a tus cotizaciones.", but the step has only the
 * provider and policy-number boxes (no file input), the certificate upload lives
 * only in Settings, and no quote surface carries insurance. The line must not
 * promise attaching proof unless the step offers a file input.
 *
 * Pages: /login → /verify (dev code popup) → /welcome at the insurance step
 * (every other question answered through the app's own API).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions, JSON_HEADERS } from "../_shared/onboarding-answers.ts";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function clickAway(page: StoryTools["page"], selector: string): Promise<void> {
  await page.locator(selector).evaluate((el: HTMLElement) => el.click());
}

/** The frontend can be up before the backend it proxies to; a 502 on send-otp strands the login form. */
async function backendUp(baseUrl: string): Promise<void> {
  const until = Date.now() + 240_000;
  while (Date.now() < until) {
    const r = await fetch(new URL("/api/profile", baseUrl)).catch(() => null);
    await r?.body?.cancel();
    if (r && r.status !== 502 && r.status !== 503) return;
    await new Promise((ok) => setTimeout(ok, 1_000));
  }
  throw new Error("the backend never answered behind the frontend proxy");
}

async function codeIn(page: StoryTools["page"], local: string, lang: string): Promise<URL> {
  await page.goto(`/login?lang=${lang}`);
  await page.locator("input[type='tel']").fill(local);
  await clickAway(page, "button[type='submit']");
  await page.waitForURL((u: URL) => u.pathname === "/verify", { timeout: 60_000 });
  await page.locator("[data-cy='dev-code']").waitFor({ state: "visible", timeout: 15_000 });
  await clickAway(page, "[data-cy='dev-code-use']");
  await page.waitForURL((u: URL) => u.pathname !== "/verify", { timeout: 20_000 });
  const landed = new URL(page.url());
  await page.waitForLoadState("networkidle");
  return landed;
}

async function sessionAuth(page: StoryTools["page"]): Promise<Record<string, string>> {
  const c = (await page.context().cookies()).find((k: { name: string }) => k.name === "pm_session");
  if (!c) throw new Error("no pm_session cookie on the page");
  return { ...JSON_HEADERS, cookie: `pm_session=${c.value}` };
}

const CASES = [
  { lang: "en", question: "Are you insured", promise: /attach/i },
  { lang: "es", question: "¿Tienes seguro?", promise: /adjuntar/i },
] as const;

for (const c of CASES) {
  Deno.test(`REQ-1151 q3-83: the onboarding insurance step (${c.lang}) does not promise attaching proof of insurance to quotes when it has no upload`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      await page.setViewportSize({ width: 1280, height: 900 });
      const host = new URL(baseUrl).hostname;
      const setLang = () => page.context().addCookies([{ name: "pm_lang", value: c.lang, domain: host, path: "/" }]);
      await setLang();
      await backendUp(baseUrl);
      const local = `512${digits()}`;

      let landed = await codeIn(page, local, c.lang);
      expect.eq(landed.pathname, "/welcome", `a new account's code lands in the wizard (${landed})`);
      // everything answered but insurance
      await answerQuestions(http, await sessionAuth(page), { except: ["insurance"] });
      await page.context().clearCookies();
      await setLang();
      landed = await codeIn(page, local, c.lang);
      expect.eq(landed.pathname, "/welcome", `the open insurance question lands the code in the wizard (${landed})`);
      await expect.see(c.question);

      const { why, fileInputs } = await page.evaluate(() => ({
        why: (document.querySelector("p.welcome__why")?.textContent ?? "").trim(),
        fileInputs: document.querySelectorAll(".welcome input[type='file'], main input[type='file']").length,
      }));
      expect(why.length > 0, `REQ-1151: the insurance step shows its why line (got "${why}")`);
      if (fileInputs === 0) {
        expect(
          !c.promise.test(why),
          `REQ-1151: with no file input on the step, the why line must not promise attaching proof of insurance (got "${why}")`,
        );
      }
    }));
}
