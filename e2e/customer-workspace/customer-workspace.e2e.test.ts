/**
 * REQ-924 — the customer workspace, on the real shell. "You can do everything in the customer tab":
 * the sidebar's Customers context lists the customers with what they owe (most overdue first); a row
 * opens her full page in the main screen with the money summary; Record payment there lowers what she
 * owes — on the page and in her sidebar row; the top bar keeps only the menu, the search and EN/ES,
 * and the search is scoped to Customers with her results first; a customer result opens that page.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function signIn(http: StoryTools["http"], page: StoryTools["page"], baseUrl: string) {
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
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Workspace Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
  return auth;
}

async function post(http: StoryTools["http"], auth: Record<string, string>, url: string, body: unknown) {
  const r = await http(url, { method: "POST", headers: auth, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

Deno.test("REQ-924: the Customers sidebar lists the customers with what they owe; a row opens her full page; Record payment lowers what she owes; the top-bar search is scoped and puts her first", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const tag = digits();
    const ana = await post(http, auth, "/api/customers", { name: `Ana Workspace ${tag}`, phoneNumber: "(305) 555-0142" });
    const bob = await post(http, auth, "/api/customers", { name: `Bob Workspace ${tag}` });
    const inv = await post(http, auth, "/api/invoices", {
      customerId: ana.id,
      jobName: "Roof repair — north slope",
      amount: 50000,
      status: "sent",
      issuedDate: inDays(-40),
      dueDate: inDays(-10),
    });

    // (1) /customers rests on the Customers context: All customers active, Ana first with "$500 overdue"
    await page.goto("/customers");
    const nav = page.locator(".sb__nav");
    await nav.locator("[data-cy='nav-customer-row']").first().waitFor({ timeout: 20_000 });
    expect.eq(await nav.locator("a.nav-item--active[data-cy='nav-customers-all']").count(), 1, "All customers is the open page");
    expect.eq(await nav.locator("[data-cy='nav-back']").count(), 1, "Back to the root menu");
    expect.eq(await page.locator(".sb input").count(), 0, "no search box in the sidebar");
    const first = nav.locator("[data-cy='nav-customer-row']").first();
    expect.eq(await first.getAttribute("data-id"), ana.id, "the overdue customer is first");
    expect.eq(await first.getAttribute("data-tone"), "late", "her row is the overdue tone");
    expect.eq((await first.locator("[data-cy='nav-customer-line']").textContent())?.trim(), "$500 overdue", "her status line");
    const bobRow = nav.locator(`[data-cy='nav-customer-row'][data-id='${bob.id}']`);
    expect.eq((await bobRow.locator("[data-cy='nav-customer-line']").textContent())?.trim(), "Paid up", "his status line");

    // (2) her row opens her full page in the main screen; the top bar is menu + search + EN/ES
    await first.click();
    await page.waitForURL((u) => u.pathname === `/customers/${ana.id}`, { timeout: 20_000 });
    const ws = page.locator(`[data-cy='customer-workspace'][data-customer='${ana.id}']`);
    await ws.waitFor({ timeout: 20_000 });
    expect.eq((await page.locator("[data-cy='cws-name']").textContent())?.trim(), ana.name, "her name heads the page");
    expect.eq((await page.locator("[data-cy='cws-owed-amount']").textContent())?.trim(), "$500.00", "they owe you $500");
    expect((await page.locator("[data-cy='cws-owed']").textContent())?.includes("$500.00 overdue"), "the overdue part is said");
    expect.eq(await page.locator(`[data-cy='cws-unpaid'] [data-cy='cws-invoice-row'][data-id='${inv.id}']`).count(), 1, "the unpaid invoice is listed");
    expect.eq(await nav.locator(`a.nav-item--active[data-id='${ana.id}']`).count(), 1, "her row is the active one");
    expect.eq(await page.locator("[data-cy='topbar-greeting']").count(), 0, "no greeting in the top bar");
    expect.eq(await page.locator(".topbar__ticker").count(), 0, "no activity ticker");
    expect.eq(await page.locator("[data-cy='mobile-menu']").count(), 1, "the menu button stays");
    expect.eq(await page.locator("[data-cy='topbar-lang-en']").count(), 1, "EN/ES stays");
    for (const tab of ["overview", "invoices", "quotes", "payments", "recurring", "jobs", "messages"]) {
      expect.eq(await page.locator(`[data-cy='cws-tab-${tab}']`).count(), 1, `the ${tab} tab`);
    }

    // (3) Record payment on her page → the page and her sidebar row say paid up
    await page.locator("[data-cy='cws-record-payment']").click();
    const sheet = page.locator("[data-cy='cws-payment-sheet']");
    await sheet.locator("[data-cy='pay-received-form']").waitFor({ timeout: 15_000 });
    expect.eq(await sheet.locator("[data-cy='cws-payment-invoice']").inputValue(), inv.id, "the open invoice is picked");
    await sheet.locator("[data-cy='pay-method-zelle']").click();
    const saved = page.waitForResponse((r) => r.url().endsWith("/api/payments") && r.request().method() === "POST", { timeout: 15_000 });
    await sheet.locator("[data-cy='pay-received-submit']").click();
    const res = await saved;
    expect(res.ok(), `the payment is recorded (${res.status()})`);
    await page.waitForFunction(
      () => document.querySelector("[data-cy='cws-owed-amount']")?.textContent?.trim() === "All paid up",
      undefined,
      { timeout: 15_000 },
    );
    await page.waitForFunction(
      (id) => document.querySelector(`[data-cy='nav-customer-row'][data-id='${id}'] [data-cy='nav-customer-line']`)?.textContent?.trim() === "Paid up",
      ana.id,
      { timeout: 15_000 },
    );
    await page.locator("[data-cy='cws-tab-payments']").click();
    await page.locator("[data-cy='cws-payments'] tbody tr").first().waitFor({ timeout: 15_000 });
    expect((await page.locator("[data-cy='cws-payments']").textContent())?.includes("$500.00"), "the payment is in her Payments tab");

    // (4) the search: scoped to Customers, her results first; a customer result opens that page
    const input = page.locator("[data-cy='global-search-input']");
    await page.locator("[data-cy='global-search-scope']").waitFor({ timeout: 15_000 });
    await input.fill(`Workspace ${tag}`);
    const panel = `[data-cy='global-search-results'][data-state='ready'][data-q='Workspace ${tag}']`;
    await page.locator(panel).waitFor({ timeout: 15_000 });
    const groups = await page.locator(`${panel} .gsearch__group`).evaluateAll((els) => els.map((e) => e.getAttribute("data-cy")));
    expect.eq(groups[0], "global-search-group-mine", `her group comes first (got ${groups.join(", ")})`);
    expect((await page.locator(`${panel} [data-cy='global-search-group-mine']`).textContent())?.includes(`In ${ana.name}`), "headed with her name");
    const bobHit = page.locator(`${panel} [data-cy='global-search-row'][data-type='customer'][data-id='${bob.id}']`);
    expect.eq(await bobHit.getAttribute("data-url"), `/customers/${bob.id}`, "a customer result opens her page");
    await bobHit.click();
    await page.waitForURL((u) => u.pathname === `/customers/${bob.id}`, { timeout: 20_000 });
    await page.locator(`[data-cy='customer-workspace'][data-customer='${bob.id}']`).waitFor({ timeout: 20_000 });

    // (5) × searches everything again; Back returns the sidebar to the root menu
    await page.locator("[data-cy='global-search-scope-clear']").click();
    expect.eq(await page.locator("[data-cy='global-search-scope']").count(), 0, "the chip is gone");
    await nav.locator("[data-cy='nav-back']").click();
    await nav.locator("[data-cy='nav-folder-billing']").waitFor({ timeout: 15_000 });
    expect.eq(await nav.locator("a.nav-item[href='/customers']").count(), 1, "the root keeps its Customers link");

    // (6) another account's customer is "not found"
    const other = await signIn(http, page, baseUrl);
    void other;
    await page.goto(`/customers/${ana.id}`);
    await page.locator("[data-cy='cws-missing']").waitFor({ timeout: 20_000 });
  }));

Deno.test("REQ-924: Recurring on her page — the service with its price and next visits, a done visit not billed, Bill now sends her invoice, Pause and Resume", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const call = async (method: string, url: string, body?: unknown) => {
      const r = await http(url, { method, headers: auth, ...(body ? { body: JSON.stringify(body) } : {}) });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`${method} ${url} → ${r.status} ${JSON.stringify(json)}`);
      return json;
    };
    const today = new Date().toISOString().slice(0, 10);
    const ana = await call("POST", "/api/customers", { name: `Ana Gutters ${digits()}`, email: "ana.gutters@blackhole.postmarkapp.com" });
    const worker = await call("POST", "/api/field/workers", { name: "Luis Herrera", phoneNumber: `843${digits()}`, pin: "1234" });
    const sub = await call("POST", "/api/field/subscriptions", {
      customerId: ana.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      startDate: today,
      items: [{ taskTypeName: "Gutter cleaning", priceCents: 6500 }],
    });
    await call("PUT", `/api/field/regions/${sub.region.id}/worker`, { workerId: worker.id });
    const tasks = await call("GET", `/api/field/tasks?date=${today}`);
    expect.eq(tasks.length, 1, "today's visit");
    await call("PUT", `/api/field/tasks/${tasks[0].id}`, { status: "complete" });

    await page.goto(`/customers/${ana.id}?tab=recurring`);
    const card = page.locator(`[data-cy='cws-service'][data-id='${sub.id}']`);
    await card.waitFor({ timeout: 20_000 });
    expect((await card.textContent())?.includes("Gutter cleaning"), "the service is named");
    expect((await card.textContent())?.includes("$65.00"), "its price per visit");
    expect((await card.locator("[data-cy='cws-next-visit']").count()) > 0, "the next visits by the schedule");
    const unbilled = card.locator("[data-cy='cws-unbilled']");
    expect((await unbilled.textContent())?.includes("$65.00"), "the done visit is not billed yet");
    expect((await page.locator("[data-cy='cws-recurring']").textContent())?.includes("$65 not billed"), "the summary says so too");

    const sent = page.waitForResponse((r) => /\/api\/field\/batches\/[^/]+\/send$/.test(r.url()) && r.request().method() === "POST", { timeout: 20_000 });
    await card.locator("[data-cy='cws-bill-now']").click();
    const res = await sent;
    expect(res.ok(), `her draft is sent (${res.status()})`);
    await page.waitForFunction(
      () => document.querySelector("[data-cy='cws-owed-amount']")?.textContent?.trim() === "$65.00",
      undefined,
      { timeout: 20_000 },
    );
    expect.eq(await card.locator("[data-cy='cws-unbilled']").count(), 0, "nothing left to bill");
    expect.eq((await page.locator("[data-cy='cws-tab-invoices'] .cws-tab__n").textContent())?.trim(), "1", "her invoice is on her page");

    await card.locator("[data-cy='cws-service-toggle']").click();
    await page.waitForFunction(
      (id) => document.querySelector(`[data-cy='cws-service'][data-id='${id}']`)?.classList.contains("cws-svc--paused") === true,
      sub.id,
      { timeout: 15_000 },
    );
    expect.eq(await card.locator("[data-cy='cws-next-visit']").count(), 0, "a paused service has no next visits");
    await card.locator("[data-cy='cws-service-toggle']").click();
    await page.waitForFunction(
      (id) => document.querySelector(`[data-cy='cws-service'][data-id='${id}']`)?.classList.contains("cws-svc--paused") === false,
      sub.id,
      { timeout: 15_000 },
    );

    // Start recurring service opens the Repeat visits form with her chosen
    await page.locator("[data-cy='cws-more']").click();
    await page.locator("[data-cy='cws-start-service']").click();
    await page.waitForURL((u) => u.pathname === "/field/subscriptions" && u.searchParams.get("customerId") === ana.id, { timeout: 20_000 });
    await page.locator("[data-cy='subs-form']").waitFor({ timeout: 20_000 });
  }));
