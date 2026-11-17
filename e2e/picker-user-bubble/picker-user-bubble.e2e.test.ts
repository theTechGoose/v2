/**
 * REQ-577 — demo-loop cycle 4, issue m38 (pair 7): "User's first message
 * hidden while options generate".
 *
 * In "help me price it" the contractor types the job and sends it. The
 * job-options picker then takes over the scroll area; it used to show only
 * its heading and "Writing up your options…", so her message vanished until
 * she pressed Continue. Here the options endpoint is held open: while it is
 * pending the picker shows her message as a user bubble, and the bubble is
 * still there once the three cards land.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

const TYPED =
  "Rebuild the back deck, 12 by 16, pressure treated frame with composite boards and new stairs";
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
    name: "Deck Pro",
    businessName: "Deck Pro LLC",
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

Deno.test("REQ-577 m38: the picker shows the typed message as a user bubble while the options generate and after they land", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route("**/api/agents/job-details/options", async (route) => {
      await held;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(OPTIONS),
      }).catch(() => {});
    });
    await page.goto("/assistant");
    const chip = "button.chat__empty-prompt:has-text('help me price it')";
    await clickUntil(
      page,
      chip,
      () => page.locator(".chat__details-prompt-bubble").isVisible(),
    );
    await page.locator("textarea.composer__input").fill(TYPED);
    await page.locator("button.composer__send").click();

    await page.locator(".chat__jobopts-loading").waitFor({
      state: "visible",
      timeout: 15_000,
    });
    const bubble = page.locator(".chat__jobopts [data-cy=picker-user-bubble]");
    const whileLoading = await bubble.isVisible()
      ? (await bubble.innerText()).trim()
      : null;
    release();
    expect.eq(
      whileLoading,
      TYPED,
      "while the options are being written, the picker shows her message",
    );

    await page.locator(".chat__jobopt").nth(2).waitFor({
      state: "visible",
      timeout: 15_000,
    });
    const afterLoad = await bubble.isVisible()
      ? (await bubble.innerText()).trim()
      : null;
    expect.eq(
      afterLoad,
      TYPED,
      "once the options land, her message is still on screen",
    );
  }));
