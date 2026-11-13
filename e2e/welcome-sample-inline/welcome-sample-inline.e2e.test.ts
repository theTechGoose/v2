/**
 * REQ-433 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3, issue M13: onboarding step 10 "See what your
 * customer sees" was an empty grey box on the demo stage. The step embedded
 * the sample as <iframe src="/q/<id>">, and the stage mirror never carries an
 * embedded page (REQ-242). The sample is now rendered inline, so the quote is
 * ordinary DOM in the wizard — what the mirror records.
 *
 * In a browser: a roofer's account with only the insurance open answers it and
 * reaches step 10; the sample's job name is on the wizard page itself (not in
 * a frame), the page holds no iframe, and the open-full-size link still points
 * at /q/<id>. REQ-736 (demo p10, cycle 5): the sample holds no owner preview
 * banner, no "your own quote" box and no button — a read-only signature block.
 *
 * Pages: /login → /verify → /welcome (front-end/islands/WelcomeWizard.tsx,
 * front-end/components/SampleQuotePreview.tsx).
 */
import { story, type StoryTools } from "#shots";
import {
  answerQuestions,
  JSON_HEADERS,
} from "../_shared/onboarding-answers.ts";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const DESKTOP = { width: 1280, height: 900 };
const en = JSON.parse(
  await Deno.readTextFile(new URL("../../lang/en.json", import.meta.url)),
) as Record<string, string>;

async function clickAway(
  page: StoryTools["page"],
  selector: string,
): Promise<void> {
  await page.locator(selector).evaluate((el: HTMLElement) => el.click());
}

async function codeIn(page: StoryTools["page"], local: string): Promise<void> {
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
  await page.waitForLoadState("networkidle");
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

Deno.test("REQ-433 (demo M13, cycle 3) + REQ-736 (demo p10, cycle 5): step 10 shows the sample quote inline as the customer sees it — its job name is on the wizard page, no iframe, no owner controls, the open-full-size link stays", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize(DESKTOP);
    const host = new URL(baseUrl).hostname;
    await page.context().addCookies([{
      name: "pm_lang",
      value: "en",
      domain: host,
      path: "/",
    }]);

    await codeIn(page, `512${digits()}`);
    await answerQuestions(http, await sessionAuth(page), {
      except: ["insurance"],
      businessName: "Story Roofing LLC",
    });
    await page.goto("/welcome?lang=en");
    await page.waitForLoadState("networkidle");

    const provider = "input[aria-label='Insurance provider']";
    await typeIn(page, provider, "State Farm");
    await page.locator(provider).press("Enter");
    await expect.see(en["welcome.sample.question"]);

    // the sample is part of the wizard's own DOM — a frame's text is not seen
    await expect.see(en["ensureSampleQuote.roofing.jobName"], {
      timeout: 20_000,
    });
    await page.locator("[data-cy='welcome-sample-doc']").waitFor({
      state: "visible",
      timeout: 5_000,
    });
    // a frame of step 10 as it stands (the runner shoots after every action)
    await page.locator("html").hover({ force: true, position: { x: 1, y: 1 } });
    expect.eq(
      await page.locator("iframe").count(),
      0,
      "the page holds no iframe",
    );

    // REQ-736 (demo p10, cycle 5): the owner sees the CUSTOMER's view — no
    // owner preview banner, no "your own quote" box, no inert "Sign in
    // person" button; the signature block is read-only.
    const doc = page.locator("[data-cy='welcome-sample-doc']");
    expect.eq(
      await doc.locator(
        "[data-cy='quote-preview-banner'], [data-cy='quote-internal-preview']",
      ).count(),
      0,
      "no owner preview controls in the sample",
    );
    expect.eq(
      await doc.locator("button, canvas, input").count(),
      0,
      "no button, pad or input in the inert sample",
    );
    await doc.locator("[data-cy='quote-sign-readonly']").waitFor({
      state: "attached",
      timeout: 5_000,
    });

    const href = await page.locator("a.welcome__sample-link").getAttribute(
      "href",
    );
    expect(
      /^\/q\/[^/?]+\?lang=en$/.test(href ?? ""),
      `the open-full-size link still opens /q/<id> (${href})`,
    );
  }));
