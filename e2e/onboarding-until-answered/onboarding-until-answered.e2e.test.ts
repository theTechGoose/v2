/**
 * REQ-091 — Raphael, 2026-10-18, after a team phone's first sign-in was eaten by the
 * broken-origin window (the cookie landed on the other domain, the onboarding page bounced)
 * and the next code landed on the dashboard: "onboarding must happen until we get answers
 * to all the questions." Decided with him: Skip stays and the wizard returns; the gate is
 * every code verify and the dashboard.
 *
 * Pages: /login → /verify (front-end/islands/LoginForm.tsx, CodeInput.tsx: the code lands
 * where the backend says, backend/src/users/entrypoints/auth-controller), the wizard at
 * /welcome (front-end/routes/welcome.tsx, islands/WelcomeWizard.tsx), the dashboard's gate
 * (front-end/routes/dashboard/_middleware.ts). On the fakes the code pops up on /verify
 * (REQ-082) and "Use this code" signs in.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions, JSON_HEADERS } from "../_shared/onboarding-answers.ts";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const DESKTOP = { width: 1280, height: 900 };

/** sign in on /login with this phone: the code pops up on /verify, "Use this code" lands wherever the app sends it */
async function codeIn(page: StoryTools["page"], local: string): Promise<URL> {
  await page.goto("/login?lang=en");
  await page.locator("input[type='tel']").fill(local);
  await page.locator("button[type='submit']").click();
  await page.waitForURL((u: URL) => u.pathname === "/verify", { timeout: 60_000 });
  await page.locator("[data-cy='dev-code']").waitFor({ state: "visible", timeout: 15_000 });
  await page.locator("[data-cy='dev-code-use']").click();
  await page.waitForURL((u: URL) => u.pathname !== "/verify", { timeout: 20_000 });
  // read the landing as the app sent it — the dashboard's welcome-back toast drops its
  // query from the address once the island hydrates
  const landed = new URL(page.url());
  await page.waitForLoadState("networkidle");
  return landed;
}

async function sessionAuth(page: StoryTools["page"]): Promise<Record<string, string>> {
  const c = (await page.context().cookies()).find((k: { name: string }) => k.name === "pm_session");
  if (!c) throw new Error("no pm_session cookie on the page");
  return { ...JSON_HEADERS, cookie: `pm_session=${c.value}` };
}

/** a wizard text step: the island may still be hydrating when the input appears */
async function fillStep(page: StoryTools["page"], selector: string, value: string): Promise<void> {
  const input = page.locator(selector);
  await input.waitFor({ timeout: 60_000 });
  for (let attempt = 0; attempt < 8; attempt++) {
    await input.fill(value);
    try {
      await page.locator("[data-cy='welcome-continue']:not([disabled])").waitFor({ timeout: 1500 });
      return;
    } catch { /* not hydrated yet — fill again */ }
  }
  throw new Error(`the wizard never took "${value}" at ${selector}`);
}

Deno.test("REQ-091: onboarding happens until every question is answered — a new account's code lands in the wizard, Skip only puts a question off, 'Skip setup for now' leaves for the assistant, and the dashboard and the next code bring the wizard back at the first open question", (t) =>
  story(t, async ({ page, expect, baseUrl }) => {
    await page.setViewportSize(DESKTOP);
    const host = new URL(baseUrl).hostname;
    await page.context().addCookies([{ name: "pm_lang", value: "en", domain: host, path: "/" }]);
    const local = `512${digits()}`;

    // a brand-new account: the code lands in the wizard, at the first question
    let landed = await codeIn(page, local);
    expect.eq(landed.pathname, "/welcome", `a new account's code lands in the wizard (${landed})`);
    await expect.see("what should we call you");
    await fillStep(page, "input.welcome__input", "Story Person");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("business called");
    // Skip stays: it puts the business name off and moves on
    await page.locator("[data-cy='welcome-skip']").click();
    await expect.see("best email");
    // "Skip setup for now" leaves the wizard — for the assistant, not the dashboard (which would send the person straight back)
    await page.locator("button.welcome__escape").click();
    await page.waitForURL((u: URL) => u.pathname.startsWith("/assistant"), { timeout: 60_000 });
    expect(new URL(page.url()).pathname.startsWith("/assistant"), `skip setup leaves for the assistant (${page.url()})`);

    // the dashboard sends the person back to the wizard, at the first open question
    await page.goto("/dashboard");
    await page.waitForURL((u: URL) => u.pathname === "/welcome", { timeout: 60_000 });
    expect.eq(new URL(page.url()).pathname, "/welcome", "the dashboard sends an unfinished account back to the wizard");
    await expect.see("business called");

    // and so does the next code, returning user or not
    await page.context().clearCookies();
    await page.context().addCookies([{ name: "pm_lang", value: "en", domain: host, path: "/" }]);
    landed = await codeIn(page, local);
    expect.eq(landed.pathname, "/welcome", `the next code lands in the wizard again (${landed})`);
    expect(!landed.search.includes("welcome=back"), "not greeted as back — the wizard, at the open question");
    await expect.see("business called");
  }));

Deno.test("REQ-091: with eight of nine answered the code still lands in the wizard at the open question; with all nine answered it lands on the dashboard, and /welcome lets go", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize(DESKTOP);
    const host = new URL(baseUrl).hostname;
    const english = () => page.context().addCookies([{ name: "pm_lang", value: "en", domain: host, path: "/" }]);
    await english();
    const local = `512${digits()}`;

    let landed = await codeIn(page, local);
    expect.eq(landed.pathname, "/welcome", `a new account's code lands in the wizard (${landed})`);
    // eight answered through the app's own API — the insurance left open
    await answerQuestions(http, await sessionAuth(page), { except: ["insurance"] });
    await page.context().clearCookies();
    await english();
    landed = await codeIn(page, local);
    expect.eq(landed.pathname, "/welcome", `one open question still lands the code in the wizard (${landed})`);
    await expect.see("Are you insured");

    // the ninth answered: the code lands on the dashboard as a returning user
    await answerQuestions(http, await sessionAuth(page), { except: ["name", "businessName", "email", "plan", "state", "address", "payment", "logo"] });
    await page.context().clearCookies();
    await english();
    landed = await codeIn(page, local);
    expect.eq(landed.pathname, "/dashboard", `all nine answered: the code lands on the dashboard (${landed})`);
    expect(landed.search.includes("welcome=back"), "greeted as back");
    // and the wizard lets go: /welcome bounces an account with nothing open to the dashboard
    await page.goto("/welcome");
    await page.waitForURL((u: URL) => u.pathname === "/dashboard", { timeout: 60_000 });
    expect.eq(new URL(page.url()).pathname, "/dashboard", "/welcome bounces a finished account to the dashboard");
  }));
