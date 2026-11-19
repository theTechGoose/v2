/**
 * REQ-352 (demo-loop cycle 1; demo M38, setup-m15, p15-5) — "fix every issue
 * the demo found, loop until there are none". The demo saw:
 *  - "bob@@gmail" in the New customer modal showed ONLY the browser's native
 *    bubble (type=email, no novalidate), which the demo stage cannot mirror;
 *  - a phone error printed under the Email field (one <p role=alert>);
 *  - an empty name silently disabled Add;
 *  - no "Cliente agregado" after a successful Add;
 *  - the onboarding wizard took ZIP "7870" and a Zelle handle "asdf".
 *
 * Pages: /customers (front-end/islands/ClientsPage.tsx), /welcome
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
) {
  const phone = `+1512${digits()}`;
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Validation Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: "en",
      domain,
      path: "/",
    }]),
  );
  return { auth };
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

/** the in-app message an input names with aria-describedby, and whether it is flagged invalid */
async function fieldMessage(
  input: ReturnType<StoryTools["page"]["locator"]>,
  page: StoryTools["page"],
) {
  const invalid = await input.getAttribute("aria-invalid");
  const id = await input.getAttribute("aria-describedby");
  const text = id
    ? ((await page.locator(`[id='${id}']`).textContent()) ?? "")
    : "";
  return { invalid, text };
}

Deno.test("REQ-352 M38/setup-m15/p15-5: the New customer modal shows its own message under each field — 'bob@@gmail' under Email (no native bubble), '555-12' under Phone, 'name required' for an empty Add — and confirms '<name> added'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await page.goto("/customers");
    const modal = page.locator("form[role='dialog']");
    await clickUntil(
      page,
      "button.ph2__cta",
      async () => (await modal.count()) > 0,
    );

    const nameInput = modal.locator("input").nth(0);
    const phone = modal.locator("input[type='tel']");
    const email = modal.locator("input[type='email']");
    const add = modal.locator("button[type='submit']");

    // an empty Add says why, instead of a silently disabled button
    expect.eq(
      await add.isDisabled(),
      false,
      "Add is pressable with an empty name",
    );
    await add.click();
    await expect.see("Enter the customer's name");
    expect.eq(
      (await fieldMessage(nameInput, page)).invalid,
      "true",
      "the name field is flagged",
    );

    // no novalidate hack: the form itself must let OUR rule run
    await nameInput.fill("Bob");
    await email.fill("bob@@gmail");
    await add.click();
    await expect.see("Enter a valid email address");
    const em = await fieldMessage(email, page);
    expect.eq(em.invalid, "true", "the email field is flagged aria-invalid");
    expect(
      em.text.includes("Enter a valid email address"),
      `the email message sits on the email field (${em.text})`,
    );
    expect.eq(
      await email.evaluate((el: HTMLInputElement) => el.form?.noValidate),
      true,
      "the modal form is novalidate — no native bubble",
    );

    // the phone's message is the phone's, shown on blur
    await phone.fill("555-12");
    await phone.press("Tab");
    await expect.see("Enter a full phone number");
    const ph = await fieldMessage(phone, page);
    expect.eq(ph.invalid, "true", "the phone field is flagged aria-invalid");
    expect(
      ph.text.includes("Enter a full phone number"),
      `the phone message sits under Phone, not Email (${ph.text})`,
    );
    expect(
      !(await fieldMessage(email, page)).text.includes("phone"),
      "the email field does not carry the phone's message",
    );

    const none = await (await http("/api/customers", { headers: auth })).json();
    expect(
      none.length === 0,
      `nothing saved after the refusals (${none.length})`,
    );

    // a good customer saves and the page says so
    await phone.fill("5125550199");
    await email.fill("bob@gmail.com");
    await add.click();
    await expect.see("Bob added");
    const status = await page.locator("[role='status']").filter({
      hasText: "Bob added",
    }).count();
    expect(status > 0, "the confirmation is a role=status toast");
  }));

/** type into a wizard field until the island has hydrated and taken it (Continue enables) */
async function typeIn(
  page: StoryTools["page"],
  selector: string,
  value: string,
): Promise<void> {
  const input = page.locator(selector);
  await input.waitFor({ timeout: 60_000 });
  for (let attempt = 0; attempt < 8; attempt++) {
    await input.fill(value);
    try {
      await page.locator("[data-cy='welcome-continue']:not([disabled])")
        .waitFor({ timeout: 1500 });
      return;
    } catch { /* not hydrated yet — fill again */ }
  }
  throw new Error(`the wizard never took "${value}" at ${selector}`);
}

Deno.test("REQ-352 M38: the onboarding wizard refuses ZIP '7870' and Zelle 'asdf' with an in-app message, and takes 78701 and an email", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, { except: ["address", "payment"] });
    await page.goto("/welcome?lang=en");
    await expect.see("Where's the business based?");

    const zip = "input[aria-label='ZIP']";
    const cont = page.locator("[data-cy='welcome-continue']");
    await typeIn(
      page,
      "input[aria-label='Street address']",
      "1600 Congress Ave",
    );
    await page.locator(zip).fill("7870");
    await page.locator(zip).press("Tab");
    await expect.see("Enter a 5-digit ZIP");
    expect.eq(
      await page.locator(zip).getAttribute("aria-invalid"),
      "true",
      "the ZIP is flagged",
    );
    expect.eq(await cont.isDisabled(), true, "Continue waits for a real ZIP");
    await page.locator(zip).fill("78701");
    await page.locator("[data-cy='welcome-continue']:not([disabled])").waitFor({
      timeout: 5_000,
    });
    await cont.click();

    await expect.see("How do you want to get paid?");
    await clickUntil(
      page,
      "button[aria-pressed]:has-text('Zelle')",
      async () =>
        (await page.locator("input[aria-label='Zelle email or phone']")
          .count()) > 0,
    );
    const handle = page.locator("input[aria-label='Zelle email or phone']");
    await handle.fill("asdf");
    await handle.press("Tab");
    await expect.see("Enter the email or phone number your Zelle uses");
    expect.eq(
      await handle.getAttribute("aria-invalid"),
      "true",
      "the Zelle handle is flagged",
    );
    expect.eq(
      await cont.isDisabled(),
      true,
      "Continue waits for a usable Zelle handle",
    );
    await handle.fill("bob@gmail.com");
    await page.locator("[data-cy='welcome-continue']:not([disabled])").waitFor({
      timeout: 5_000,
    });
  }));

/**
 * REQ-992 (LOOP-007 cycle 1, q1-74) — the tester's path: a customer's page →
 * More ▾ → Edit details → State "Texasssss", ZIP "ABCDE" → Save showed
 * "Customer saved" and the 📍 line read "…, Austin, Texasssss ABCDE". The
 * form must say what is wrong under State and ZIP, save nothing, and keep the
 * address as it was. (If State becomes a picker of US states, "Texasssss"
 * simply cannot be chosen — the story checks that instead of typing it.)
 */
Deno.test("REQ-992 q1-74: Edit details refuses State 'Texasssss' and ZIP 'ABCDE' with a message under each field; no 'Customer saved', the 📍 address unchanged", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const created = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Ana Barton",
        street: "1200 Barton Springs Rd",
        city: "Austin",
        state: "TX",
        zip: "78704",
      }),
    })).json();
    const before = "1200 Barton Springs Rd, Austin, TX 78704";
    expect.eq(created.address, before, "the seeded address");

    await page.goto(`/customers/${created.id}`);
    await page.locator("[data-cy='customer-workspace']").waitFor({
      timeout: 30_000,
    });
    const edit = page.locator("[data-cy='customer-form'][data-mode='edit']");
    await clickUntil(
      page,
      "[data-cy='cws-more']",
      async () => (await page.locator("[data-cy='cws-edit']").count()) > 0,
    );
    await clickUntil(
      page,
      "[data-cy='cws-edit']",
      async () => (await edit.count()) > 0,
    );

    const state = edit.locator("[data-cy='cf-state']");
    const zip = edit.locator("[data-cy='cf-zip']");
    const stateTag = await state.evaluate((el: Element) => el.tagName);
    if (stateTag === "SELECT") {
      const options = await state.locator("option").evaluateAll(
        (os: Element[]) => os.map((o) => (o as HTMLOptionElement).value),
      );
      expect(
        !options.includes("Texasssss"),
        `the State picker offers no "Texasssss" (${options.join(",")})`,
      );
    } else {
      await state.fill("Texasssss");
    }
    await zip.fill("ABCDE");
    await edit.locator("[data-cy='cf-save']").click();

    // the ZIP (and a typed State) are flagged, each with its own message
    await page.waitForFunction(
      () =>
        document.querySelector("[data-cy='cf-zip']")?.getAttribute(
          "aria-invalid",
        ) === "true",
      undefined,
      { timeout: 10_000 },
    ).catch(() => {});
    const msgUnder = (cy: string) =>
      page.evaluate((cy: string) => {
        const el = document.querySelector(`[data-cy='${cy}']`);
        if (!el) return { invalid: null, text: "" };
        const id = el.getAttribute("aria-describedby");
        const described = id ? document.getElementById(id)?.textContent : "";
        const inLabel = el.closest("label")?.querySelector("[role='alert']")
          ?.textContent;
        return {
          invalid: el.getAttribute("aria-invalid"),
          text: (described || inLabel || "").trim(),
        };
      }, cy);
    const z = await msgUnder("cf-zip");
    expect.eq(z.invalid, "true", "the ZIP field is flagged aria-invalid");
    expect(z.text.length > 0, `a message sits under ZIP ("${z.text}")`);
    if (stateTag !== "SELECT") {
      const s = await msgUnder("cf-state");
      expect.eq(s.invalid, "true", "the State field is flagged aria-invalid");
      expect(s.text.length > 0, `a message sits under State ("${s.text}")`);
    }

    expect.eq(await edit.count(), 1, "the edit form stays open");
    expect.eq(
      await page.locator("[data-cy='cws-toast']").filter({
        hasText: "Customer saved",
      }).count(),
      0,
      "no 'Customer saved' toast",
    );
    const got = await (await http(`/api/customers/${created.id}`, {
      headers: auth,
    })).json();
    expect.eq(got.address, before, "the stored address did not change");
    expect.eq(got.zip, "78704", "the stored ZIP did not change");
    const pin = await page.locator("[data-cy='customer-workspace']").evaluate(
      (el: Element) => el.textContent ?? "",
    );
    expect(
      !pin.includes("ABCDE") && !pin.includes("Texasssss"),
      "the 📍 line does not show the absurd address",
    );
  }));
