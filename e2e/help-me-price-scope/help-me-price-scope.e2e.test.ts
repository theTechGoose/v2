/**
 * REQ-260 — demo issue M24: "Suggested prices far too low for a full bathroom
 * gut ($1,450 / $1,750 / $2,100)".
 *
 * In "I know the job, help me price it" the contractor types the job, confirms
 * the drafted scope bullets, and the pricing screen asks
 * POST /api/agents/job-details/prices for three tiers. That request used to
 * carry only the 3–4 terse bullets (prices dropped), so the model never saw the
 * $2,800 plumbing sub the contractor typed and priced "a typical small job".
 * In the browser: the request carries the typed message as `raw` and the
 * confirmed bullets as `scope`, and the tiers on screen are above the stated
 * cost.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

const TYPED =
  "Full gut of the hall bathroom. Demo to studs, cut the slab for a curbless shower, " +
  "my plumber quoted $2,800 for rough-in and finish. Frameless glass, 72 inch double vanity, permit included.";

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

Deno.test("REQ-260 M24: help-me-price prices the contractor's typed message (with the confirmed bullets as scope), never under a cost they stated", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/assistant");
    const chip = "button.chat__empty-prompt:has-text('help me price it')";
    const composer = page.locator("textarea.composer__input");
    // the chip's effect: the "tell me the job details" bubble
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
    const pricesReq = page.waitForRequest((r) =>
      r.url().includes("/agents/job-details/prices") && r.method() === "POST"
    );
    const pricesRes = page.waitForResponse((r) =>
      r.url().includes("/agents/job-details/prices")
    );
    pricesRes.catch(() => {}); // a failed expectation closes the page before the response lands
    await page.locator(".chat__jobopts .chat__price-continue").first().click();
    const req = await pricesReq;
    const body = JSON.parse(req.postData() ?? "{}") as {
      raw?: string;
      scope?: string;
    };
    expect.eq(
      body.raw,
      TYPED,
      "the pricing request carries the message the contractor typed",
    );
    expect(
      typeof body.scope === "string" && body.scope.trim().length > 0 &&
        body.scope !== TYPED,
      `the confirmed bullets ride along as scope (${
        JSON.stringify(body.scope)
      })`,
    );

    const res = await pricesRes;
    const cents = ((await res.json()).options as Array<{ priceCents: number }>)
      .map((o) => o.priceCents);
    expect.eq(cents.length, 3, "three tiers");
    expect(
      cents.every((c) => c > 280000),
      `every tier above the stated $2,800 (${cents})`,
    );
  }));
