/**
 * REQ-727 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issue c4-M16 (m56 in the merged
 * report): "Invoices go out at once: no preview, confirmation or channel
 * choice" — fleet-7 stdout:311 "/invoices > 'Finish + send →' sent at once
 * (no review/confirm step)".
 *
 * In a browser, on /invoices:
 *  (1) "Finish + send" on a draft opens the send sheet and sends nothing; the
 *      sheet names INV-00x and the client, starts "Sends in" on the invoice's
 *      own language (Español, in the English app), shows "What they'll get"
 *      (the Spanish subject, then the English one), and its Send dispatches
 *      ONLY the picked channel (Email) in the picked language.
 *  (2) "Send now" on a scheduled invoice: the sheet starts on the language
 *      the server resolves (the Settings default, Español); Cancel sends
 *      nothing and the invoice stays scheduled.
 *  (3) New invoice → "Issue invoice" creates it as a draft and opens the
 *      sheet; nothing goes out until Send, which sends it on both channels.
 *  (4) New invoice → "Issue invoice" → Cancel: the invoice is kept as a
 *      draft and the page says it was not sent.
 *
 * Pages: /invoices (front-end/islands/InvoicesPage.tsx +
 * components/InvoiceSendDialog.tsx → GET /invoices/:id/send-preview,
 * POST /invoices/:id/{email,text}).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 900_000) + 100_000);
/** a textable number: the exchange starts with 7, never a 555 test number */
const realPhone = () => `+15127${digits()}`;

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const phone = `+1512${digits()}1`;
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
  for (
    const [path, payload] of [
      ["/api/me", { language: "en", name: "Sheet Story" }],
      ["/api/profile/identity", { businessName: "Sheet Story Painting" }],
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
  return { auth };
}

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  url: string,
  body: unknown,
  method = "POST",
) {
  const r = await http(url, {
    method,
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

async function invoiceById(
  http: StoryTools["http"],
  auth: Record<string, string>,
  id: string,
): Promise<Record<string, unknown>> {
  return await (await http(`/api/invoices/${id}`, { headers: auth })).json();
}

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

/** every POST /api/invoices/<id>/email|text the page makes, with its body */
function watchSends(page: StoryTools["page"]) {
  const sends: { channel: string; body: string }[] = [];
  page.on(
    "request",
    (r: { url(): string; method(): string; postData(): string | null }) => {
      const m = new URL(r.url()).pathname.match(
        /^\/api\/invoices\/[^/]+\/(email|text)$/,
      );
      if (m && r.method() === "POST") {
        sends.push({ channel: m[1], body: r.postData() ?? "" });
      }
    },
  );
  return sends;
}

/** an island may still be hydrating when its target appears: click until the effect shows */
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

function card(page: StoryTools["page"], text: string) {
  return page.locator("article.qcard", { hasText: text }).first();
}

const sheet = (page: StoryTools["page"]) =>
  page.locator("[data-cy='send-dialog']");

Deno.test("REQ-727 c4-M16: 'Finish + send' opens the send sheet — nothing goes out until Send; it names the invoice and client, starts on the invoice's language, previews what they'll get, and sends only the picked channel in the picked language", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await post(http, auth, "/api/customers", {
      name: "Lucía Romero",
      email: "lr@blackhole.postmarkapp.com",
      phoneNumber: realPhone(),
    });
    const job = `Pintura del portón ${digits()}`;
    const inv = await post(http, auth, "/api/invoices", {
      customerId: customer.id,
      jobName: job,
      amount: 72500,
      status: "draft",
      netDays: 15,
      dueDate: inDays(30),
    });
    // a Spanish-typed invoice (REQ-497 records the language it was typed in)
    await post(http, auth, `/api/invoices/${inv.id}`, { lang: "es" }, "PUT");
    const sends = watchSends(page);

    await page.goto("/invoices");
    const cta =
      `article.qcard:has-text("${job}") [data-cy='invoice-cta-drafting']`;
    await page.locator(cta).waitFor({ timeout: 15_000 });
    await clickUntil(page, cta, async () => await sheet(page).isVisible());

    expect(await sheet(page).isVisible(), "the send sheet opened");
    await page.waitForTimeout(800);
    expect.eq(sends.length, 0, "pressing Finish + send sent nothing");
    expect.eq(
      (await invoiceById(http, auth, inv.id)).status,
      "draft",
      "still a draft while the sheet is open",
    );
    expect.eq(
      (await sheet(page).locator("h4").innerText()).trim(),
      `How do you want to send ${inv.number} to Lucía Romero?`,
      "the sheet names the invoice and the client",
    );
    await page.locator("[data-cy='send-lang-es'][aria-pressed='true']")
      .waitFor({ timeout: 10_000 });
    expect(
      true,
      "'Sends in' starts on Español — the invoice's language, not the app's",
    );

    await page.locator("[data-cy='send-option-email']").click();
    await page.locator("[data-cy='send-preview'] > summary").click();
    const subject = page.locator("[data-cy='send-preview-subject']");
    await subject.waitFor({ timeout: 15_000 });
    expect(
      (await subject.innerText()).startsWith(`Factura ${inv.number}`),
      `the Spanish email's subject (${await subject.innerText()})`,
    );
    expect.eq(
      await page.locator("[data-cy='send-preview-sms']").count(),
      0,
      "Email only previews no text message",
    );

    await page.locator("[data-cy='send-lang-en']").click();
    await page.waitForFunction(
      (n: string) =>
        (document.querySelector("[data-cy='send-preview-subject']")
          ?.textContent ?? "").startsWith(`Invoice ${n}`),
      inv.number,
      { timeout: 15_000 },
    );
    expect(true, "switching to English previews the English email");
    await page.locator("[data-cy='send-lang-es']").click();

    await page.locator("[data-cy='send-keep']").click();
    const moved = await card(page, job).locator("[data-cy='invoice-cta-out']")
      .waitFor({ timeout: 20_000 }).then(() => true, () => false);
    expect(moved, "after Send the invoice moves to Sent");
    await page.locator("[data-cy='invoice-sent']").waitFor({ timeout: 5_000 });
    expect.eq(
      sends.map((s) => s.channel).join(","),
      "email",
      "only the picked channel went out",
    );
    expect(
      JSON.parse(sends[0]?.body || "{}").language === "es",
      `…in the picked language (${sends[0]?.body})`,
    );
    expect.eq(
      (await invoiceById(http, auth, inv.id)).status,
      "sent",
      "the delivery issued it",
    );
  }));

Deno.test("REQ-727 c4-M16: 'Send now' on a scheduled invoice opens the sheet in the language the server resolves; Cancel sends nothing and it stays scheduled", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    // the Settings default: Spanish (the invoice itself names no language)
    await post(
      http,
      auth,
      "/api/profile/identity",
      { commsLanguage: "es" },
      "PUT",
    );
    const customer = await post(http, auth, "/api/customers", {
      name: "Dewey Harlan",
      email: "dh@blackhole.postmarkapp.com",
    });
    const inv = await post(http, auth, "/api/invoices", {
      customerId: customer.id,
      amount: 40000,
      status: "scheduled",
      scheduledFor: inDays(7),
      dueDate: inDays(37),
      netDays: 30,
    });
    const sends = watchSends(page);

    await page.goto("/invoices");
    const cta =
      `article.qcard:has-text("Dewey Harlan") [data-cy='invoice-cta-scheduled']`;
    await page.locator(cta).waitFor({ timeout: 15_000 });
    await clickUntil(page, cta, async () => await sheet(page).isVisible());
    expect(await sheet(page).isVisible(), "Send now opens the send sheet");
    expect.eq(
      await page.locator("[data-cy='send-option-email']").getAttribute(
        "aria-checked",
      ),
      "true",
      "an email-only client starts on Email",
    );
    await page.locator("[data-cy='send-lang-es'][aria-pressed='true']")
      .waitFor({ timeout: 10_000 });
    expect(true, "'Sends in' lands on Español — the server's default for it");

    await page.locator("[data-cy='send-cancel']").click();
    await sheet(page).waitFor({ state: "detached", timeout: 5_000 });
    await page.waitForTimeout(800);
    expect.eq(sends.length, 0, "Cancel sent nothing");
    const after = await invoiceById(http, auth, inv.id);
    expect.eq(after.status, "scheduled", "still scheduled");
    expect.eq(after.dueDate, inDays(37), "its dates untouched");
    expect.eq(
      await page.locator(cta).count(),
      1,
      "the card is still in Upcoming",
    );
  }));

async function issueFromForm(
  page: StoryTools["page"],
  customerId: string,
  job: string,
) {
  await page.goto("/invoices?new=1");
  const select = page.locator("[data-cy='new-invoice-client']");
  await select.waitFor({ timeout: 15_000 });
  await page.waitForLoadState("networkidle").catch(() => {});
  await select.selectOption(customerId);
  await page.waitForFunction(() =>
    ((document.querySelector("[data-cy='new-invoice-bill-email']") as
      | HTMLInputElement
      | null)?.value ?? "").length > 0
  );
  await page.locator("[data-cy='new-invoice-jobname']").fill(job);
  await page.locator("[data-cy='new-invoice-amount']").fill("320");
  await page.locator("[data-cy='new-invoice-submit']").click();
  await sheet(page).waitFor({ timeout: 20_000 });
}

Deno.test("REQ-727 c4-M16: 'Issue invoice' creates the invoice as a draft and opens the send sheet; only its Send sends it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await post(http, auth, "/api/customers", {
      name: "Marisol Ortega",
      email: "mo@blackhole.postmarkapp.com",
      phoneNumber: realPhone(),
    });
    const job = `Window washing ${digits()}`;
    const sends = watchSends(page);

    await issueFromForm(page, customer.id, job);
    await page.waitForTimeout(800);
    expect.eq(sends.length, 0, "Issue invoice sent nothing by itself");
    const list = await (await http("/api/invoices", { headers: auth }))
      .json() as Array<Record<string, unknown>>;
    expect.eq(list.length, 1, "the invoice was created");
    expect.eq(list[0].status, "draft", "…as a draft, until the sheet sends it");
    expect(
      (await sheet(page).locator("h4").innerText()).includes(
        String(list[0].number),
      ),
      "the sheet names the new invoice",
    );
    expect.eq(
      await page.locator("[data-cy='send-option-both']").getAttribute(
        "aria-checked",
      ),
      "true",
      "email + phone on file → Text + Email",
    );

    await page.locator("[data-cy='send-keep']").click();
    await page.locator("[data-cy='invoice-card-headline']").first().waitFor({
      timeout: 20_000,
    });
    expect.eq(
      sends.map((s) => s.channel).sort().join(","),
      "email,text",
      "Send went out on both channels",
    );
    expect.eq(
      (await invoiceById(http, auth, String(list[0].id))).status,
      "sent",
      "the invoice is sent",
    );
  }));

Deno.test("REQ-727 c4-M16: 'Issue invoice' → Cancel keeps the invoice as a draft and says it was not sent", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await post(http, auth, "/api/customers", {
      name: "Tomás Vega",
      email: "tv@blackhole.postmarkapp.com",
    });
    const job = `Deck stain ${digits()}`;
    const sends = watchSends(page);

    await issueFromForm(page, customer.id, job);
    await page.locator("[data-cy='send-cancel']").click();
    const note = page.locator("[data-cy='invoice-not-sent']");
    await note.waitFor({ timeout: 20_000 });
    const text = await note.innerText();
    expect(
      /INV-\d+ saved as a draft — not sent/.test(text),
      `the page says it was kept as a draft (${text})`,
    );
    expect.eq(sends.length, 0, "nothing was sent");
    const list = await (await http("/api/invoices", { headers: auth }))
      .json() as Array<Record<string, unknown>>;
    expect.eq(list.length, 1, "one invoice");
    expect.eq(list[0].status, "draft", "kept as a draft");
    expect.eq(
      await card(page, job).locator("[data-cy='invoice-cta-drafting']")
        .count(),
      1,
      "it waits in Drafting with Finish + send",
    );
  }));

/**
 * REQ-776 — Raphael: "Finish and send should have a review step." Demo-loop
 * cycle dv1, issue d3: "Finish + send" opens a review of what is about to
 * go out — the amount, the line items, who it goes to, the channel(s) and
 * the due date — with Cancel and Send. Cancel sends nothing and keeps the
 * draft; Finish + send again → Send sends it. In Spanish too
 * ("Terminar + enviar").
 */
Deno.test("REQ-776 dv1-d3: 'Finish + send' reviews the amount, line items, recipient, channels and due date; Cancel sends nothing, Send sends it — in English and Spanish", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await post(http, auth, "/api/customers", {
      name: "Marta Díaz",
      email: "md@blackhole.postmarkapp.com",
      phoneNumber: realPhone(),
    });
    const job = `Review gate ${digits()}`;
    const inv = await post(http, auth, "/api/invoices", {
      customerId: customer.id,
      jobName: job,
      amount: 72500,
      status: "draft",
      netDays: 15,
      lineItems: [
        { description: "Paint gate", quantity: 2, unit: "ea", price: 30000 },
        { description: "Primer", quantity: 1, unit: "ea", price: 12500 },
      ],
    });
    const sends = watchSends(page);
    const due = new Date(`${inDays(15)}T00:00:00Z`).toLocaleDateString(
      "en-US",
      { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" },
    );

    await page.goto("/invoices");
    const cta =
      `article.qcard:has-text("${job}") [data-cy='invoice-cta-drafting']`;
    await page.locator(cta).waitFor({ timeout: 15_000 });
    expect.eq(
      (await page.locator(cta).innerText()).replace(/\s+/g, " ").trim()
        .replace(/\s*→$/, ""),
      "Finish + send",
      "the draft's CTA",
    );
    await clickUntil(page, cta, async () => await sheet(page).isVisible());
    const review = sheet(page).locator("[data-cy='send-review']");
    await review.waitFor({ timeout: 10_000 });
    const txt = async (cy: string) =>
      (await sheet(page).locator(`[data-cy='${cy}']`).innerText()).replace(
        /\s+/g,
        " ",
      );
    expect((await txt("send-review-amount")).includes("$725.00"), "amount");
    const lines = sheet(page).locator("[data-cy='send-review-line']");
    expect.eq(await lines.count(), 2, "both line items");
    expect(
      (await lines.nth(0).innerText()).includes("Paint gate"),
      "line 1 named",
    );
    const to = await txt("send-review-to");
    expect(
      to.includes("Marta Díaz") && to.includes("md@blackhole.postmarkapp.com"),
      `recipient (${to})`,
    );
    expect(
      (await txt("send-review-due")).includes(due),
      `due date ${due} (${await txt("send-review-due")})`,
    );
    expect.eq(
      await sheet(page).locator(
        "[data-cy^='send-option-'][aria-checked='true']",
      ).count(),
      1,
      "a channel is picked",
    );

    // Cancel → nothing sent, still a draft
    await sheet(page).locator("[data-cy='send-cancel']").click();
    await sheet(page).waitFor({ state: "hidden", timeout: 5_000 });
    await page.waitForTimeout(800);
    expect.eq(sends.length, 0, "Cancel sent nothing");
    expect.eq(
      (await invoiceById(http, auth, inv.id)).status,
      "draft",
      "Cancel keeps the draft",
    );

    // Spanish: "Terminar + enviar" opens the same review, in Spanish
    await post(http, auth, "/api/me", { language: "es" }, "PUT");
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies(
      [...hosts].map((domain) => ({
        name: "pm_lang",
        value: "es",
        domain,
        path: "/",
      })),
    );
    await page.goto("/invoices");
    await page.locator(cta).waitFor({ timeout: 15_000 });
    expect(
      (await page.locator(cta).innerText()).includes("Terminar + enviar"),
      "the Spanish CTA",
    );
    await clickUntil(page, cta, async () => await sheet(page).isVisible());
    await review.waitFor({ timeout: 10_000 });
    expect((await txt("send-review-amount")).includes("Monto"), "Monto");
    expect((await txt("send-review-to")).includes("Para"), "Para");
    expect((await txt("send-review-due")).includes("Vence"), "Vence");
    await page.waitForTimeout(500);
    expect.eq(sends.length, 0, "opening the review sent nothing");

    // Send → sent
    await sheet(page).locator("[data-cy='send-keep']").click();
    const moved = await card(page, job).locator("[data-cy='invoice-cta-out']")
      .waitFor({ timeout: 20_000 }).then(() => true, () => false);
    expect(moved, "after Send the invoice moves to Sent");
    expect(sends.length > 0, "Send dispatched it");
    expect.eq(
      (await invoiceById(http, auth, inv.id)).status,
      "sent",
      "the delivery issued it",
    );
  }));
