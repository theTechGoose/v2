/**
 * REQ-708 (demo-loop cycle 5, demo c1-setup-m15) — "fix every issue the demo
 * found, loop until there are none". REQ-352 made the New customer modal say
 * what is wrong under each field, but the same customer fields in the New
 * invoice modal (Client → "+ New client") still relied on the browser's own
 * bubble — `required` name, type=email, no novalidate — which the demo stage
 * cannot show, so "bob@@gmail" left the presenter stuck with no message. The
 * public /contact form and the /field/workers Add form did the same.
 *
 * Pages: /invoices?new=1 (front-end/islands/InvoicesPage.tsx NewInvoiceModal),
 * /contact (islands/ContactForm.tsx), /field/workers (islands/FieldWorkersPage.tsx).
 */
import { story, type StoryTools } from "#shots";

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
    body: JSON.stringify({ language: "en", name: "Novalidate Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return { auth };
}

/** the in-app message an input names with aria-describedby, and whether it is flagged invalid */
async function fieldMessage(
  page: StoryTools["page"],
  selector: string,
) {
  const input = page.locator(selector);
  const invalid = await input.getAttribute("aria-invalid");
  const id = await input.getAttribute("aria-describedby");
  const text = id
    ? ((await page.locator(`[id='${id}']`).textContent()) ?? "")
    : "";
  return { invalid, text };
}

/** an island may still be hydrating: retry the action until the page shows the effect */
async function until(
  page: StoryTools["page"],
  act: () => Promise<void>,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await act();
    } catch { /* not ready yet */ }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error("the action never took");
}

Deno.test("REQ-708 c1-setup-m15: New invoice → + New client with 'bob@@gmail' says 'Enter a valid email address' under Email (novalidate, no native bubble); an empty name and a bad bill-to email are named under their fields; nothing is created", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await page.goto("/invoices?new=1");
    const modal = page.locator("[data-cy='new-invoice-modal']");
    await modal.waitFor({ timeout: 20_000 });
    const newName = "[data-cy='cf-name']";
    const newEmail = "[data-cy='cf-email']";
    await until(
      page,
      async () => {
        await page.locator("[data-cy='new-invoice-client']").selectOption(
          "__new__",
        );
      },
      async () => (await page.locator(newName).count()) > 0,
    );
    expect.eq(
      await modal.evaluate((f: HTMLFormElement) => f.noValidate),
      true,
      "the New invoice form is novalidate — no native bubble",
    );
    await page.locator("[data-cy='new-invoice-amount']").fill("250");

    // the demo's step: a name and "bob@@gmail", then Issue
    await page.locator(newName).fill("Bob");
    await page.locator(newEmail).fill("bob@@gmail");
    await page.locator("[data-cy='new-invoice-submit']").click();
    await expect.see("Enter a valid email address");
    const em = await fieldMessage(page, newEmail);
    expect.eq(em.invalid, "true", "the new client's email is flagged");
    expect(
      em.text.includes("Enter a valid email address"),
      `the message sits under the new client's Email (${em.text})`,
    );

    // an emptied name is named under the name, not in the footer
    await page.locator(newName).fill("");
    await page.locator(newEmail).fill("bob@gmail.com");
    await page.locator("[data-cy='new-invoice-submit']").click();
    await expect.see("Enter the customer's name");
    const nm = await fieldMessage(page, newName);
    expect.eq(nm.invalid, "true", "the new client's name is flagged");
    expect(
      nm.text.includes("Enter the customer's name"),
      `the message sits under Name (${nm.text})`,
    );

    // the bill-to email has the same rule
    await page.locator(newName).fill("Bob");
    await page.locator("[data-cy='new-invoice-bill-email']").fill("carl@");
    await page.locator("[data-cy='new-invoice-submit']").click();
    await page.waitForFunction(() =>
      document.querySelector("[data-cy='new-invoice-bill-email']")
        ?.getAttribute("aria-invalid") === "true"
    );
    const be = await fieldMessage(page, "[data-cy='new-invoice-bill-email']");
    expect(
      be.text.includes("Enter a valid email address"),
      `the message sits under the bill-to email (${be.text})`,
    );

    const customers = await (await http("/api/customers", { headers: auth }))
      .json();
    expect.eq(customers.length, 0, "no customer was created");
    const invoices = await (await http("/api/invoices", { headers: auth }))
      .json();
    expect.eq(invoices.length, 0, "no invoice was created");
  }));

Deno.test("REQ-708 c1-setup-m15: /contact names an empty Send and 'bob@@gmail' under their fields (novalidate), and posts nothing", (t) =>
  story(t, async ({ page, expect }) => {
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && /\/api\/contact$/.test(r.url())) {
        posts.push(r.url());
      }
    });
    await page.goto("/contact?lang=en");
    await expect.see("Get in touch");
    const form = page.locator("form").filter({
      has: page.locator("[data-cy='contact-email']"),
    });
    const send = form.locator("button[type='submit']");
    await until(
      page,
      async () => await send.click({ timeout: 2_000 }),
      async () =>
        (await page.locator("[data-cy='contact-name']").getAttribute(
          "aria-invalid",
        )) === "true",
    );
    expect.eq(
      await form.evaluate((f: HTMLFormElement) => f.noValidate),
      true,
      "the contact form is novalidate — no native bubble",
    );
    await page.locator("[data-cy='contact-name']").fill("Bob");
    await page.locator("[data-cy='contact-email']").fill("bob@@gmail");
    await page.locator("[data-cy='contact-subject']").fill("Hi");
    await page.locator("[data-cy='contact-message']").fill("Hello");
    await send.click();
    await expect.see("Enter a valid email address");
    const em = await fieldMessage(page, "[data-cy='contact-email']");
    expect.eq(em.invalid, "true", "the email is flagged");
    expect(
      em.text.includes("Enter a valid email address"),
      `the message sits under Email (${em.text})`,
    );
    expect.eq(posts.length, 0, "nothing was posted");
  }));

Deno.test("REQ-708 c1-setup-m15: /field/workers Add on an empty form names the name under its box (novalidate) instead of a native bubble", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.goto("/field/workers");
    const form = page.locator("[data-cy='wk-form']");
    await form.waitFor({ timeout: 20_000 });
    await page.getByText("No workers yet.").waitFor({ timeout: 20_000 });
    expect.eq(
      await form.evaluate((f: HTMLFormElement) => f.noValidate),
      true,
      "the Add worker form is novalidate — no native bubble",
    );
    await page.locator("[data-cy='wk-add']").click();
    await page.locator("[data-cy='wk-name-error']").waitFor({
      timeout: 10_000,
    });
    expect.eq(
      await page.locator("[data-cy='wk-name']").getAttribute("aria-invalid"),
      "true",
      "the name box is flagged",
    );
  }));
