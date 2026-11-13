/**
 * REQ-620 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4, issue p4-p6b: onboarding offered "Venmo / Zelle /
 * Cash App / Cheque / Efectivo / ACH / Banco" while Settings offered "Venmo /
 * Cash App / Zelle / PayPal / Check / Direct deposit / Credit card / Cash" —
 * two hard-coded lists (WelcomeWizard PAYMENT_METHODS, SettingsPage PAY_ROWS)
 * writing the same acceptedPaymentMethods map under different names.
 *
 * In a browser: an account with only the payment question open lands on the
 * wizard's payment step; its chips read the shared catalogue's eight names in
 * order. PayPal (offered only in Settings before) is turned on with a
 * paypal.me handle and saved; Settings' Payments card then lists the very
 * same eight names, in the same order, with PayPal on.
 *
 * Pages: /login → /verify → /welcome (front-end/islands/WelcomeWizard.tsx) →
 * /settings (front-end/islands/SettingsPage.tsx).
 */
import { story, type StoryTools } from "#shots";
import {
  answerQuestions,
  JSON_HEADERS,
} from "../_shared/onboarding-answers.ts";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const DESKTOP = { width: 1280, height: 900 };
const NAMES = [
  "Venmo",
  "Cash App",
  "Zelle",
  "PayPal",
  "Check",
  "Direct deposit",
  "Credit card",
  "Cash",
];

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

const texts = async (page: StoryTools["page"], selector: string) =>
  (await page.locator(selector).allInnerTexts()).map((s: string) => s.trim());

Deno.test("REQ-620 (demo p4-p6b, cycle 4): the wizard's payment step and Settings' Payments card list the same eight methods under the same names, and PayPal picked in the wizard shows on in Settings", (t) =>
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

    let landed = await codeIn(page, local);
    expect.eq(landed.pathname, "/welcome", `a new account lands in the wizard`);
    await answerQuestions(http, await sessionAuth(page), {
      except: ["payment"],
    });
    await page.context().clearCookies();
    await english();
    landed = await codeIn(page, local);
    expect.eq(landed.pathname, "/welcome", `the open payment question`);

    // the wizard's payment step: the catalogue's eight names, in order
    await expect.see("How do you want to get paid?");
    const chips = ".welcome__pay-method > button";
    await page.locator(chips).first().waitFor({ timeout: 30_000 });
    const wizard = await texts(page, chips);
    expect.eq(
      JSON.stringify(wizard),
      JSON.stringify(NAMES),
      `the wizard offers the shared list (got ${JSON.stringify(wizard)})`,
    );

    // turn PayPal on (retry until hydrated: the handle input appears)
    const paypal = page.locator(".welcome__pay-method", { hasText: "PayPal" })
      .locator("button");
    const handle = "input[aria-label='PayPal email, phone or paypal.me link']";
    for (let i = 0; i < 8; i++) {
      await paypal.click();
      try {
        await page.locator(handle).waitFor({ timeout: 1500 });
        break;
      } catch { /* not hydrated yet, or toggled off — try again */ }
    }
    await page.locator(handle).fill("paypal.me/storycrew");
    await page.locator("[data-cy='welcome-continue']:not([disabled])").waitFor({
      timeout: 15_000,
    });
    await clickAway(page, "[data-cy='welcome-continue']");
    await page.waitForFunction(
      () => !document.body.innerText.includes("How do you want to get paid?"),
      undefined,
      { timeout: 20_000 },
    );

    // Settings' Payments card: the same eight names, same order, PayPal on
    await page.goto("/settings");
    const rows = "[data-pay-method]";
    await page.locator(rows).first().waitFor({ timeout: 60_000 });
    const settings = await texts(
      page,
      `${rows} > label > span`,
    );
    expect.eq(
      JSON.stringify(settings),
      JSON.stringify(NAMES),
      `Settings lists the same names (got ${JSON.stringify(settings)})`,
    );
    const on = await page.locator(
      "[data-pay-method='paypal'] input[type='checkbox']",
    ).isChecked();
    expect.eq(on, true, "PayPal chosen in the wizard is on in Settings");

    const snap = await (await http("/api/profile", {
      headers: await sessionAuth(page),
    })).json() as {
      identity?: {
        acceptedPaymentMethods?: Record<
          string,
          { enabled?: boolean; handle?: string }
        >;
      };
    };
    expect.eq(
      snap.identity?.acceptedPaymentMethods?.paypal?.handle,
      "paypal.me/storycrew",
      "the wizard saved PayPal's handle",
    );
  }));
