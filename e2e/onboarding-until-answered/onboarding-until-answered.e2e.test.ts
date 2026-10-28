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

/** a frame of the page as it stands (the runner shoots after every action; a hover changes nothing —
 *  forced, so a fixed overlay such as the code popup does not hold it up) */
async function frame(page: StoryTools["page"]): Promise<void> {
  await page.locator("html").hover({ force: true, position: { x: 1, y: 1 } });
}

/** a click that leaves the page, taken off-camera: the runner's frame after a click can land mid-navigation
 *  (Chromium's "Unable to capture screenshot"), so the landed page gets its own frame instead */
async function clickAway(page: StoryTools["page"], selector: string): Promise<void> {
  await page.locator(selector).evaluate((el: HTMLElement) => el.click());
}

/** sign in on /login with this phone: the code pops up on /verify, "Use this code" lands wherever the app sends it */
async function codeIn(page: StoryTools["page"], local: string): Promise<URL> {
  await page.goto("/login?lang=en");
  await page.locator("input[type='tel']").fill(local);
  await clickAway(page, "button[type='submit']");
  await page.waitForURL((u: URL) => u.pathname === "/verify", { timeout: 60_000 });
  await page.locator("[data-cy='dev-code']").waitFor({ state: "visible", timeout: 15_000 });
  await frame(page); // the code page, the popup on it
  await clickAway(page, "[data-cy='dev-code-use']");
  await page.waitForURL((u: URL) => u.pathname !== "/verify", { timeout: 20_000 });
  // read the landing as the app sent it — the dashboard's welcome-back toast drops its
  // query from the address once the island hydrates
  const landed = new URL(page.url());
  await page.waitForLoadState("networkidle");
  await frame(page); // where the code landed
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
    await clickAway(page, "button.welcome__escape");
    await page.waitForURL((u: URL) => u.pathname.startsWith("/assistant"), { timeout: 60_000 });
    await page.waitForLoadState("networkidle");
    await frame(page); // the assistant, where the escape lands
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

/**
 * REQ-121 — Raphael, 2026-10-23: "we should not ask the onboarding questions that we already
 * have an answer to on next login, if you login and have not completed question it should show
 * only questions that have not been answered." The wizard asks the questions with no answer on
 * record when it opens, then the closing sample-quote screen; the progress counts those alone.
 */
Deno.test("REQ-121: a later login asks only the questions still open — with the business name and the logo left open the wizard is three steps, the business name, the logo and the sample quote; the seven answered are never shown again, and a brand-new account still meets all ten", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize(DESKTOP);
    const host = new URL(baseUrl).hostname;
    const english = () => page.context().addCookies([{ name: "pm_lang", value: "en", domain: host, path: "/" }]);
    await english();
    const local = `512${digits()}`;

    // a brand-new account: every question, the wizard ten steps long (REQ-120)
    let landed = await codeIn(page, local);
    expect.eq(landed.pathname, "/welcome", `a new account's code lands in the wizard (${landed})`);
    await expect.see("what should we call you");
    await expect.see("Step 1 of 10");

    // seven answered through the app's own API — the business name and the logo left open
    await answerQuestions(http, await sessionAuth(page), { except: ["businessName", "logo"] });
    await page.context().clearCookies();
    await english();
    landed = await codeIn(page, local);
    expect.eq(landed.pathname, "/welcome", `two open questions still land the code in the wizard (${landed})`);

    // the wizard is the two open questions and the closing screen: three steps, the business name first
    await expect.see("business called");
    await expect.see("Step 1 of 3");
    await fillStep(page, "input.welcome__input", "Story Roofing LLC");
    await page.locator("[data-cy='welcome-continue']").click();
    // straight to the logo: not the email, the plan, the state, the address or the payment methods, all answered
    await expect.see("Add your logo");
    await expect.see("Step 2 of 3");
    const card = await page.locator(".welcome__card").innerText();
    expect(!/best email|Pick your plan|Which state|business based|get paid/.test(card), `no answered question is asked again (${card.slice(0, 80)})`);
    // the logo put off: the closing screen, the last of the three — never the insurance, answered
    await page.locator("[data-cy='welcome-skip']").click();
    await expect.see("See what your customer sees");
    await expect.see("Step 3 of 3");
    const closing = await page.locator(".welcome__card").innerText();
    expect(!/insured/.test(closing), "the insurance, answered, is not asked again");
  }));
