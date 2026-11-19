/**
 * REQ-1069 — Raphael (LOOP-007): "test every single aspect of this application
 * … one Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green". QA issue q2-58, cycle 2: the
 * onboarding step 10 preview showed a "Paver Patio Installation" sample for
 * "Ruiz Lawn & Pool Care" — the lawn-care stems shared the paver-patio
 * landscaping trade and there was no pool trade.
 *
 * In a browser: an account named "Ruiz Lawn & Pool Care" with only the
 * insurance open answers it and reaches step 10; the inline sample shows a
 * lawn / pool job and no paver patio. Then /q/<id> in Spanish shows no
 * "adoquines" either.
 *
 * Pages: /login → /verify → /welcome (front-end/islands/WelcomeWizard.tsx,
 * front-end/components/SampleQuotePreview.tsx) → /q/<id>.
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
const es = JSON.parse(
  await Deno.readTextFile(new URL("../../lang/es.json", import.meta.url)),
) as Record<string, string>;
const PAVER_EN = en["ensureSampleQuote.landscaping.jobName"]; // "Paver Patio Installation"
const PAVER_ES = es["ensureSampleQuote.landscaping.jobName"];

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

Deno.test("REQ-1069 (LOOP-007 q2-58): 'Ruiz Lawn & Pool Care' reaches /welcome step 10 and its sample is a lawn/pool job, not 'Paver Patio Installation' — wizard and /q in Spanish", (t) =>
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
      businessName: "Ruiz Lawn & Pool Care",
    });
    await page.goto("/welcome?lang=en");
    await page.waitForLoadState("networkidle");

    const provider = "input[aria-label='Insurance provider']";
    await typeIn(page, provider, "State Farm");
    await page.locator(provider).press("Enter");
    await expect.see(en["welcome.sample.question"]);

    const doc = page.locator("[data-cy='welcome-sample-doc']");
    await doc.waitFor({ state: "visible", timeout: 20_000 });
    // the sample's line items are drawn once its quote has loaded
    await page.waitForFunction(
      () =>
        (document.querySelector("[data-cy='welcome-sample-doc']") as
          | HTMLElement
          | null)?.innerText.match(/\$\s?\d/) != null,
      undefined,
      { timeout: 20_000 },
    );
    const wizardText = await doc.innerText();
    expect(
      !wizardText.includes(PAVER_EN) && !/paver|patio/i.test(wizardText),
      `step 10 shows no paver patio for a lawn & pool business (sample: ${
        wizardText.slice(0, 200).replace(/\s+/g, " ")
      })`,
    );
    expect(
      /lawn|mow|pool|yard|grass/i.test(wizardText),
      `step 10's sample names the lawn / pool work (sample: ${
        wizardText.slice(0, 200).replace(/\s+/g, " ")
      })`,
    );

    // the full-size page in Spanish carries no paver patio either
    const href = await page.locator("a.welcome__sample-link").getAttribute(
      "href",
    );
    const quotePath = (href ?? "").split("?")[0];
    await page.goto(`${quotePath}?lang=es`);
    await page.locator("body").waitFor();
    await page.waitForLoadState("networkidle");
    const esText = await page.locator("body").innerText();
    expect(
      !esText.includes(PAVER_ES) && !/adoqu/i.test(esText),
      `the Spanish sample has no "${PAVER_ES}" / adoquines`,
    );
  }));
