/**
 * REQ-230 (demo issue M14) — reloading the assistant mid-flow, from the same
 * window or from another one, rebuilds the flow from the SERVER.
 *
 * The demo stage is a second, independent copy of the app (its own browser,
 * no sessionStorage of the customer's tab); whatever it renders comes from
 * GET /agents/conversations/:id. Before the fix the server held only the
 * typed note, so a stage reload while the contractor sat on the price step
 * showed one user bubble and no price panel.
 *
 * Pages: front-end/routes/assistant/[threadId].tsx, the island
 * front-end/islands/AsstChat.tsx.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

async function signIn(http: StoryTools["http"]): Promise<string> {
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
  await answerQuestions(http, { ...JSON_HEADERS, cookie }, {
    name: "Draft User",
    businessName: "Draft Business",
  });
  return cookie;
}

// deno-lint-ignore no-explicit-any
async function useCookie(ctx: any, baseUrl: string, cookie: string) {
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await ctx.addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
}

/** an island may still be hydrating when its button appears: click until the page shows the effect */
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

const DETAILS = "Pour a 10x12 concrete patio slab with rebar";

Deno.test("REQ-230 (M14): another window (and a reload) rebuilds the assistant's price step from the server", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const cookie = await signIn(http);
    await useCookie(page.context(), baseUrl, cookie);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/assistant");

    // 1. "I know my price" → details typed → the price step
    await clickUntil(
      page,
      ".chat__empty-prompt",
      async () =>
        (await page.locator(".composer__input").count()) > 0 &&
        await page.locator(".chat__empty-prompts").count() === 0,
    );
    await page.locator(".composer__input").fill(DETAILS);
    await page.locator(".composer__input").press("Enter");
    await page.locator(".chat__price-capture").waitFor({ timeout: 15_000 });
    // the early mint put the conversation's id in the address bar
    await page.waitForURL(/\/assistant\/[0-9a-f-]{36}$/, { timeout: 15_000 });
    const threadPath = new URL(page.url()).pathname;
    const id = threadPath.split("/").pop()!;

    // 2. a price is typed — and nothing else (no Continue)
    const money = page.locator(".chat__price-capture input").first();
    await money.click();
    await money.pressSequentially("3700");

    // 3. the server learns the flow (debounced save) — no Continue pressed
    let draft: Record<string, unknown> | undefined;
    for (let i = 0; i < 50; i++) {
      const res = await http(`/api/agents/conversations/${id}`, {
        headers: { cookie },
      });
      const detail = await res.json();
      draft = detail?.draft;
      if (draft && draft.priceCents === 370000) break;
      await page.waitForTimeout(200);
    }
    expect.eq(
      draft?.priceCaptureOpen,
      true,
      "the server knows the price step is open",
    );
    expect.eq(
      draft?.jobDetailsRaw,
      DETAILS,
      "the server knows the typed details",
    );
    expect.eq(draft?.priceCents, 370000, "the server knows the typed price");

    // 4. another window — its own context, no sessionStorage of this tab
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const other = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    try {
      await useCookie(other, baseUrl, cookie);
      const stage = await other.newPage();
      await stage.goto(`${baseUrl}${threadPath}`);
      // SSR already paints it (no wait for hydration needed)
      await stage.locator(".chat__price-capture").waitFor({ timeout: 15_000 });
      expect.eq(
        (await stage.locator(".chat__price-details-recap-text").textContent())
          ?.trim(),
        DETAILS,
        "the other window shows the details being priced",
      );
      const shown = await stage.locator(".chat__price-capture input").first()
        .inputValue();
      expect(
        /3,?700/.test(shown),
        `the other window shows the typed price (got "${shown}")`,
      );
    } finally {
      await other.close();
    }

    // 5. the contractor's own reload lands on the same step
    await page.reload();
    await page.locator(".chat__price-capture").waitFor({ timeout: 15_000 });
    const mine = await page.locator(".chat__price-capture input").first()
      .inputValue();
    expect(
      /3,?700/.test(mine),
      `the reload keeps the typed price (got "${mine}")`,
    );
  }));
