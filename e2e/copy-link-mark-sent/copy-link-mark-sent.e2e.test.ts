/**
 * REQ-572 (demo-loop cycle 4, issue p4-p7c) — "'Copy link' leaves quote
 * 'Ready to send'".
 *
 * The ▾ send menu's Copy link only copied the URL; the quote stayed "Ready
 * to send" with no way for the owner to say they shared it themselves. Now
 * the copy toast asks "Link copied — mark as sent?"; "Mark as sent" sends
 * PUT /quotes/:id {status:"sent", sentVia:"link"} and the header reads
 * "Shared by link".
 *
 * Page: /assistant/[id] (island AsstChat.tsx copyLinkFor / markSharedByLink;
 * toast in components/CustomerLinkRow.tsx).
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
      ["/api/me", { name: "Link User", language: "en" }],
      ["/api/profile/identity", { businessName: "Link Business" }],
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

/** Answer every wizard step in the browser until the quote review opens:
 *  a new customer with a phone and no email, then the first plain option
 *  of each remaining step. */
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
      "Link Customer",
    );
    await page.locator(".cust-create input[type=tel]").fill("5125550972");
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

Deno.test("REQ-572 p4-p7c: ▾ Copy link on a ready-to-send quote → 'Link copied — mark as sent?' → Mark as sent PUTs {status:'sent', sentVia:'link'} and the header reads 'Shared by link'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"])
      .catch(() => {});
    await page.setViewportSize({ width: 1280, height: 900 });

    const quote = await post(http, auth, "/api/quotes", {
      summary: "Fence repair",
      jobName: "Fence repair",
      lineItems: [{
        description: "Fence repair",
        quantity: 1,
        unit: "ea",
        price: 52000,
      }],
      estimatedTotal: 52000,
      status: "draft",
    });
    const conv = await post(http, auth, "/api/agents/conversations", {
      quoteId: quote.id,
    });
    await post(http, auth, `/api/agents/conversations/${conv.id}/lock-quote`, {
      quoteId: quote.id,
    });
    await post(
      http,
      auth,
      `/api/agents/conversations/${conv.id}/transition-to-terms`,
    );

    const puts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "PUT" && r.url().includes(`/quotes/${quote.id}`)) {
        puts.push(r.postData() ?? "");
      }
    });

    await page.goto(`/assistant/${conv.id}`);
    await finishWizardToReview(page);

    const sub = page.locator(".chat__head-sub").first();
    await page.waitForFunction(
      () =>
        /ready to send/i.test(
          document.querySelector(".chat__head-sub")?.textContent ?? "",
        ),
      undefined,
      { timeout: 20_000 },
    ).catch(() => {});
    expect(
      /ready to send/i.test(await sub.innerText()),
      `before the copy the header reads 'Ready to send' (got ${await sub
        .innerText()})`,
    );

    await page.locator(".quote-review__send-caret").first().click();
    const copyItem = page.locator(".quote-review__send-menu-item", {
      hasText: "Copy link",
    });
    await copyItem.waitFor({ state: "visible", timeout: 10_000 });
    await copyItem.click();

    const toast = page.locator("[data-cy='link-toast']");
    await toast.waitFor({ state: "visible", timeout: 10_000 });
    const toastText = await toast.innerText();
    expect(
      /mark as sent\?/i.test(toastText),
      `the toast asks 'Link copied — mark as sent?' (got ${toastText})`,
    );
    expect.eq(puts.length, 0, "copying alone changes nothing");

    const mark = page.locator("[data-cy='link-toast-mark-sent']");
    await mark.waitFor({ state: "visible", timeout: 5_000 });
    await mark.click();

    await page.waitForFunction(
      () =>
        /shared by link/i.test(
          document.querySelector(".chat__head-sub")?.textContent ?? "",
        ),
      undefined,
      { timeout: 15_000 },
    ).catch(() => {});
    expect.eq(puts.length, 1, "Mark as sent sends one PUT /quotes/:id");
    expect.eq(
      JSON.stringify(JSON.parse(puts[0] || "{}")),
      JSON.stringify({ status: "sent", sentVia: "link" }),
      "the PUT body is {status:'sent', sentVia:'link'}",
    );
    expect(
      /shared by link/i.test(await sub.innerText()),
      `the header reads 'Shared by link' (got ${await sub.innerText()})`,
    );
    const row = await http(`/api/quotes/${quote.id}`, { headers: auth });
    const saved = await row.json();
    expect.eq(saved.status, "sent", "the quote row is sent");
    expect.eq(saved.sentVia, "link", "the quote row says it went by link");
  }));
