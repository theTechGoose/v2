/**
 * REQ-259 (demo issue M23) — "I know my price" took $8,000 instead of the
 * $14,700 total and dropped the line prices.
 *
 * The demo tapped "I know my price, write it up." and typed an itemised job:
 * "…: demo $2,500, cabinets $8,000, quartz countertops $4,200". The price
 * picker opened at $8,000 (the largest line) and the quote was born with ONE
 * summary line. Here, in a browser: the picker opens at the sum, $14,700, and
 * the quote the Continue creates carries the three typed lines at their prices
 * and the $14,700 total.
 *
 * No LLM turn is involved: the chip → details → price picker → quote creation
 * is client-side state plus POST /quotes, the same on the gate's fakes as on a
 * pin.
 *
 * Pages: /assistant (island front-end/islands/AsstChat.tsx — submitJobDetails,
 * startQuoteFromRaw), the extraction in shared/quote-flow/quick-quote-prefill.ts.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

/** a fresh number per sign-in: stories run in parallel */
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

const SENTENCE =
  "Kitchen remodel for Maria Lopez, 512-555-0199, 12 Oak St Austin: demo $2,500, cabinets $8,000, quartz countertops $4,200";

/** A signed-in, onboarded, English account on the page's browser context;
 *  returns the request headers that act as that account. */
async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
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
    name: "Price User",
    businessName: "Price Business",
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
  return auth;
}

Deno.test("REQ-259 M23: 'I know my price' with itemised prices → the $14,700 total and the three priced lines", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.goto("/assistant");
    const chip = page.locator("button.chat__empty-prompt", {
      hasText: "I know my price, write it up.",
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
      "14,700",
      "the price picker opens at the sum of the typed lines, not the largest",
    );

    await page.locator(".chat__price-capture button.chat__price-continue")
      .click();
    // Continue creates the quote and hands off to /assistant/<conversation>.
    await page.waitForURL(/\/assistant\/[^/?#]+/, { timeout: 20_000 });
    const convId = new URL(page.url()).pathname.split("/").pop()!;
    const got = await http(`/api/agents/conversations/${convId}`, {
      headers: auth,
    });
    const snap = await got.json();
    const quote = snap.quote ?? {};
    expect(Boolean(quote.id), "the conversation carries the new quote");
    const lines = (quote.lineItems ?? []).map((
      li: { description: string; price: number },
    ) => [li.description, li.price]);
    expect.eq(
      JSON.stringify(lines),
      JSON.stringify([
        ["Demo", 250000],
        ["Cabinets", 800000],
        ["Quartz countertops", 420000],
      ]),
      "the quote carries the three typed lines at their prices",
    );
    expect.eq(quote.estimatedTotal, 1470000, "the quote's total is $14,700");
  }));
