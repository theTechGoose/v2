/**
 * REQ-335 — demo-loop cycle 1, issue M31: "Job description from the wrong
 * card used (clicking a bullet line may not select the card)".
 *
 * In "help me price it" the picker paints three cards. The demo customer
 * tapped a line inside the THIRD card and Continue applied the FIRST: the
 * bullet's button stopped the click before the card's select handler and
 * opened inline editing instead. In the browser now: a tap on a line of the
 * third card marks that card selected (and nothing else), opens no editor,
 * and Continue prices the third card's scope.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

const TYPED =
  "Full gut of the hall bathroom. Demo to studs, cut the slab for a curbless shower, " +
  "frameless glass, 72 inch double vanity, permit included.";

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
  })
    .then((x) => x.body?.cancel());
  await answerQuestions(http, auth, {
    name: "Bath Pro",
    businessName: "Bath Pro LLC",
  });
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
}

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
) {
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

Deno.test("REQ-335 M31: tapping a line inside a job-option card selects THAT card, and Continue uses its scope", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/assistant");
    const chip = "button.chat__empty-prompt:has-text('help me price it')";
    const composer = page.locator("textarea.composer__input");
    await clickUntil(
      page,
      chip,
      () => page.locator(".chat__details-prompt-bubble").isVisible(),
    );
    await composer.fill(TYPED);
    await page.locator("button.composer__send").click();

    await page.locator("[data-cy=confirm-details]").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    const cards = page.locator(".chat__jobopts .chat__jobopt");
    expect.eq(await cards.count(), 3, "three cards painted");
    expect(
      await cards.nth(0).evaluate((el) => el.classList.contains("is-selected")),
      "the first card is the default selection",
    );

    // the demo's tap: a line INSIDE the third card
    const third = cards.nth(2);
    const line = third.locator(".chat__jobopt-text").first();
    const lineText = (await line.innerText()).trim();
    await clickUntil(
      page,
      ".chat__jobopts .chat__jobopt:nth-child(3) .chat__jobopt-text",
      () => third.evaluate((el) => el.classList.contains("is-selected")),
    );
    expect(
      await third.evaluate((el) => el.classList.contains("is-selected")),
      "tapping a line of the third card selects the third card",
    );
    expect(
      !(await cards.nth(0).evaluate((el) =>
        el.classList.contains("is-selected")
      )),
      "the first card is no longer selected",
    );
    expect.eq(
      await page.locator(".chat__jobopt-edit").count(),
      0,
      "a bullet tap opens no inline editor",
    );

    const pricesReq = page.waitForRequest((r) =>
      r.url().includes("/agents/job-details/prices") && r.method() === "POST"
    );
    await page.locator(".chat__jobopts .chat__price-continue").first().click();
    const req = await pricesReq;
    const body = JSON.parse(req.postData() ?? "{}") as { scope?: string };
    expect(
      typeof body.scope === "string" && body.scope.includes(lineText),
      `Continue prices the third card's scope (${
        JSON.stringify(body.scope)
      } includes ${JSON.stringify(lineText)})`,
    );
  }));
