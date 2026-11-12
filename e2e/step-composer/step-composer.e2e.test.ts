/**
 * REQ-392 — demo-loop cycle 2, issue M7 (cycle 1 M9): "There is NO chat text
 * box at 'Pick a price' — can't tell the assistant it's wrong" (pair 7), and
 * none on "Who is this for?" or the Ready-to-send card either.
 *
 * The big composer stays off the tap steps (REQ-041 NW-53b); a compact
 * "Tell the assistant…" box is there instead, and what is typed in it goes to
 * the assistant WITH the step: on Pick a price it comes back re-priced and the
 * price the contractor named lands in the price box.
 *
 * Story 1 is the demo's own path (help me price it → confirm the details →
 * Pick a price → the correction → the wizard's customer step). Story 2 opens
 * the Ready-to-send review and talks to the assistant there.
 *
 * Page: /assistant (island front-end/islands/AsstChat.tsx; the compact box is
 * front-end/components/StepComposer.tsx; the rules shared/quote-flow/step-composer.ts).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

const TYPED =
  "Master bath remodel for Maria Gutierrez. Tub out, curbless shower, 12x24 tile on the walls.";
const FIX =
  "No that's wrong, it's the WHOLE gut job incl. heated floor, vanity, glass, drain move — more like $28,000";

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
  await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  }).then((x) => x.body?.cancel());
  await answerQuestions(http, auth, {
    name: "Priya Nair",
    businessName: "Nair Remodeling",
  });
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
  return auth;
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
  throw new Error(`${selector}: the click never took`);
}

const bigComposer = (page: StoryTools["page"]) =>
  page.locator("textarea.composer__input");
const stepBox = (page: StoryTools["page"]) =>
  page.locator("[data-cy=step-composer]");

/** Open the compact box, type, send; returns the chat request's body. */
async function tellTheAssistant(
  page: StoryTools["page"],
  text: string,
): Promise<{ content?: string; step?: Record<string, unknown> }> {
  await clickUntil(
    page,
    "[data-cy=step-composer-open]",
    async () =>
      (await page.locator("[data-cy=step-composer-input]").count()) > 0,
  );
  const input = page.locator("[data-cy=step-composer-input]");
  await input.fill(text);
  const sent = page.waitForRequest((r) =>
    r.url().includes("/agents/chat") && r.method() === "POST"
  );
  const answered = page.waitForResponse((r) =>
    r.url().includes("/agents/chat") && r.request().method() === "POST"
  );
  answered.catch(() => {});
  await input.press("Enter");
  const req = await sent;
  await answered;
  return JSON.parse(req.postData() ?? "{}");
}

Deno.test("REQ-392 M7: on Pick a price the contractor can tell the assistant it's wrong — the correction goes to the pricing engine and its price fills the box; the box is there on every step after", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/assistant");
    await clickUntil(
      page,
      "button.chat__empty-prompt:has-text('help me price it')",
      () => page.locator(".chat__details-prompt-bubble").isVisible(),
    );
    await bigComposer(page).fill(TYPED);
    await page.locator("button.composer__send").click();

    // Job details (the confirm picker): a tap step — no big composer, the
    // compact box instead.
    await page.locator("[data-cy=confirm-details]").waitFor({
      state: "visible",
      timeout: 30_000,
    });
    expect.eq(
      await bigComposer(page).count(),
      0,
      "no big composer on the picker (REQ-041)",
    );
    expect.eq(
      await page.locator(".chat__jobopts [data-cy=step-composer-open]")
        .getAttribute("data-step"),
      "job_details",
      "the compact box is on the Job details step, in the picker's own Continue row",
    );
    expect.eq(
      await stepBox(page).count(),
      0,
      "closed, it adds no bar under the picker (REQ-338: the picker keeps the panel)",
    );

    // Pick a price.
    await page.locator(".chat__jobopts .chat__price-continue").first().click();
    await page.locator("[data-cy=pricing-option]").first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
    expect.eq(
      await bigComposer(page).count(),
      0,
      "no big composer on Pick a price (REQ-041)",
    );
    const priceOpen = page.locator(
      ".chat__price-capture [data-cy=step-composer-open]",
    );
    expect.eq(
      await priceOpen.getAttribute("data-step"),
      "price",
      "the compact box is on Pick a price, in its Continue row",
    );
    expect.eq(
      await stepBox(page).count(),
      0,
      "closed, no bar under Pick a price",
    );
    expect(
      (await priceOpen.innerText()).includes("Tell the assistant"),
      "it reads 'Tell the assistant…'",
    );

    const body = await tellTheAssistant(page, FIX);
    expect.eq(body.content, FIX, "the correction is what is sent");
    expect.eq(body.step?.id, "price", "sent with the step it was typed on");
    expect.eq(body.step?.job, TYPED, "with the job as typed");
    expect(
      typeof body.step?.scope === "string" &&
        (body.step.scope as string).trim().length > 0,
      `and the confirmed details (${JSON.stringify(body.step?.scope)})`,
    );
    expect.eq(body.step?.tiers, true, "the tiers on screen are re-priced");
    expect.eq(
      await stepBox(page).getAttribute("data-step"),
      "price",
      "opened, the box shows under the price step",
    );

    // The step updates: the assistant's answer shows on the step and the
    // named price is in the box. The tiers are the re-priced ones when a
    // pricing model answers; with the stub LLM it can't re-price, says so,
    // and the three on screen stay.
    const note = page.locator("[data-cy=step-composer-note]");
    await note.waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(
      () =>
        (document.querySelector("[data-cy=step-composer-note]")?.textContent ??
          "").includes("$28,000"),
      undefined,
      { timeout: 30_000 },
    );
    await note.hover(); // the evidence's frame of the answered step
    const said = await note.innerText();
    expect(
      said.includes("Re-priced") || said.includes("couldn't re-price"),
      `the answer shows on the step (${said})`,
    );
    expect(said.includes("$28,000"), `it names the price (${said})`);
    expect.eq(
      await page.locator("[data-cy=pricing-option]").count(),
      3,
      "three tiers",
    );
    await page.waitForFunction(
      () =>
        (document.querySelector(".chat__price-capture input.mi__input") as
          | HTMLInputElement
          | null)?.value === "28,000",
      undefined,
      { timeout: 10_000 },
    );
    expect.eq(
      await page.locator(".chat__price-capture input.mi__input").inputValue(),
      "28,000",
      "the price the contractor named fills the price box",
    );
    expect(
      await page.locator(".chat__price-capture button.chat__price-continue")
        .isEnabled(),
      "Continue takes it",
    );

    // Continue at that price → the wizard's first question ("Who is this
    // for?"): the compact box is there too. REQ-449: Continue creates the
    // quote and opens the wizard in place (no page load).
    await page.locator(".chat__price-capture button.chat__price-continue")
      .click();
    await page.locator(".wiz__opts, .cust-create, .cust-pick").first().waitFor({
      state: "visible",
      timeout: 30_000,
    });
    await stepBox(page).waitFor({ state: "visible", timeout: 20_000 });
    expect.eq(
      await stepBox(page).getAttribute("data-step"),
      "wizard",
      "the box is on the customer step",
    );
    expect.eq(
      await bigComposer(page).count(),
      0,
      "still no big composer on a tap step",
    );
  }));

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  payload?: unknown,
) {
  const res = await http(path, {
    method: "POST",
    headers: auth,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return await res.json().catch(() => ({}));
}

/** Answer every wizard step until the quote review opens: the customer step
 *  first, then the first plain option of each remaining step. */
async function finishWizardToReview(page: StoryTools["page"]) {
  const review = page.locator(".quote-review");
  const startQuestion = page.getByText(/when does the job start/i);
  await page.locator(".wiz__opts, .cust-create").first().waitFor({
    state: "visible",
    timeout: 20_000,
  });
  if ((await startQuestion.count()) === 0) {
    if ((await page.locator(".cust-create").count()) === 0) {
      await clickUntil(
        page,
        ".wiz-opt--custom:visible",
        async () => (await page.locator(".cust-create:visible").count()) > 0,
      );
    }
    await page.locator(".cust-create input.cust-pick__search").first().fill(
      "Maria Gutierrez",
    );
    await page.locator(".cust-create input[type=tel]").fill("5125550188");
    await page.locator(".cust-create__btn--primary").click();
  }
  const plain = page.locator(
    ".wiz__opts .wiz-opt:not(.wiz-opt--custom):visible",
  );
  for (let i = 0; i < 10; i++) {
    await page.locator(".quote-review, .wiz__opts .wiz-opt:visible").first()
      .waitFor({ state: "visible", timeout: 20_000 });
    if (await review.first().isVisible().catch(() => false)) return;
    const label = (await plain.first().innerText()).trim();
    await plain.first().click();
    await page.waitForFunction(
      (l) =>
        ![...document.querySelectorAll(".wiz__opts .wiz-opt")].some((e) =>
          (e as HTMLElement).offsetParent !== null &&
          (e as HTMLElement).innerText.trim() === l
        ),
      label,
      { timeout: 20_000 },
    ).catch(() => {});
  }
  await review.first().waitFor({ state: "visible", timeout: 20_000 });
}

Deno.test("REQ-392 M7: on Ready to send the contractor can still talk to the assistant — the message goes as a revision of the quote and the review stays open", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    const quote = await post(http, auth, "/api/quotes", {
      summary: "Master bath remodel",
      description: "Remove the tub\nBuild a curbless shower\nTile 12x24",
      lineItems: [{
        description: "Master bath remodel",
        quantity: 1,
        unit: "ea",
        price: 2_800_000,
      }],
      estimatedTotal: 2_800_000,
    });
    const conv = await post(http, auth, "/api/agents/conversations", {
      quoteId: quote.id,
    });
    await post(
      http,
      auth,
      `/api/agents/conversations/${conv.id}/transition-to-terms`,
    );
    await page.goto(`/assistant/${conv.id}`);
    await stepBox(page).waitFor({ state: "visible", timeout: 30_000 });
    expect.eq(
      await stepBox(page).getAttribute("data-step"),
      "wizard",
      "the box is on the customer step",
    );

    await finishWizardToReview(page);
    await stepBox(page).waitFor({ state: "visible", timeout: 20_000 });
    expect.eq(
      await stepBox(page).getAttribute("data-step"),
      "review",
      "the box is on Ready to send",
    );
    expect.eq(
      await bigComposer(page).count(),
      0,
      "no big composer under the review",
    );

    const ask = "add a line for the city permit";
    const replies = ".msg:not(.msg--user) .msg__bubble";
    const before = await page.locator(replies).count();
    const body = await tellTheAssistant(page, ask);
    expect.eq(body.step?.id, "review", "sent as a revision of the quote");
    await page.locator(".msg__bubble", { hasText: ask }).last().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    await page.waitForFunction(
      ([sel, n]) =>
        document.querySelectorAll(sel as string).length > (n as number),
      [replies, before],
      { timeout: 20_000 },
    );
    expect(
      await page.locator(".quote-review").first().isVisible(),
      "the review stays open",
    );
    expect.eq(
      await stepBox(page).getAttribute("data-step"),
      "review",
      "and the box with it",
    );
  }));
