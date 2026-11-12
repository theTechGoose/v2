/**
 * REQ-348 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 1, issue m34: a contractor who signed up from the
 * Spanish landing page had no EN/ES switch anywhere in onboarding, and
 * Settings → "Languages you send in" showed English alone (RCA: nothing wrote
 * identity.commsLanguages at signup/onboarding; /welcome mounted no toggle).
 *
 * In a browser: a new account signs in from /login?lang=es and lands in the
 * wizard in Spanish with ES pressed in the wizard's own switch. It answers its
 * name; the business step shows "Idiomas para enviar" with English AND
 * Spanish checked; Continue saves the business — the profile now carries
 * commsLanguages [en, es]. The switch's EN flips the wizard to English with no
 * reload and saves user.language = en.
 *
 * Pages: /login → /verify → /welcome (front-end/islands/WelcomeWizard.tsx).
 */
import { story, type StoryTools } from "#shots";
import { JSON_HEADERS } from "../_shared/onboarding-answers.ts";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const DESKTOP = { width: 1280, height: 900 };

async function clickAway(
  page: StoryTools["page"],
  selector: string,
): Promise<void> {
  await page.locator(selector).evaluate((el: HTMLElement) => el.click());
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

Deno.test("REQ-348: a Spanish-landing signup meets an EN/ES switch in onboarding and sends in English and Spanish by default (demo m34)", (t) =>
  story(t, async ({ page, expect, http }) => {
    await page.setViewportSize(DESKTOP);
    const local = `512${digits()}`;

    await page.goto("/login?lang=es");
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
    await page.waitForURL((u: URL) => u.pathname === "/welcome", {
      timeout: 20_000,
    });

    // the wizard's own switch, ES pressed
    await expect.see("Lo primero — ¿cómo te llamamos?");
    expect.eq(
      await page.locator("[data-cy='welcome-lang-es']").getAttribute(
        "aria-pressed",
      ),
      "true",
      "ES is pressed for a Spanish signup",
    );

    // name, then the business step with both send-in languages checked
    await typeIn(page, "input[autocomplete='name']", "Rafa Morales");
    await clickAway(page, "[data-cy='welcome-continue']");
    await expect.see("Idiomas para enviar");
    expect.eq(
      await page.locator("[data-cy='welcome-comms-en']").isChecked(),
      true,
      "English is checked",
    );
    expect.eq(
      await page.locator("[data-cy='welcome-comms-es']").isChecked(),
      true,
      "Spanish is checked",
    );
    await typeIn(page, "input[autocomplete='organization']", "Techos Morales");
    await clickAway(page, "[data-cy='welcome-continue']");
    await page.locator("input[type='email']").waitFor({ timeout: 30_000 });

    const snap = await (await http("/api/profile", {
      headers: await sessionAuth(page),
    })).json() as { identity?: { commsLanguages?: string[] } };
    expect.eq(
      JSON.stringify(snap.identity?.commsLanguages),
      JSON.stringify(["en", "es"]),
      "the business is saved sending in English and Spanish",
    );

    // EN flips the wizard in place and saves the account's language
    await page.evaluate(() => {
      (globalThis as unknown as { __noReload: boolean }).__noReload = true;
    });
    await clickAway(page, "[data-cy='welcome-lang-en']");
    await expect.see("What's the best email for your business?");
    expect.eq(
      await page.evaluate(() =>
        (globalThis as unknown as { __noReload?: boolean }).__noReload
      ),
      true,
      "no reload",
    );
    let language: string | undefined;
    for (let i = 0; i < 20 && language !== "en"; i++) {
      const p = await (await http("/api/profile", {
        headers: await sessionAuth(page),
      })).json() as { user?: { language?: string } };
      language = p.user?.language;
      if (language !== "en") await new Promise((r) => setTimeout(r, 250));
    }
    expect.eq(language, "en", "the switch saved user.language");
  }));

/**
 * REQ-498 — demo-loop cycle 3, issue m42: "Onboarding from ?lang=es defaults 'Languages you send
 * in' to English only". A contractor created in Spanish who taps EN on the name step still meets
 * English AND Spanish ticked on the business step — the default remembers the language the account
 * was created in, it does not follow the live switch — and Continue saves both.
 */
Deno.test("REQ-498: a Spanish-landing signup who switches to EN on step 1 still sends in English and Spanish by default (demo m42, cycle 3)", (t) =>
  story(t, async ({ page, expect, http }) => {
    await page.setViewportSize(DESKTOP);
    const local = `512${digits()}`;

    await page.goto("/login?lang=es");
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
    await page.waitForURL((u: URL) => u.pathname === "/welcome", {
      timeout: 20_000,
    });
    await expect.see("Lo primero — ¿cómo te llamamos?");

    // step 1: hydrate (the name takes), then flip the wizard to English
    await typeIn(page, "input[autocomplete='name']", "Rafa Morales");
    await clickAway(page, "[data-cy='welcome-lang-en']");
    await page.locator("[data-cy='welcome-lang-en'][aria-pressed='true']")
      .waitFor({ timeout: 15_000 });
    await clickAway(page, "[data-cy='welcome-continue']");

    // step 2 in English — both send-in languages still ticked
    await page.locator("input[autocomplete='organization']").waitFor({
      timeout: 30_000,
    });
    expect.eq(
      await page.locator("[data-cy='welcome-comms-en']").isChecked(),
      true,
      "English is checked",
    );
    expect.eq(
      await page.locator("[data-cy='welcome-comms-es']").isChecked(),
      true,
      "Spanish is still checked after switching the wizard to EN",
    );
    await typeIn(page, "input[autocomplete='organization']", "Techos Morales");
    await clickAway(page, "[data-cy='welcome-continue']");
    await page.locator("input[type='email']").waitFor({ timeout: 30_000 });

    const snap = await (await http("/api/profile", {
      headers: await sessionAuth(page),
    })).json() as { identity?: { commsLanguages?: string[] } };
    expect.eq(
      JSON.stringify(snap.identity?.commsLanguages),
      JSON.stringify(["en", "es"]),
      "the business is saved sending in English and Spanish",
    );
  }));
