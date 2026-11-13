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

Deno.test("REQ-091: onboarding happens until every question is answered — a new account's code lands in the wizard, Skip only puts a question off, 'Skip setup for now' (REQ-504) defers what is open and opens the dashboard, whose sidebar link no longer loops, and the next code brings the wizard back at the first open question", (t) =>
  story(t, async ({ page, expect, baseUrl }) => {
    await page.setViewportSize(DESKTOP);
    const host = new URL(baseUrl).hostname;
    await page.context().addCookies([{ name: "pm_lang", value: "en", domain: host, path: "/" }]);
    const local = `512${digits()}`;

    // a brand-new account: the code lands in the wizard, at the first question
    let landed = await codeIn(page, local);
    expect.eq(landed.pathname, "/welcome", `a new account's code lands in the wizard (${landed})`);
    await expect.see("what should we call you");
    // REQ-504: the name cannot be put off, so the escape is not offered before it
    expect.eq(await page.locator("button.welcome__escape").count(), 0, "no 'Skip setup for now' before the name");
    await fillStep(page, "input.welcome__input", "Story Person");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("business called");
    // Skip stays: it puts the business name off and moves on
    await page.locator("[data-cy='welcome-skip']").click();
    await expect.see("best email");
    // REQ-504 (demo M37, cycle 3): "Skip setup for now" defers every open question.
    // REQ-797 (Raphael, 2026-11-13: "after setup people go to assistant"): it lands on the
    // assistant, the same place finishing setup does — not the dashboard
    await clickAway(page, "button.welcome__escape");
    await page.waitForURL((u: URL) => u.pathname.startsWith("/assistant"), { timeout: 60_000 });
    await page.waitForLoadState("networkidle");
    await frame(page); // the assistant, where the escape lands
    expect.eq(new URL(page.url()).pathname.startsWith("/assistant"), true, `REQ-797: skip setup opens the assistant (${page.url()})`);
    // and coming back to it (the sidebar's Dashboard link) stays there; the setup checklist asks for the rest
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    expect.eq(new URL(page.url()).pathname, "/dashboard", "the dashboard no longer bounces to the wizard after the escape");

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

    // the wizard asks the two open questions and the closing screen, the business name first — each
    // counted at its place in the whole onboarding (REQ-253; REQ-427: the wizard navigates the whole
    // registry, so the business name is the second step and the answered name is one Back away)
    await expect.see("business called");
    await expect.see("Step 2 of 10");
    await fillStep(page, "input.welcome__input", "Story Roofing LLC");
    await page.locator("[data-cy='welcome-continue']").click();
    // straight to the logo: not the email, the plan, the state, the address or the payment methods, all answered
    await expect.see("Add your logo");
    await expect.see("Step 8 of 10");
    const card = await page.locator(".welcome__card").innerText();
    expect(!/best email|Pick your plan|Which state|business based|get paid/.test(card), `no answered question is asked again (${card.slice(0, 80)})`);
    // the logo put off: the closing screen, the last of the three — never the insurance, answered
    await page.locator("[data-cy='welcome-skip']").click();
    await expect.see("See what your customer sees");
    await expect.see("Step 10 of 10");
    const closing = await page.locator(".welcome__card").innerText();
    expect(!/insured/.test(closing), "the insurance, answered, is not asked again");
  }));

/** REQ-427: click until `done` holds — a click before the island hydrates does nothing */
async function clickUntil(page: StoryTools["page"], selector: string, done: () => Promise<boolean>): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch { /* not clickable yet: the polls below say whether the effect landed */ }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`clicking ${selector} never took effect`);
}

/**
 * REQ-427 — demo-loop cycle 2, issue p13-s: after a reload the wizard's Back button was gone.
 * REQ-121 built the visit from the open questions alone and started at its first, so the step a
 * reload landed on had nothing before it. The wizard now navigates the whole onboarding: it opens
 * at the first open question, Back reaches the answered one before it, and Continue still skips
 * every question answered before the wizard opened.
 */
Deno.test("REQ-427: Back survives a reload — answered in the wizard, the page reloaded: Back is there and goes to the previous answered question, filled in; Continue goes forward again", (t) =>
  story(t, async ({ page, expect, baseUrl }) => {
    await page.setViewportSize(DESKTOP);
    const host = new URL(baseUrl).hostname;
    await page.context().addCookies([{ name: "pm_lang", value: "en", domain: host, path: "/" }]);
    const local = `512${digits()}`;
    const back = ".welcome__footer > button.welcome__btn--ghost";
    const question = () => page.locator(".welcome__question").innerText().catch(() => "");

    const landed = await codeIn(page, local);
    expect.eq(landed.pathname, "/welcome", `a new account's code lands in the wizard (${landed})`);
    await expect.see("what should we call you");
    expect.eq(await page.locator(back).count(), 0, "the first question has no Back");
    // the demo's path: the name and the business name answered in the wizard, then a reload
    await fillStep(page, "input.welcome__input", "Story Person");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("business called");
    await fillStep(page, "input.welcome__input", "Story Roofing LLC");
    await page.locator("[data-cy='welcome-continue']").click();
    await expect.see("best email");
    await expect.see("Step 3 of 10");

    await page.reload();
    await page.waitForLoadState("networkidle");
    await expect.see("best email");
    await expect.see("Step 3 of 10");
    await page.locator(back).waitFor({ state: "visible", timeout: 15_000 });
    expect.eq(await page.locator(back).count(), 1, "after the reload the email step still has Back (the demo: it was gone)");

    // Back: the business name, as answered
    await clickUntil(page, back, async () => /business called/.test(await question()));
    await expect.see("Step 2 of 10");
    expect.eq(await page.locator("input.welcome__input").first().inputValue(), "Story Roofing LLC", "the answered business name is filled in");
    // and Back again: the name
    await clickUntil(page, back, async () => /call you/.test(await question()));
    await expect.see("Step 1 of 10");
    expect.eq(await page.locator("input.welcome__input").inputValue(), "Story Person", "the answered name is filled in");
    // Continue walks forward again to the email
    await page.locator("[data-cy='welcome-continue']:not([disabled])").click();
    await expect.see("business called");
    await page.locator("[data-cy='welcome-continue']:not([disabled])").click();
    await expect.see("best email");
    await expect.see("Step 3 of 10");
  }));

/**
 * REQ-227 — the 20-agent demo (M2, test-setup-claims-nc-dashboard): the dashboard bounced every
 * account without a logo back to "Add your logo", forever, because a step's Skip saved nothing.
 * Decision (orchestrator, keeping REQ-091): Skip saves a per-question "deferred" stamp; the
 * dashboard lets the person through when every open question is deferred, and its setup
 * checklist asks for what is left; the next code still brings the wizard back to ask again.
 */
Deno.test("REQ-227: the logo skipped in the wizard is deferred — /dashboard opens with the setup checklist asking for it; the next code lands in the wizard at the logo again", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize(DESKTOP);
    const host = new URL(baseUrl).hostname;
    const english = () => page.context().addCookies([{ name: "pm_lang", value: "en", domain: host, path: "/" }]);
    await english();
    const local = `512${digits()}`;

    let landed = await codeIn(page, local);
    expect.eq(landed.pathname, "/welcome", `a new account's code lands in the wizard (${landed})`);
    await answerQuestions(http, await sessionAuth(page), { except: ["logo"] });
    await page.goto("/welcome");
    await expect.see("Add your logo");

    // before the skip, the logo is open and not deferred: the dashboard still sends the person back
    await page.goto("/dashboard");
    await page.waitForURL((u: URL) => u.pathname === "/welcome", { timeout: 60_000 });
    await expect.see("Add your logo");

    // Skip puts the logo off: the wizard moves on to its closing screen
    await page.locator("[data-cy='welcome-skip']").waitFor({ timeout: 60_000 });
    await page.locator("[data-cy='welcome-skip']").click();
    await expect.see("See what your customer sees");

    // the dashboard now opens, and its setup checklist asks for the logo
    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    expect.eq(new URL(page.url()).pathname, "/dashboard", "a deferred logo no longer bounces the dashboard");
    await expect.see("Upload your logo");

    // the next code still asks again (REQ-091 stands): the wizard, at the logo
    await page.context().clearCookies();
    await english();
    landed = await codeIn(page, local);
    expect.eq(landed.pathname, "/welcome", `the next code brings the wizard back (${landed})`);
    await expect.see("Add your logo");
  }));

/**
 * REQ-227 — demo-lifecycle-p2: a staff login went through the customer onboarding ("Paso 1 de 10",
 * a CompleteRegistration pixel), and the admin's own /admin row offered Demo (a demo on yourself).
 */
Deno.test("REQ-227: staff are never sent through the customer wizard — a super admin's code lands on the dashboard, /welcome lets them go, and their own /admin row has no Demo or Impersonate", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize(DESKTOP);
    const host = new URL(baseUrl).hostname;
    const english = () => page.context().addCookies([{ name: "pm_lang", value: "en", domain: host, path: "/" }]);
    await english();
    const staffLocal = `843${digits()}`;
    const customerLocal = `512${digits()}`;

    // a customer, so the admin's list has another row to compare with
    let landed = await codeIn(page, customerLocal);
    expect.eq(landed.pathname, "/welcome", `a customer's code lands in the wizard (${landed})`);
    await page.context().clearCookies();
    await english();

    // a fresh account made staff: nothing of onboarding answered
    landed = await codeIn(page, staffLocal);
    const boot = await http("/api/admin/bootstrap", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: `+1${staffLocal}` }),
    });
    expect.eq(boot.status, 200, "the staff phone is bootstrapped as a super admin");
    await boot.body?.cancel();
    await page.context().clearCookies();
    await english();
    landed = await codeIn(page, staffLocal);
    expect.eq(landed.pathname, "/dashboard", `a staff code lands on the dashboard, not the wizard (${landed})`);

    await page.goto("/dashboard");
    await page.waitForLoadState("networkidle");
    expect.eq(new URL(page.url()).pathname, "/dashboard", "the dashboard does not send staff to the wizard");
    await page.goto("/welcome");
    await page.waitForURL((u: URL) => u.pathname === "/dashboard", { timeout: 60_000 });
    expect.eq(new URL(page.url()).pathname, "/dashboard", "/welcome lets staff go");

    // /admin: the staff's own row has no Demo/Impersonate; the customer's row has both
    await page.goto("/admin");
    for (const [local, own] of [[staffLocal, true], [customerLocal, false]] as const) {
      await page.locator("[data-cy='adm-q']").fill(local);
      await page.locator("[data-cy='adm-search']").click();
      // the row of this phone (formatted on the page — its last four digits are on it as typed)
      const row = page.locator("tbody tr").filter({ hasText: local.slice(-4) }).first();
      await row.waitFor({ timeout: 15_000 });
      const demo = await row.locator("[data-cy='adm-demo']").count();
      const imp = await row.locator("button", { hasText: "Impersonate" }).count();
      if (own) {
        expect.eq(demo + imp, 0, "the staff's own row offers neither Demo nor Impersonate");
      } else {
        expect.eq(demo, 1, "a customer's row offers Demo");
        expect.eq(imp, 1, "a customer's row offers Impersonate");
      }
    }
  }));
