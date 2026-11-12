/**
 * REQ-381 — demo issue M20 (cycle 2): "'Looks right — confirm these details'
 * uses version 1 instead of user text and skips Continue".
 *
 * In "help me price it" the confirm step shows the drafted scope cards and,
 * under them, a green strip echoing the message the contractor typed. The
 * strip used to run the same handler as Continue, so it confirmed the
 * pre-selected card (version 1) — the JOB DETAILS on the pricing screen were
 * v1's bullets, not the typed text. Here the options endpoint answers with
 * three cards whose bullets share no words with the typed message: clicking
 * the strip lands on pricing with the TYPED scope (and the pricing request's
 * scope is it); Continue still confirms the selected card.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

const TYPED =
  "I need to replace the kitchen faucet\nInstall a new garbage disposal for $300";
const OPTIONS = {
  options: [1, 2, 3].map((n) => ({
    id: `opt${n}`,
    jobName: `Version ${n} plan`,
    summary: `Version ${n} plan`,
    bullets: [`Version ${n} alpha line`, `Version ${n} beta line`],
  })),
};

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
    name: "Sink Pro",
    businessName: "Sink Pro LLC",
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

/** sign in, type the job in "help me price it", wait for the confirm step */
async function toConfirmStep(tools: StoryTools) {
  const { page, http, baseUrl } = tools;
  await signIn(http, page, baseUrl);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.route(
    "**/api/agents/job-details/options",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(OPTIONS),
      }),
  );
  await page.goto("/assistant");
  const chip = "button.chat__empty-prompt:has-text('help me price it')";
  await clickUntil(
    page,
    chip,
    () => page.locator(".chat__details-prompt-bubble").isVisible(),
  );
  await page.locator("textarea.composer__input").fill(TYPED);
  await page.locator("button.composer__send").click();
  await page.locator("[data-cy=confirm-details]").waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await page.locator(".chat__jobopt").nth(2).waitFor({ state: "attached" });
}

const pricesScope = (page: StoryTools["page"]) =>
  page.waitForRequest((r) =>
    r.url().includes("/agents/job-details/prices") && r.method() === "POST"
  ).then((r) => (JSON.parse(r.postData() ?? "{}") as { scope?: string }).scope);

Deno.test("REQ-381 M20: the confirm strip submits the typed message, not version 1", (t) =>
  story(t, async (tools) => {
    const { page, expect } = tools;
    await toConfirmStep(tools);
    const label = await page.locator(".chat__confirm-details-label")
      .innerText();
    const scope = pricesScope(page);
    await page.locator("[data-cy=confirm-details]").click();
    const recap = page.locator(".chat__price-details-recap-text");
    await recap.waitFor({ state: "visible", timeout: 15_000 });
    const text = await recap.innerText();
    expect(
      /kitchen faucet/i.test(text) && /garbage disposal/i.test(text),
      `the job details on the pricing screen are the typed scope ("${text}")`,
    );
    expect(
      !/Version 1/.test(text),
      `version 1's bullets were not submitted ("${text}")`,
    );
    const s = await scope;
    expect(
      typeof s === "string" && /kitchen faucet/i.test(s) &&
        !/Version 1/.test(s),
      `the pricing request's scope is the typed scope (${JSON.stringify(s)})`,
    );
    expect(
      /what I wrote/i.test(label),
      `the strip says it submits what was typed ("${label}")`,
    );
  }));

Deno.test("REQ-381 M20: Continue still confirms the selected card", (t) =>
  story(t, async (tools) => {
    const { page, expect } = tools;
    await toConfirmStep(tools);
    await page.locator(".chat__jobopts .chat__price-continue").first().click();
    const recap = page.locator(".chat__price-details-recap-text");
    await recap.waitFor({ state: "visible", timeout: 15_000 });
    const text = await recap.innerText();
    expect(
      /Version 1 alpha line/.test(text),
      `Continue confirms the selected (first) card ("${text}")`,
    );
  }));
