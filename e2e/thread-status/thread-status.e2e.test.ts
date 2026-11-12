/**
 * REQ-369 — Raphael, 2026-11-12, demo-loop cycle 1: "fix every issue the
 * demo found, loop until there are none." Demo issue m2, "Status labels
 * disagree inside the app": the chat header said "Quote accepted" while the
 * conversation list said "Quote sent"; "Quote locked · ready to send" while
 * the list said "Drafting"; the list read "Terms" during the wizard.
 *
 * One thread on /assistant/[id] (islands AsstChat + AsstThreads +
 * ChatHeaderLive; the rule in shared/quote-flow/chat-header.ts): after every
 * step the open thread's list chip and its quote card read exactly what the
 * header reads — on a fresh load, as soon as the wizard finishes in the page
 * (no reload, no waiting out the list's poll), and after the customer signs
 * on the public page. Two more stories pin the edges: the card agrees while
 * the chat's read of the quote row is still on its way (a slow network), and
 * a signature reaches a chat that has no review open, with no reload.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

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
  for (
    const [path, payload] of [
      ["/api/me", { name: "Status User", language: "en" }],
      ["/api/profile/identity", { businessName: "Status Business" }],
    ] as const
  ) {
    const res = await http(path, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify(payload),
    });
    await res.body?.cancel();
  }
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
  return auth;
}

async function post(
  http: StoryTools["http"],
  headers: Record<string, string>,
  path: string,
  payload?: unknown,
) {
  const res = await http(path, {
    method: "POST",
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return await res.json().catch(() => ({}));
}

/** The header's status line and the open thread's list chip, once the
 *  header reads `want`. */
async function headerAndChip(page: StoryTools["page"], want: RegExp) {
  await page.waitForFunction(
    (src) =>
      new RegExp(src, "i").test(
        (document.querySelector(".chat__head-sub") as HTMLElement | null)
          ?.textContent ?? "",
      ),
    want.source,
    { timeout: 25_000 },
  ).catch(() => {});
  const header = (await page.locator(".chat__head-sub").first().textContent())
    ?.trim() ?? "";
  const chip = (await page.locator(".thread--active .thread__chip").first()
    .textContent())?.trim() ?? "";
  return { header, chip };
}

/** Wait (up to `ms`) for the open thread's chip to read the header's words —
 *  the chat pushes its status, the list does not wait for its 8 s poll. */
async function chipCatchesUp(page: StoryTools["page"], ms: number) {
  await page.waitForFunction(
    () => {
      const h = document.querySelector(".chat__head-sub")?.textContent
        ?.trim();
      const c = document.querySelector(".thread--active .thread__chip")
        ?.textContent?.trim();
      return !!h && h === c;
    },
    undefined,
    { timeout: ms },
  ).catch(() => {});
  return {
    header: (await page.locator(".chat__head-sub").first().textContent())
      ?.trim() ?? "",
    chip: (await page.locator(".thread--active .thread__chip").first()
      .textContent())?.trim() ?? "",
  };
}

/** The open thread's quote card chip — the newest action card's. */
async function cardChip(page: StoryTools["page"]): Promise<string> {
  const chips = page.locator(".action-card__chip");
  const n = await chips.count();
  return n === 0 ? "" : (await chips.nth(n - 1).textContent())?.trim() ?? "";
}

/** A drafted quote and the conversation bound to it, made over the API. */
async function newThread(
  http: StoryTools["http"],
  auth: Record<string, string>,
): Promise<{ quoteId: string; convId: string }> {
  const quote = await post(http, auth, "/api/quotes", {
    summary: "Cedar fence — 120 ft",
    jobName: "Cedar fence",
    lineItems: [{
      description: "Cedar privacy fence (120 ft)",
      quantity: 1,
      unit: "ea",
      price: 480000,
    }],
    estimatedTotal: 480000,
    status: "draft",
  });
  const conv = await post(http, auth, "/api/agents/conversations", {
    quoteId: quote.id,
  });
  return { quoteId: quote.id, convId: conv.id };
}

/** The customer signs on the public page — no session. */
async function customerSigns(http: StoryTools["http"], quoteId: string) {
  const res = await http(`/api/quotes/${quoteId}/accept`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "Status Customer", signature: "SC" }),
  });
  await res.body?.cancel();
}

/** Answer every wizard step in the page until the quote review opens: the
 *  customer step first (a new customer with a phone), then the first plain
 *  option of each remaining step. */
async function finishWizardToReview(page: StoryTools["page"]) {
  const review = page.locator(".quote-review");
  const startQuestion = page.getByText(/when does the job start/i);
  await page.locator(".wiz__opts, .cust-create").first().waitFor({
    state: "visible",
    timeout: 20_000,
  });
  if ((await startQuestion.count()) === 0) {
    if ((await page.locator(".cust-create").count()) === 0) {
      await page.locator(".wiz-opt--custom:visible").first().click();
    }
    await page.locator(".cust-create input.cust-pick__search").first().fill(
      "Status Customer",
    );
    await page.locator(".cust-create input[type=tel]").fill("5125550369");
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

Deno.test("REQ-369: the open thread's list chip reads what the chat header reads — on load, the moment the wizard finishes, and after the customer signs", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });

    const { quoteId, convId } = await newThread(http, auth);
    const url = `/assistant/${convId}`;

    await page.goto(url);
    let s = await headerAndChip(page, /quote drafted/i);
    expect.eq(
      s.chip,
      s.header,
      "a drafted quote: the list chip reads the header",
    );

    // Lock it in (demo pairs 4, 5, 8: "Drafting" under "Quote locked").
    await post(http, auth, `/api/agents/conversations/${convId}/lock-quote`, {
      quoteId,
    });
    await page.goto(url);
    s = await headerAndChip(page, /quote locked/i);
    expect(/quote locked/i.test(s.header), `locked (header: ${s.header})`);
    expect.eq(s.chip, s.header, "after Lock: the list chip reads the header");
    expect.eq(
      await cardChip(page),
      s.header,
      "after Lock: the quote card reads the header",
    );

    // The terms wizard asking (demo pairs 1, 7: "Terms" / "Términos").
    await post(
      http,
      auth,
      `/api/agents/conversations/${convId}/transition-to-terms`,
    );
    await page.goto(url);
    // REQ-454 (cycle 3, m34): the wizard on the locked quote reads forward.
    s = await headerAndChip(page, /adding terms/i);
    expect(
      /adding terms/i.test(s.header),
      `adding terms (header: ${s.header})`,
    );
    expect.eq(
      s.chip,
      s.header,
      "in the wizard: the list chip reads the header",
    );
    expect.eq(
      await cardChip(page),
      s.header,
      'in the wizard: the quote card reads the header, not the "Locked · ready to send" it was appended with',
    );

    // Finish the wizard IN the page: the chip follows without a reload,
    // well inside the list's 8 s poll.
    await finishWizardToReview(page);
    await headerAndChip(page, /^ready to send$/i);
    s = await chipCatchesUp(page, 3_000);
    expect(/^ready to send$/i.test(s.header), `ready (header: ${s.header})`);
    expect.eq(
      s.chip,
      s.header,
      "the wizard finished in the page: the chip reads the header within 3 s, no reload",
    );
    expect.eq(
      await cardChip(page),
      s.header,
      "the wizard finished: the quote card reads the header",
    );
    expect.eq(
      (await page.locator(".quote-review__chip").first().textContent())
        ?.trim() ?? "",
      s.header,
      "the wizard finished: the review's chip reads the header",
    );

    // The customer signs on the public page (demo pair 1: header "Quote
    // accepted", list "Quote sent").
    await customerSigns(http, quoteId);
    s = await headerAndChip(page, /quote accepted/i);
    expect(/quote accepted/i.test(s.header), `signed (header: ${s.header})`);
    s = await chipCatchesUp(page, 3_000);
    expect.eq(s.chip, s.header, "signed on /q: the list chip reads the header");
    expect.eq(
      await cardChip(page),
      s.header,
      "signed on /q: the quote card reads the header",
    );

    // And a fresh load agrees too.
    await page.goto(url);
    s = await headerAndChip(page, /quote accepted/i);
    expect.eq(
      s.chip,
      s.header,
      "after a reload: the list chip reads the header",
    );
    expect.eq(
      await cardChip(page),
      s.header,
      "after a reload: the quote card reads the header",
    );
  }));

Deno.test("REQ-369: while the chat's read of the quote row is still on its way, the quote card already reads what the header and the list chip read", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    const { quoteId, convId } = await newThread(http, auth);
    await post(http, auth, `/api/agents/conversations/${convId}/lock-quote`, {
      quoteId,
    });
    await post(
      http,
      auth,
      `/api/agents/conversations/${convId}/transition-to-terms`,
    );

    // A slow network: hold the chat's read of its quote row (the screenshot
    // the first story took right at load showed the card "Locked · ready to
    // send" under the header "Gathering a little more info").
    const rowUrl = new RegExp(`/api/quotes/${quoteId}(\\?.*)?$`);
    let release = () => {};
    const held = new Promise<void>((r) => (release = r));
    let released = false;
    await page.route(rowUrl, async (route) => {
      await held;
      await route.continue().catch(() => {});
    });
    const asked = page.waitForRequest(rowUrl, { timeout: 25_000 });
    await page.goto(`/assistant/${convId}`);
    await asked; // the chat hydrated and asked for its row
    let s = await chipCatchesUp(page, 5_000);
    expect(
      /adding terms/i.test(s.header),
      `adding terms (header: ${s.header})`,
    );
    expect.eq(released, false, "the quote row is still on its way");
    expect.eq(
      await cardChip(page),
      s.header,
      "before the quote row arrives: the quote card reads the header",
    );
    expect.eq(
      s.chip,
      s.header,
      "before the quote row arrives: the list chip reads the header",
    );

    released = true;
    const answered = page.waitForResponse(rowUrl, { timeout: 25_000 });
    release();
    await answered;
    s = await chipCatchesUp(page, 3_000);
    expect(
      /adding terms/i.test(s.header),
      `still adding terms (header: ${s.header})`,
    );
    expect.eq(
      await cardChip(page),
      s.header,
      "the quote row arrived: the quote card reads the header",
    );
    expect.eq(
      s.chip,
      s.header,
      "the quote row arrived: the list chip reads the header",
    );
  }));

Deno.test("REQ-369: the customer signs while the chat sits open with no review on screen — the header, the quote card and the list chip follow, with no reload", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    const { quoteId, convId } = await newThread(http, auth);
    await post(http, auth, `/api/agents/conversations/${convId}/lock-quote`, {
      quoteId,
    });
    await page.goto(`/assistant/${convId}`);
    let s = await headerAndChip(page, /quote locked/i);
    expect(/quote locked/i.test(s.header), `locked (header: ${s.header})`);
    expect.eq(s.chip, s.header, "locked: the list chip reads the header");
    expect.eq(
      await page.locator(".quote-review").count(),
      0,
      "no review on screen — its own poll of the quote row is not running",
    );
    await page.evaluate(() => {
      (globalThis as Record<string, unknown>).__req369 = "same page";
    });

    // The list's next poll sees the signed row and hands it back to the chat,
    // which re-reads its quote: all three move together.
    await customerSigns(http, quoteId);
    s = await headerAndChip(page, /quote accepted/i);
    expect(
      /quote accepted/i.test(s.header),
      `the header follows the signature (header: ${s.header})`,
    );
    s = await chipCatchesUp(page, 3_000);
    expect.eq(s.chip, s.header, "signed: the list chip reads the header");
    expect.eq(
      await cardChip(page),
      s.header,
      "signed: the quote card reads the header",
    );
    expect.eq(
      await page.evaluate(() =>
        (globalThis as Record<string, unknown>).__req369
      ),
      "same page",
      "no reload",
    );
  }));
