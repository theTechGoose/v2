/**
 * REQ-969 (LOOP-007 q1, q1-46) — the onboarding state step told a new owner the
 * state "sets the governing state on your agreements", but REQ-015 fixed the
 * agreement's clause to "the laws of the state where the work is performed": no
 * state is ever put into it. The state is saved only on the business address
 * (front-end/islands/WelcomeWizard.tsx StateStep), so the "why" line must say that.
 *
 * Pages: /login → /verify (dev code popup) → /welcome at the state step (every
 * other question answered through the app's own API).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions, JSON_HEADERS } from "../_shared/onboarding-answers.ts";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function clickAway(page: StoryTools["page"], selector: string): Promise<void> {
  await page.locator(selector).evaluate((el: HTMLElement) => el.click());
}

async function codeIn(page: StoryTools["page"], local: string): Promise<URL> {
  await page.goto("/login?lang=en");
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

Deno.test("REQ-969 q1-46: the onboarding state step says the state goes on the business address — it does not promise a governing state the agreement never names", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    const host = new URL(baseUrl).hostname;
    const english = () => page.context().addCookies([{ name: "pm_lang", value: "en", domain: host, path: "/" }]);
    await english();
    const local = `512${digits()}`;

    let landed = await codeIn(page, local);
    expect.eq(landed.pathname, "/welcome", `a new account's code lands in the wizard (${landed})`);
    // everything answered but the state (and the address, which shares its PUT)
    await answerQuestions(http, await sessionAuth(page), { except: ["state", "address"] });
    await page.context().clearCookies();
    await english();
    landed = await codeIn(page, local);
    expect.eq(landed.pathname, "/welcome", `the open state question lands the code in the wizard (${landed})`);
    await expect.see("Which state is your business in");

    const why = (await page.locator("p.welcome__why").first().textContent() ?? "").trim();
    expect(!/governing state/i.test(why), `REQ-969: the state step's why line makes no governing-state promise (got "${why}")`);
    expect(/address/i.test(why), `REQ-969: the state step's why line says it goes on the business address (got "${why}")`);
  }));
