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

Deno.test("REQ-207: '742 ever' and 'inv-1' bring up invoice INV-001 for Zelda Ortiz, Enter opens it, 'C-001' brings up the customer and a click opens the roster", (t) =>
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
    expect.eq(
      new URL(page.url()).pathname,
      "/customers",
      "the row click opened the customers page",
    );
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
