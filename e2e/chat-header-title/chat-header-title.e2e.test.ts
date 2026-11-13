/**
 * REQ-671 — demo-loop cycle 5 (run r37f88707), issue p8: "Header says 'New
 * conversation' after the job is described". Pair 7 picked "I know the job,
 * help me price it", sent a long job description and saw the sidebar title
 * the thread while the chat header kept "New conversation" through the job
 * options and the price step — until a later chat turn set it.
 *
 * Story: help me price it → type the job → while the job details are up and
 * then on Pick a price, the header title (ChatHeaderLive, fed by AsstChat's
 * pm:asst-header) names the thread — never "New conversation".
 *
 * Page: /assistant (island front-end/islands/AsstChat.tsx; the title rule in
 * shared/quote-flow/chat-header.ts + thread-title.ts).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

const TYPED =
  "ok so this is for the Hendersons on Shoal Creek, gut master bath 8x10, walk-in shower, double vanity quartz.";

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
  await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  }).then((x) => x.body?.cancel());
  await answerQuestions(http, auth, {
    name: "Priya Nair",
    businessName: "Nair Kitchen & Bath",
  });
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
}

/** An island may still be hydrating when its button appears: click until
 *  the page shows the effect (the house pattern). */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch { /* not clickable yet */ }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

/** The header title once it stops saying "New conversation" (or after the
 *  wait runs out — then whatever it says). */
async function headerTitle(page: StoryTools["page"]): Promise<string> {
  await page.waitForFunction(
    () =>
      !/new conversation/i.test(
        (document.querySelector(".chat__head-title") as HTMLElement | null)
          ?.innerText ?? "new conversation",
      ),
    undefined,
    { timeout: 10_000 },
  ).catch(() => {});
  return (await page.locator(".chat__head-title").first().innerText()).trim();
}

Deno.test("REQ-671: the header names the thread once the job is described — job details and Pick a price", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/assistant");
    await clickUntil(
      page,
      "button.chat__empty-prompt:has-text('help me price it')",
      () => page.locator(".chat__details-prompt-bubble").isVisible(),
    );
    await page.locator("textarea.composer__input").fill(TYPED);
    await page.locator("button.composer__send").click();
    await page.locator("[data-cy=confirm-details]").waitFor({
      state: "visible",
      timeout: 30_000,
    });

    let title = await headerTitle(page);
    expect(
      !/new conversation/i.test(title),
      `job details: the header names the thread (title: ${title})`,
    );
    expect(
      /hendersons/i.test(title),
      `job details: titled from the job the owner typed (title: ${title})`,
    );

    await page.locator(".chat__jobopts .chat__price-continue").first().click();
    await page.locator("[data-cy=pricing-option]").first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
    title = await headerTitle(page);
    expect(
      !/new conversation/i.test(title),
      `Pick a price: the header still names the thread (title: ${title})`,
    );
  }));
