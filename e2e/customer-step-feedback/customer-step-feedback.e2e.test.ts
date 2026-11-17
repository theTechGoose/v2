/**
 * REQ-390 (demo-loop cycle 2; demo m18, m19, M18) — "fix every issue the demo
 * found, loop until there are none". The demo saw:
 *  - m19: a red "Add a phone number or email…" in the assistant's "Who is
 *    this for?" form before anything was typed;
 *  - m18: one bad field named at a time; onboarding's ZIP blocked Continue
 *    with no word until the field was left;
 *  - M18: "Looks like Bob already exists" for a Bob with ANOTHER phone, and
 *    two "Bob" cards on /customers nobody could tell apart.
 *
 * Pages: /assistant/[id] (CustomerStepPanel in front-end/islands/AsstChat.tsx),
 * /customers (front-end/islands/ClientsBoard.tsx), /welcome
 * (front-end/islands/WelcomeWizard.tsx).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

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
      ["/api/me", { name: "Step User", language: "en" }],
      ["/api/profile/identity", { businessName: "Step Cleaning" }],
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
    } catch {
      // not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

Deno.test("REQ-390 m19/m18/M18 + REQ-524 p8-pair7-a: the chat's customer form — neutral hint before typing, no format error while typing, both bad fields named, 'another Bob' with the existing Bob's phone", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await postJson(http, auth, "/api/customers", {
      name: "Bob",
      phoneNumber: "5125550142",
    });
    const quote = await postJson(http, auth, "/api/quotes", {
      summary: "Gutter clean",
      lineItems: [{
        description: "Gutter clean",
        quantity: 1,
        unit: "ea",
        price: 20000,
      }],
      estimatedTotal: 20000,
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
    await clickUntil(
      page,
      "button:has-text('+ New customer')",
      async () => await form.isVisible(),
    );

    // m19: before anything is typed the reason is a neutral hint
    const hint = page.locator("[data-cy='cust-contact-hint']");
    await hint.waitFor({ state: "visible", timeout: 10_000 });
    expect(
      (await hint.innerText()).includes("Add a phone number or email"),
      "the reason is visible from the start (REQ-029)",
    );
    const cls = (await hint.getAttribute("class")) ?? "";
    expect(
      cls.includes("cust-pick__hint") && !cls.includes("cust-pick__err"),
      `untouched, it is a hint, not an error (${cls})`,
    );

    // REQ-524 (cycle 3, p8-pair7-a): a half-typed phone / email is not
    // called wrong while the field still has focus — only once it is left
    const phone = form.locator("input[type=tel]");
    const email = form.locator("input[type=email]");
    await phone.fill("512");
    await page.waitForTimeout(400);
    expect(
      (await page.locator("[data-cy='cust-phone-err']").count()) === 0,
      "REQ-524: no phone error while still typing",
    );
    await phone.press("Tab");
    await page.locator("[data-cy='cust-phone-err']").waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await email.fill("bob@");
    await page.waitForTimeout(400);
    expect(
      (await page.locator("[data-cy='cust-email-err']").count()) === 0,
      "REQ-524: no email error while still typing",
    );
    await email.press("Tab");
    await page.locator("[data-cy='cust-email-err']").waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await email.fill("");

    // M18: the same name shows WHICH Bob exists
    const nameInput = form.locator("input.cust-pick__search").first();
    await nameInput.fill("Bob");
    const dupe = page.locator("[data-cy='cust-already-exists']");
    await dupe.waitFor({ state: "visible", timeout: 10_000 });
    expect(
      (await dupe.innerText()).includes("(512) 555-0142"),
      `the warning shows the existing Bob's phone (${await dupe.innerText()})`,
    );
    await phone.fill("5125550177");
    await page.waitForFunction(
      () =>
        /another/i.test(
          document.querySelector("[data-cy='cust-already-exists']")
            ?.textContent ?? "",
        ),
      undefined,
      { timeout: 10_000 },
    );
    const another = await dupe.innerText();
    expect(
      another.includes("(512) 555-0142"),
      `'another Bob' still names the existing one's phone (${another})`,
    );

    // m18: a bad phone AND a bad email are both named, each on its own
    await nameInput.fill("Robert Q");
    await phone.fill("555-12");
    await email.fill("bob@@gmail");
    await email.press("Tab"); // REQ-524: the message waits for the field to be left
    await page.locator("[data-cy='cust-phone-err']").waitFor({
      state: "visible",
      timeout: 10_000,
    });
    await page.locator("[data-cy='cust-email-err']").waitFor({
      state: "visible",
      timeout: 10_000,
    });
    expect(
      (await page.locator("[data-cy='cust-phone-err']").innerText()).includes(
        "phone",
      ),
      "the phone's message is the phone's",
    );
    expect(
      (await page.locator("[data-cy='cust-email-err']").innerText()).includes(
        "email",
      ),
      "the email's message is the email's",
    );

    // m19: once a contact field was touched and is empty, the reason is an error
    await phone.fill("");
    await email.fill("");
    await email.press("Tab");
    await page.waitForFunction(
      () =>
        (document.querySelector("[data-cy='cust-contact-hint']")?.className ??
          "").includes("cust-pick__err"),
      undefined,
      { timeout: 10_000 },
    );
  }));

Deno.test("REQ-390 M18: two customers named Bob carry a disambiguator on their card faces", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await postJson(http, auth, "/api/customers", {
      name: "Bob",
      phoneNumber: "5125550142",
    });
    await postJson(http, auth, "/api/customers", {
      name: "Bob",
      phoneNumber: "5125550177",
      allowDuplicate: true,
    });
    await page.goto("/customers");
    const tags = page.locator("[data-cy='ccard2-disambig']");
    await page.waitForFunction(
      () =>
        document.querySelectorAll("[data-cy='ccard2-disambig']").length >= 2,
      undefined,
      { timeout: 20_000 },
    );
    const texts = await tags.allInnerTexts();
    expect.eq(texts.length, 2, "both Bobs carry one");
    expect(
      texts[0] !== texts[1] && texts.every((s) => s.trim().length > 0),
      `the two tags differ (${texts.join(" / ")})`,
    );
  }));

Deno.test("REQ-390 m18: onboarding names a short ZIP while it is still being typed (Continue never off without a word)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, { except: ["address"] });
    await page.goto("/welcome?lang=en");
    await expect.see("Where's the business based?");
    const street = page.locator("input[aria-label='Street address']");
    await street.waitFor({ timeout: 60_000 });
    for (let attempt = 0; attempt < 8; attempt++) {
      await street.fill("1600 Congress Ave");
      try {
        await page.locator("[data-cy='welcome-continue']:not([disabled])")
          .waitFor({ timeout: 1500 });
        break;
      } catch { /* not hydrated yet — fill again */ }
    }
    const zip = page.locator("input[aria-label='ZIP']");
    await zip.fill("7870"); // focus stays in the field
    await expect.see("Enter a 5-digit ZIP");
    expect.eq(
      await page.locator("[data-cy='welcome-continue']").isDisabled(),
      true,
      "Continue waits for a real ZIP",
    );
  }));

Deno.test("REQ-390 m18: a custom duration of '-3' is refused with a message, never written as '1 day'", (t) =>
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
    await form.locator("input.cust-pick__search").first().fill("Dana Duration");
    await form.locator("input[type=tel]").fill("5125550123");
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
    const num = page.locator("input.dur__num");
    await num.waitFor({ state: "visible", timeout: 10_000 });
    await num.fill("-3");
    const err = page.locator("[data-cy='dur-num-err']");
    await err.waitFor({ state: "visible", timeout: 10_000 });
    expect(
      (await err.innerText()).includes("1 to 99"),
      `the message names the rule (${await err.innerText()})`,
    );
    expect.eq(await num.inputValue(), "-3", "what was typed stays");
    const preview = await page.locator(".dur__preview-val").innerText();
    expect(
      !/\b1 day\b/.test(preview),
      `the agreement does not read '1 day' (${preview})`,
    );
    expect.eq(
      await page.locator("button", { hasText: /^Lock it in$/ }).isDisabled(),
      true,
      "Lock in waits for a real number",
    );
    await num.fill("3");
    await page.locator("[data-cy='dur-num-err']").waitFor({
      state: "detached",
      timeout: 10_000,
    });
  }));
