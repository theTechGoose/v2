/**
 * REQ-449 — demo-loop cycle 3, issue m48: "Tapping a price tier jumps ahead
 * and reloads the page".
 *
 * On Pick a price ("help me price it") the step says "Tap a suggestion, or
 * enter your own below" over a Continue button, yet a tier tap created the
 * quote at once and did a full page load into the wizard. Now: a tier tap
 * only SELECTS — the tier's price fills the price box and the card is marked
 * selected, nothing is created — and Continue moves on into the wizard IN
 * PLACE: no page load, the address bar is /assistant/<id>.
 *
 * Page: /assistant (island front-end/islands/AsstChat.tsx).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

const TYPED =
  "Replace 6 fence panels along the south side, haul away the old ones.";

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
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
    name: "Fence Pro",
    businessName: "Fence Pro LLC",
  });
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
}

/** an island may still be hydrating when its button appears: click until the
 *  page shows the effect (the house pattern). */
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
}

const digits = (s: string) => s.replace(/[^0-9]/g, "");

Deno.test("REQ-449 m48: tapping a price tier selects it (fills the price box, marks the card) and Continue goes into the wizard without a page load", (t) =>
  story(t, async ({ page, expect, baseUrl, http }) => {
    await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });

    const quotePosts: string[] = [];
    let loads = 0;
    page.on("request", (r) => {
      if (r.method() === "POST" && /\/quotes(\?|$)/.test(r.url())) {
        quotePosts.push(r.url());
      }
    });
    page.on("load", () => loads++);

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
    await page.locator(".chat__jobopts .chat__price-continue").first().click();

    const tiers = page.locator("[data-cy=pricing-option]");
    await tiers.first().waitFor({ state: "visible", timeout: 30_000 });
    expect.eq(await tiers.count(), 3, "three tiers on Pick a price");
    const sub = (await page.locator(".chat__price-sub").innerText()).trim();

    // The demo's tap: the middle tier.
    const tier = tiers.nth(1);
    const tierPrice = digits(
      await tier.locator("span").last().innerText(),
    );
    const box = page.locator(".chat__price-capture input.mi__input");
    const loadsBefore = loads;
    await clickUntil(
      page,
      "[data-cy=pricing-option] >> nth=1",
      async () =>
        quotePosts.length > 0 ||
        (await tier.getAttribute("aria-pressed")) === "true",
    );
    await page.waitForTimeout(1_500);

    expect.eq(quotePosts.length, 0, "a tier tap creates no quote");
    expect.eq(loads, loadsBefore, "a tier tap loads no page");
    expect(
      await page.locator(".chat__price-capture").isVisible(),
      "still on Pick a price after the tap",
    );
    expect.eq(
      await tier.getAttribute("aria-pressed"),
      "true",
      "the tapped tier is marked selected",
    );
    expect(
      await tier.evaluate((el) => el.classList.contains("is-selected")),
      "the tapped tier carries is-selected",
    );
    expect.eq(
      await tiers.nth(0).getAttribute("aria-pressed"),
      "false",
      "the other tiers are not selected",
    );
    expect.eq(
      digits(await box.inputValue()),
      tierPrice,
      `the tier's price fills the price box (${tierPrice})`,
    );
    expect(
      await page.locator(".chat__price-capture button.chat__price-continue")
        .isEnabled(),
      "Continue takes it",
    );
    expect(
      /then continue/i.test(sub),
      `the step's copy says tap, then Continue (${sub})`,
    );

    // Continue: the wizard opens in place — no page load.
    await page.evaluate(() => {
      (globalThis as unknown as { __req449: number }).__req449 = 449;
    });
    await page.locator(".chat__price-capture button.chat__price-continue")
      .click();
    await page.locator(".wiz__opts, .cust-create, .cust-pick").first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
    expect.eq(quotePosts.length, 1, "Continue creates the quote, once");
    expect.eq(loads, loadsBefore, "Continue loads no page");
    expect.eq(
      await page.evaluate(() =>
        (globalThis as unknown as { __req449?: number }).__req449
      ),
      449,
      "the same document carries on (no reload)",
    );
    expect(
      /^\/assistant\/[^/]+$/.test(new URL(page.url()).pathname),
      `the address bar is the thread (${page.url()})`,
    );
    expect.eq(
      await page.locator(".chat__price-capture").count(),
      0,
      "Pick a price is closed",
    );

    // A reload of that address lands on the same wizard step.
    await page.reload();
    await page.locator(".wiz__opts, .cust-create, .cust-pick").first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
  }));
