/**
 * REQ-257 — Raphael: "fix every issue the demo found." Demo issue
 * onboarding-dashboard-settings-p3: on the wizard's insurance step, Enter did
 * nothing — the provider typed, the person pressed Enter and stayed put. The
 * address step had the same gap. The wizard had no <form> and its Continue was
 * a type="button" (RCA: front-end/islands/WelcomeWizard.tsx StepBody/StepFooter).
 *
 * In a browser: an account with the address and the insurance left open signs
 * in, lands on the address step; Enter in the street field saves it and moves
 * to the insurance step; Enter in the provider field saves it and moves to the
 * closing screen. Both answers are on record afterwards.
 *
 * Pages: /login → /verify → /welcome (front-end/islands/WelcomeWizard.tsx).
 */
import { story, type StoryTools } from "#shots";
import {
  answerQuestions,
  JSON_HEADERS,
} from "../_shared/onboarding-answers.ts";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const DESKTOP = { width: 1280, height: 900 };

async function frame(page: StoryTools["page"]): Promise<void> {
  await page.locator("html").hover({ force: true, position: { x: 1, y: 1 } });
}

async function clickAway(
  page: StoryTools["page"],
  selector: string,
): Promise<void> {
  await page.locator(selector).evaluate((el: HTMLElement) => el.click());
}

async function codeIn(page: StoryTools["page"], local: string): Promise<URL> {
  await page.goto("/login?lang=en");
  await page.locator("input[type='tel']").fill(local);
  await clickAway(page, "button[type='submit']");
  await page.waitForURL((u: URL) => u.pathname === "/verify", {
    timeout: 60_000,
  });
  await page.locator("[data-cy='dev-code']").waitFor({
    state: "visible",
    timeout: 15_000,
  });
  await clickAway(page, "[data-cy='dev-code-use']");
  await page.waitForURL((u: URL) => u.pathname !== "/verify", {
    timeout: 20_000,
  });
  const landed = new URL(page.url());
  await page.waitForLoadState("networkidle");
  await frame(page);
  return landed;
}

async function sessionAuth(
  page: StoryTools["page"],
): Promise<Record<string, string>> {
  const c = (await page.context().cookies()).find((k: { name: string }) =>
    k.name === "pm_session"
  );
  if (!c) throw new Error("no pm_session cookie on the page");
  return { ...JSON_HEADERS, cookie: `pm_session=${c.value}` };
}

/** type into a wizard field until the island has hydrated and taken it (Continue enables) */
async function typeIn(
  page: StoryTools["page"],
  selector: string,
  value: string,
): Promise<void> {
  const input = page.locator(selector);
  await input.waitFor({ timeout: 60_000 });
  for (let attempt = 0; attempt < 8; attempt++) {
    await input.fill(value);
    try {
      await page.locator("[data-cy='welcome-continue']:not([disabled])")
        .waitFor({ timeout: 1500 });
      return;
    } catch { /* not hydrated yet — fill again */ }
  }
  throw new Error(`the wizard never took "${value}" at ${selector}`);
}

Deno.test("REQ-257: Enter submits the wizard's address and insurance steps — Enter in the street field saves the address and moves on, Enter in the insurance provider saves it and moves to the closing screen (demo onboarding-dashboard-settings-p3)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize(DESKTOP);
    const host = new URL(baseUrl).hostname;
    const english = () =>
      page.context().addCookies([{
        name: "pm_lang",
        value: "en",
        domain: host,
        path: "/",
      }]);
    await english();
    const local = `512${digits()}`;

    // a new account, everything answered but the address and the insurance
    let landed = await codeIn(page, local);
    expect.eq(
      landed.pathname,
      "/welcome",
      `a new account's code lands in the wizard (${landed})`,
    );
    const auth = await sessionAuth(page);
    await answerQuestions(http, auth, { except: ["address", "insurance"] });
    await page.context().clearCookies();
    await english();
    landed = await codeIn(page, local);
    expect.eq(
      landed.pathname,
      "/welcome",
      `two open questions land the code in the wizard (${landed})`,
    );

    // the address step: type the street, press Enter — no click on Continue
    await expect.see("Where's the business based?");
    const street = "input[aria-label='Street address']";
    await typeIn(page, street, "1600 Congress Ave");
    await page.locator(street).press("Enter");
    await expect.see("Are you insured?");

    // the insurance step: type the provider, press Enter
    const provider = "input[aria-label='Insurance provider']";
    await typeIn(page, provider, "State Farm");
    await page.locator(provider).press("Enter");
    await expect.see("See what your customer sees");

    // both answers are on record
    const snap =
      await (await http("/api/profile", { headers: await sessionAuth(page) }))
        .json() as {
          address?: { street?: string };
          insurance?: { provider?: string };
        };
    expect.eq(
      snap.address?.street,
      "1600 Congress Ave",
      "Enter saved the street",
    );
    expect.eq(
      snap.insurance?.provider,
      "State Farm",
      "Enter saved the insurance provider",
    );
  }));
