/**
 * REQ-680 (demo-loop cycle 5, demo issue M25) — "Negative price silently turned positive".
 *
 * The demo typed "panel upgrade for Bob Miller, price -500 dollars, …" after "Just give me a
 * quick quote." and the amount pad opened at $500: the shared money reader had no sign. Here, in a
 * browser: the pad opens empty and the price step says why.
 *
 * No LLM turn is involved: chip → details → price picker is client-side state.
 *
 * Pages: /assistant (island front-end/islands/AsstChat.tsx — submitJobDetails, the price step),
 * shared/quote-flow/quick-quote-prefill.ts, shared/quote-flow/money-amounts.ts.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

/** a fresh number per sign-in: stories run in parallel */
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

/** demo pair 10's sentence, verbatim */
const SENTENCE =
  "panel upgrade for Bob Miller, price -500 dollars, email notanemail";

/** A signed-in, onboarded, English account on the page's browser context. */
async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<void> {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
  });
  let body = await r.json();
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    const f = await http("/api/auth/start-fresh", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: body.recoveryToken }),
    });
    body = await f.json();
    cookie = (f.headers.get("set-cookie") ?? "").split(";")[0];
  }
  const auth = { ...JSON_HEADERS, cookie };
  await answerQuestions(http, auth, {
    name: "Minus User",
    businessName: "Minus Business",
  });
  const res = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  });
  await res.body?.cancel();
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
}

Deno.test("REQ-680 M25: 'price -500 dollars' typed → the amount pad opens empty and the price step says a price can't be negative", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.goto("/assistant");
    const chip = page.locator("button.chat__empty-prompt", {
      hasText: "Just give me a quick quote.",
    });
    await chip.waitFor({ state: "visible", timeout: 20_000 });
    // Click until the island has hydrated and opened the details composer.
    const composer = page.locator("textarea.composer__input");
    for (let i = 0; i < 20; i++) {
      await chip.click().catch(() => {});
      if (await page.locator(".chat__empty-prompts").count() === 0) break;
      await page.waitForTimeout(250);
    }
    await composer.waitFor({ state: "visible", timeout: 10_000 });
    await composer.fill(SENTENCE);
    await page.locator("button.composer__send").click();

    const money = page.locator(".chat__price-capture input.mi__input");
    await money.waitFor({ state: "visible", timeout: 10_000 });
    expect.eq(
      (await money.inputValue()).trim(),
      "",
      "the pad is not seeded with $500",
    );
    const note = page.locator("[data-cy='price-negative-note']");
    await note.waitFor({ state: "visible", timeout: 5_000 });
    expect.eq(
      (await note.innerText()).trim(),
      "Your message says -$500 — a price can't be negative, so the amount is left empty. Type the price; for a credit, add a discount or a change order.",
      "the price step says why the amount is empty",
    );
    expect.eq(
      await page.locator(".chat__price-continue").isDisabled(),
      true,
      "nothing to continue with until a price is typed",
    );
  }));
