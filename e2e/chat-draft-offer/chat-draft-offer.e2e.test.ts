/**
 * REQ-388 (demo-loop cycle 2, M23) on the real app — pair 7: in a new
 * assistant chat the contractor asks "what should i charge to move a shower
 * drain 18 inches on a slab foundation in austin?".
 *
 * The demo's chat answered with a QUOTE DRAFTED card whose line item was the
 * whole question. Now the answer is the prices — no card, no quote — and a
 * "Draft a quote at $X" button under it. Pressing it drafts the quote: one
 * card, one quote, whose line is the job ("Move a shower drain 18 inches on
 * a slab foundation"), never the question.
 *
 * Page: /assistant (island front-end/islands/AsstChat.tsx; the answer comes
 * from backend/src/agents/domain/coordinators/handle-chat-message, the offer
 * rule from shared/quote-flow/chat-draft-offer.ts).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const QUESTION =
  "what should i charge to move a shower drain 18 inches on a slab foundation in austin?";

/** Signed in, past onboarding (Austin, TX), in English. */
async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  await answerQuestions(http, auth, {
    name: "Priya Nair",
    businessName: "Nair Kitchen & Bath",
  });
  const lang = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  });
  await lang.body?.cancel();
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
  return auth;
}

/** Type a line and send it once the island is live: a keypress before
 *  hydration is lost, so retry only while the line has not shown up as the
 *  contractor's own bubble (one that did post is never sent twice). */
async function say(page: StoryTools["page"], text: string) {
  const box = page.locator(".composer textarea.composer__input");
  const mine = page.locator(".msg.msg--user", { hasText: text });
  await box.waitFor({ state: "visible", timeout: 20_000 });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await mine.count() > 0) return;
    await box.fill(text);
    await box.press("Enter");
    for (let i = 0; i < 4; i++) {
      if (await mine.count() > 0) return;
      await page.waitForTimeout(250);
    }
  }
  throw new Error(`"${text}" was never sent`);
}

interface QuoteRow {
  id: string;
  isSample?: boolean;
  estimatedTotal?: number;
  lineItems?: { description: string; price?: number }[];
}

async function myQuotes(
  http: StoryTools["http"],
  auth: Record<string, string>,
): Promise<QuoteRow[]> {
  const rows = await (await http("/api/quotes", { headers: auth }))
    .json() as QuoteRow[];
  return rows.filter((q) => !q.isSample);
}

Deno.test("REQ-388 M23: a pricing question answers with prices and a 'Draft a quote' button — no quote until it is pressed, then the job (never the question) is the line", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/assistant");
    await say(page, QUESTION);

    const offer = page.locator("[data-cy=msg-draft-offer]");
    await offer.waitFor({ state: "visible", timeout: 30_000 });
    await offer.hover(); // the button, on screen, in the evidence
    const reply = page.locator(".msg:not(.msg--user) .msg__bubble", {
      hasText: "Market:",
    });
    expect.eq(await reply.count(), 1, "the answer lists the prices");
    const said = await reply.first().innerText();
    expect(
      said.includes("to move a shower drain 18 inches on a slab foundation"),
      `the answer names the job, not the question (got: ${said})`,
    );
    expect.eq(
      await page.locator(".action-card").count(),
      0,
      "a pricing question drafted no quote card",
    );
    expect.eq((await myQuotes(http, auth)).length, 0, "no quote exists yet");
    const label = (await offer.innerText()).trim();
    expect(
      /^Draft a quote at \$\d[\d,]*(\.\d\d)?$/.test(label),
      `the button names its price (got: ${label})`,
    );

    await offer.click();
    const card = page.locator(".action-card");
    await card.waitFor({ state: "visible", timeout: 30_000 });
    await card.hover();
    const quotes = await myQuotes(http, auth);
    expect.eq(quotes.length, 1, "pressing the button drafted one quote");
    expect.eq(
      quotes[0].lineItems?.[0]?.description,
      "Move a shower drain 18 inches on a slab foundation",
      "the quote's line is the job, never the question",
    );
    const cents = Math.round(
      Number(label.replace(/^Draft a quote at \$/, "").replace(/,/g, "")) * 100,
    );
    expect.eq(quotes[0].estimatedTotal, cents, "drafted at the button's price");
    expect.eq(await offer.count(), 0, "the button is gone once drafted");
  }));
