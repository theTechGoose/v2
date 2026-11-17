/**
 * REQ-389 (demo issue m31, cycle 2) — "Amount chips $50-$5k shown on
 * $14,500/$18,500 jobs".
 *
 * The demo tapped "Just give me a quick quote." and typed a job with its
 * price ("… $18,500 all in"). The amount pad opened at $18,500 but its quick
 * chips were the fixed $50 · $100 · $500 · $1k · $5k: REQ-329 scaled them only
 * from the AI's price tiers, and this path asks for none. Here, in a browser:
 * the chips scale to the prefilled $18,500 instead.
 *
 * No LLM turn is involved: chip → details → price picker is client-side state.
 *
 * Pages: /assistant (island front-end/islands/AsstChat.tsx — submitJobDetails,
 * the MoneyInput's anchorCents), front-end/lib/money-input.ts.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

/** a fresh number per sign-in: stories run in parallel */
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

const SENTENCE =
  "Full bathroom remodel for Dana Reyes at 40 Elm St Austin, new tile, vanity and shower glass, $18,500 all in";

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
    name: "Chip User",
    businessName: "Chip Business",
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

Deno.test("REQ-389 m31: quick quote with $18,500 typed → the amount chips scale to $18,500, not $50…$5k", (t) =>
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
      "18,500",
      "the pad opens at the typed $18,500",
    );
    const chips = page.locator(".chat__price-capture button.mi__chip");
    expect.eq(
      (await chips.allInnerTexts()).join(" "),
      "$9.5k $14k $18.5k $23k $28k",
      "the quick chips scale to the $18,500 job",
    );
  }));
