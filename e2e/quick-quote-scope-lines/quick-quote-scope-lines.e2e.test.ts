/**
 * REQ-585 (demo-loop cycle 4, M30) — "A Spanish edit dumps the whole raw
 * message into the job scope". Pair 7 took "Just give me a quick quote.",
 * typed a long bathroom job and set the price; Q-002 was born with her whole
 * message as its ONE job line (`description: raw.trim()` in
 * AsstChat.startQuoteFromRaw), and the next chat edit echoed it back twice.
 *
 * Here, in a browser: the quick quote the price step's Continue creates
 * carries the message's scope lines — one per sentence, the price clause gone
 * — never the message itself. The end-of-wizard polish still runs on the
 * message as typed.
 *
 * No LLM turn is involved: the chip → details → price → quote creation is
 * client-side state plus POST /quotes, the same on the gate's fakes as on a
 * pin.
 *
 * Pages: /assistant (island front-end/islands/AsstChat.tsx — submitJobDetails,
 * startQuoteFromRaw), shared/quote-flow/scope-from-raw.ts.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

/** a fresh number per sign-in: stories run in parallel */
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

const SENTENCE =
  "Master bath for Linh Tran in Round Rock. Remove the tub and build a tiled shower with a bench. New double vanity. The toilet stays but we reset it. $18,000 all in.";

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
    name: "Quick User",
    businessName: "Quick Business",
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

Deno.test("REQ-585 M30: a quick quote's job details are the message's scope lines, never the message as one line", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
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
      "18,000",
      "the price step opens at the typed $18,000",
    );
    await page.locator(".chat__price-capture button.chat__price-continue")
      .click();
    // Continue creates the quote and hands off to /assistant/<conversation>.
    await page.waitForURL(/\/assistant\/[^/?#]+/, { timeout: 20_000 });
    const convId = new URL(page.url()).pathname.split("/").pop()!;
    let quote: { id?: string; description?: string } = {};
    for (let i = 0; i < 40 && !quote.id; i++) {
      const got = await http(`/api/agents/conversations/${convId}`, {
        headers: auth,
      });
      const snap = await got.json();
      quote = snap.quote ?? {};
      if (!quote.id) await page.waitForTimeout(250);
    }
    expect(Boolean(quote.id), "the conversation carries the new quote");
    expect(
      quote.description !== SENTENCE,
      `the job details are not the message itself: ${quote.description}`,
    );
    expect.eq(
      quote.description,
      [
        "Master bath for Linh Tran in Round Rock",
        "Remove the tub and build a tiled shower with a bench",
        "New double vanity",
        "The toilet stays but we reset it",
      ].join("\n"),
      "one scope line per sentence, the price clause gone",
    );
  }));
