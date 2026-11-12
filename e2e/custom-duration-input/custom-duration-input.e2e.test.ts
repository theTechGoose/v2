/**
 * REQ-458 (demo-loop cycle 3, demo M38) — "fix every issue the demo found,
 * loop until there are none". The demo saw the "Custom" job length as a dead
 * end: "Agreement reads: —", "NO input box", Lock it in disabled. The empty
 * number box (REQ-343) now has a visible label, an "e.g. 3" placeholder and a
 * focus ring, and the empty preview reads "Type a number".
 *
 * Page: /assistant/[id] (CustomDurationPickerForm in
 * front-end/islands/AsstChat.tsx).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
  if (!cookie) throw new Error(`sign-in: no session (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  for (
    const [path, payload] of [
      ["/api/me", { name: "Custom Length User", language: "en" }],
      ["/api/profile/identity", { businessName: "Custom Length Fencing" }],
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
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return auth;
}

async function postJson(
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

Deno.test("REQ-458 M38: Custom job length — labelled empty box, 'Type a number', type 4, pick hours, Lock it in", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const quote = await postJson(http, auth, "/api/quotes", {
      summary: "Fence repair",
      lineItems: [{
        description: "Fence repair",
        quantity: 1,
        unit: "ea",
        price: 30000,
      }],
      estimatedTotal: 30000,
      status: "sent",
    });
    const conv = await postJson(http, auth, "/api/agents/conversations", {
      quoteId: quote.id,
    });
    await postJson(
      http,
      auth,
      `/api/agents/conversations/${conv.id}/transition-to-terms`,
    );
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${conv.id}`);
    const form = page.locator(".cust-create");
    await form.waitFor({ state: "visible", timeout: 20_000 });
    await form.locator("input.cust-pick__search").first().fill("Lena Length");
    await form.locator("input[type=tel]").fill("5125550177");
    await page.locator(".cust-create__btn--primary:not([disabled])").click();
    await page.getByText(/when does the job start/i).first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    await page.locator("button.wiz-opt", { hasText: /TBD/ }).first().click();
    await page.getByText(/how long will the job take/i).first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    await page.locator("button.wiz-opt", { hasText: /Custom/ }).last()
      .click();

    // The number box is there, labelled and hinted.
    const num = page.locator("input#dur-num");
    await num.waitFor({ state: "visible", timeout: 10_000 });
    expect.eq(await num.inputValue(), "", "REQ-343: it opens empty");
    expect.eq(
      await num.getAttribute("placeholder"),
      "e.g. 3",
      "the empty box shows an example",
    );
    const label = page.locator("label[for='dur-num']");
    expect(await label.isVisible(), "the number box has a visible label");
    expect.eq(
      await page.getByLabel("How many?", { exact: true }).getAttribute("id"),
      "dur-num",
      "the label names the number box",
    );
    expect.eq(
      await page.locator("#dur-unit").inputValue(),
      "days",
      "a unit is pre-selected",
    );
    const preview = page.locator(".dur__preview-val");
    expect.eq(
      (await preview.innerText()).trim(),
      "Type a number",
      "the empty preview says what to do, not '—'",
    );
    const lock = page.locator("button", { hasText: /^Lock it in$/ });
    expect.eq(await lock.isDisabled(), true, "Lock in waits for a number");

    // Focus ring: the focused box draws a ring (box-shadow), not just a border tint.
    await num.focus();
    const shadow = await num.evaluate((el) => getComputedStyle(el).boxShadow);
    expect(shadow !== "none" && shadow !== "", `focus ring (${shadow})`);

    // Type 4, pick hours, lock it in.
    await num.fill("4");
    await page.locator("#dur-unit").selectOption("hours");
    await page.waitForFunction(
      () =>
        document.querySelector(".dur__preview-val")?.textContent?.trim() ===
          "4 hours",
      undefined,
      { timeout: 10_000 },
    );
    expect.eq(await lock.isDisabled(), false, "Lock it in is live");
    await lock.click();
    await page.locator("input#dur-num").waitFor({
      state: "detached",
      timeout: 15_000,
    });
    // The transcript records the pick with the step's label (REQ-047).
    await expect.see("Time to complete: 4 hours", { timeout: 20_000 });
  }));
