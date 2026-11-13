/**
 * REQ-207 — the dashboard search box (front-end/islands/GlobalSearch.tsx in
 * DashTopbar): an address, a partial number and a customer number all find
 * the records; Enter opens the row's page; a row click does too.
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
    body: JSON.stringify({ language: "en", name: "Search Story" }),
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
      // the row is gone or not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

const INPUT = "[data-cy='global-search-input']";
const row = (type: string, number: string) =>
  `[data-cy='global-search-row'][data-type='${type}'][data-number='${number}']`;

/** type a query into the (hydrated) box, wait for the panel to answer THAT query, then read the row */
async function searchFor(
  page: StoryTools["page"],
  q: string,
  selector: string,
): Promise<string> {
  await page.locator(INPUT).waitFor({ timeout: 15_000 });
  await page.locator(INPUT).fill(q);
  const panel =
    `[data-cy='global-search-results'][data-state='ready'][data-q='${q}']`;
  await page.locator(panel).waitFor({ timeout: 15_000 });
  await page.locator(`${panel} ${selector}`).waitFor({ timeout: 15_000 });
  return await page.locator(`${panel} ${selector}`).innerText();
}

Deno.test("REQ-207 + REQ-799: '742 ever' and 'inv-1' bring up invoice INV-001 for Zelda Ortiz, Enter opens the invoice itself, 'C-001' brings up the customer and a click opens her sheet, a quote row opens the quote panel", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    // a new account's /dashboard lands on the /welcome wizard until every question is answered (REQ-091)
    await answerQuestions(http, auth, { name: "Search Story" });
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Zelda Ortiz",
        address: "742 Evergreen Terrace",
        email: "zelda@blackhole.postmarkapp.com",
      }),
    })).json();
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        jobName: "Roof repair",
        amount: 125000,
        issuedDate: "2026-10-14",
        dueDate: "2026-11-13",
      }),
    })).json();
    expect.eq(customer.number, "C-001", "the customer is C-001");
    expect.eq(inv.number, "INV-001", "the invoice is INV-001");

    await page.goto("/dashboard");

    // the address finds the invoice billed to that customer
    const byAddress = await searchFor(
      page,
      "742 ever",
      row("invoice", "INV-001"),
    );
    expect(
      byAddress.includes("Zelda Ortiz"),
      `the invoice row names the customer (${byAddress})`,
    );
    expect(byAddress.includes("INV-001"), "the invoice row shows its number");
    expect(
      byAddress.includes("$1,250.00"),
      `the invoice row shows the amount (${byAddress})`,
    );

    // a partial, dash-insensitive number finds the same row
    const byNumber = await searchFor(page, "inv-1", row("invoice", "INV-001"));
    expect(byNumber.includes("Zelda Ortiz"), "the same row by number");

    // Enter opens the highlighted (best) row: the invoice's page
    await page.keyboard.press("Enter");
    await page.waitForURL(
      (u) =>
        u.pathname === "/invoices" && u.searchParams.get("open") === inv.id,
      { timeout: 15_000 },
    );
    expect(
      page.url().includes(`/invoices?open=${inv.id}`),
      `Enter opened the invoice (${page.url()})`,
    );
    // REQ-799: the item itself — the invoice detail is open, not just the list
    await page.locator("[data-cy='invoice-detail']").waitFor({
      timeout: 15_000,
    });
    expect(
      (await page.locator("[data-cy='invoice-detail']").innerText()).includes(
        "Roof repair",
      ),
      "the invoice detail shows the job",
    );

    // the customer number brings up the customer row; a click goes to the roster
    await page.goto("/dashboard");
    const byCustomerNumber = await searchFor(
      page,
      "C-001",
      row("customer", "C-001"),
    );
    expect(
      byCustomerNumber.includes("Zelda Ortiz"),
      `the customer row names the customer (${byCustomerNumber})`,
    );
    expect(
      byCustomerNumber.includes("1 invoice"),
      `the customer row counts its documents (${byCustomerNumber})`,
    );
    await clickUntil(
      page,
      row("customer", "C-001"),
      () => Promise.resolve(new URL(page.url()).pathname === "/customers"),
    );
    // REQ-799: the customer herself — her sheet, not the bare roster
    expect.eq(
      new URL(page.url()).searchParams.get("open"),
      customer.id,
      `the row click opened the customer (${page.url()})`,
    );
    await page.locator("[data-cy='client-sheet']").waitFor({ timeout: 15_000 });
    expect(
      (await page.locator("[data-cy='client-sheet-name']").innerText())
        .includes("Zelda Ortiz"),
      "the client sheet names her",
    );

    // REQ-799: a quote row opens the quote's panel
    const quote = await (await http("/api/quotes", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        summary: "Gutter cleaning",
        lineItems: [
          {
            description: "Gutter cleaning",
            quantity: 1,
            unit: "ea",
            price: 30000,
          },
        ],
      }),
    })).json();
    await page.goto("/dashboard");
    await searchFor(page, "gutter", row("quote", quote.number));
    await clickUntil(
      page,
      row("quote", quote.number),
      () => Promise.resolve(new URL(page.url()).pathname === "/quotes"),
    );
    expect.eq(
      new URL(page.url()).searchParams.get("open"),
      quote.id,
      `the quote row opened the quote (${page.url()})`,
    );
    await page.locator("[data-cy='quote-panel-close']").waitFor({
      timeout: 15_000,
    });
  }));

Deno.test("REQ-519 (demo cycle 3, M33): the header search is accent-blind and word-by-word — 'maria' and 'maria pena' bring up María José Peña", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, { name: "Search Story" });
    for (const name of ["María José Peña", "Bob Smith"]) {
      const r = await http("/api/customers", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ name }),
      });
      await r.body?.cancel();
    }
    await page.goto("/dashboard");
    for (const q of ["maria", "maria pena"]) {
      const text = await searchFor(page, q, row("customer", "C-001"));
      expect(
        text.includes("María José Peña"),
        `"${q}" brings up María José Peña (${text})`,
      );
    }
  }));

Deno.test("REQ-799 phone: at 390px the topbar search is the Customers page's search — visible, it finds Zelda and opens her sheet", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, { name: "Search Story" });
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Zelda Ortiz",
        address: "742 Evergreen Terrace",
      }),
    })).json();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/customers");
    // no search box of the page's own; the topbar's is visible on the phone
    expect.eq(
      await page.locator("[data-cy='clients-search']").count(),
      0,
      "the page has no search box",
    );
    await page.locator(INPUT).waitFor({ timeout: 15_000 });
    const box = await page.locator(INPUT).boundingBox();
    expect(
      !!box && box.width > 200 && box.x >= 0 && box.x + box.width <= 390,
      `the topbar search is visible and fits the phone (${
        JSON.stringify(box)
      })`,
    );
    const lang = page.locator(".topbar__lang");
    const langBox = await lang.boundingBox();
    expect(
      !!box && !!langBox && langBox.y + langBox.height <= box.y + 1,
      `EN/ES sits above the search, never on it (${
        JSON.stringify(langBox)
      } vs ${JSON.stringify(box)})`,
    );
    await searchFor(page, "zelda", row("customer", customer.number));
    const rowBox = await page.locator(row("customer", customer.number))
      .boundingBox();
    expect(
      !!rowBox && rowBox.x >= 0 && rowBox.x + rowBox.width <= 390,
      `the result row fits the phone (${JSON.stringify(rowBox)})`,
    );
    await clickUntil(
      page,
      row("customer", customer.number),
      () =>
        Promise.resolve(
          new URL(page.url()).searchParams.get("open") === customer.id,
        ),
    );
    await page.locator("[data-cy='client-sheet-name']").waitFor({
      timeout: 15_000,
    });
    expect(
      (await page.locator("[data-cy='client-sheet-name']").innerText())
        .includes("Zelda Ortiz"),
      "the sheet names her",
    );
  }));
