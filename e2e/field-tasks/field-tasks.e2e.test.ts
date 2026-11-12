/**
 * REQ-143 — the field pages on the real shell, end to end: a worker is added on
 * /field/workers, a subscription on one of the account's EXISTING customers on
 * /field/subscriptions, its zone is staffed on /field/assignments, the day's
 * task shows on /field/tasks, the worker checks it off on /worker (cell + PIN,
 * its own cookie), and /field/batches pulls it into ONE draft invoice — an
 * invoice of the existing invoices feature (REQ-137/142), read back from
 * GET /api/invoices with its amount and the line "date — type — address".
 */
import { story, type StoryTools } from "#shots";

/** REQ-152 — the customer field is a search box: type the name, click the match */
async function pickCustomer(page: StoryTools["page"], name: string) {
  const box = page.locator(
    "[data-cy='subs-customer'] [data-cy='search-select-input']",
  );
  await box.waitFor({ timeout: 15_000 });
  await box.fill(name);
  await page.locator(
    "[data-cy='subs-customer'] [data-cy='search-select-option']",
  )
    .filter({ hasText: name }).first().click();
}

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
    body: JSON.stringify({ language: "en", name: "Field Story" }),
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

/** the company's day — the backend's FIELD_TZ default (America/New_York) */
const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

Deno.test("REQ-143: worker → subscription on an existing customer → staffed zone → today's task → the worker checks it off → one draft invoice pulled, in the existing invoices", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    // the customer is the EXISTING resource — created through its own API, untouched by the field module
    const c = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Ana Torres",
        email: "ana.torres@blackhole.postmarkapp.com",
      }),
    });
    expect(
      c.status === 201 || c.status === 200,
      `customer created (${c.status})`,
    );
    const customer = await c.json();
    const cell = `843555${String(Math.floor(Math.random() * 9000) + 1000)}`;

    // 1. a worker, on /field/workers
    await page.goto("/field/workers");
    // REQ-155 — the language picker reads Spanish by default
    expect.eq(
      await page.locator("[data-cy='wk-language']").inputValue(),
      "es",
      "the picker is Spanish by default",
    );
    await page.locator("[data-cy='wk-name']").fill("Luis Herrera");
    await page.locator("[data-cy='wk-phone']").fill(cell);
    await page.locator("[data-cy='wk-pin']").fill("1234");
    await page.locator("[data-cy='wk-add']").click();
    await page.locator("[data-cy='wk-row']").first().waitFor({
      timeout: 15_000,
    });
    await expect.see("Luis Herrera");
    // REQ-151 — the page says the worker was texted the sign-in link and their PIN
    await expect.see(
      "We texted Luis Herrera the sign-in link and their PIN.",
    );
    // REQ-155 — the row shows ES; the switch to EN sticks through a reload
    const row = page.locator("[data-cy='wk-row']").first();
    expect.eq(
      await row.locator("[data-cy='wk-row-lang']").getAttribute("data-lang"),
      "es",
      "Luis's row reads ES",
    );
    await row.locator("[data-cy='wk-row-lang'] button[data-set='en']").click();
    await page.waitForFunction(() =>
      document.querySelector("[data-cy='wk-row'] [data-cy='wk-row-lang']")
        ?.getAttribute("data-lang") === "en"
    );
    await page.reload();
    await page.locator("[data-cy='wk-row']").first().waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await page.locator("[data-cy='wk-row']").first().locator(
        "[data-cy='wk-row-lang']",
      ).getAttribute("data-lang"),
      "en",
      "the switch to EN stuck",
    );

    // 2. a subscription on the existing customer, on /field/subscriptions
    // REQ-174: the account's default days to pay, set in Settings, prefills the form
    const ident = await http("/api/profile/identity", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ invoiceNetDays: 21 }),
    });
    await ident.body?.cancel();
    await page.goto("/field/subscriptions");
    await page.locator("[data-cy='subs-new']").click();
    const netDays = page.locator("[data-cy='subs-net-days']");
    expect.eq(await netDays.inputValue(), "21", "days to pay defaults to the Settings number");
    await netDays.fill("14");
    await pickCustomer(page, "Ana Torres");
    await page.locator("[data-cy='subs-address']").fill(
      "4601 Dick Pond Rd, Myrtle Beach, SC",
    );
    await page.locator("[data-cy='subs-type-q']").fill("Lawn cut");
    await page.locator("[data-cy='subs-price']").fill("65");
    await page.locator("[data-cy='subs-add-item']").click();
    await page.locator("[data-cy='subs-submit']").click();
    await page.locator("[data-cy='subs-card']").first().waitFor({
      timeout: 20_000,
    });
    await expect.see("Ana Torres");
    await expect.see("$65.00");

    // 3. the zone exists and gets its worker, on /field/assignments
    await page.goto("/field/assignments");
    const region = page.locator("[data-cy='asg-region']").first();
    await region.waitFor({ timeout: 15_000 });
    const staff = region.locator("[data-cy='asg-region-worker']");
    await staff.locator("option", { hasText: "Luis Herrera" }).waitFor({
      state: "attached",
      timeout: 15_000,
    });
    await staff.selectOption({ label: "Luis Herrera" });
    await page.waitForTimeout(500);
    const regions = await (await http("/api/field/regions", { headers: auth }))
      .json();
    expect(
      regions.length === 1 && regions[0].worker?.name === "Luis Herrera",
      `the one zone is Luis's (${
        JSON.stringify(
          regions.map((r: { worker?: { name: string } }) => r.worker?.name),
        )
      })`,
    );

    // 4. today's round, on /field/tasks — the subscription starts today, so it is due today
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-task']").first().waitFor({
      timeout: 20_000,
    });
    await expect.see("Lawn cut");
    await expect.see("Ana Torres");

    // 5. the worker, on /worker — its own login, no owner session needed
    await page.context().clearCookies();
    await page.goto("/worker?lang=en");
    await page.locator("[data-cy='w-cell']").fill(cell);
    await page.locator("[data-cy='w-pin']").fill("1234");
    // REQ-150 — the eye shows the PIN, a second tap hides it, the PIN typed stays
    const pinField = page.locator("[data-cy='w-pin']");
    const eye = page.locator("[data-cy='w-pin-eye']");
    expect.eq(
      await pinField.getAttribute("type"),
      "password",
      "the PIN is hidden when the page opens",
    );
    expect.eq(
      await eye.getAttribute("aria-label"),
      "Show PIN",
      "the eye says Show PIN",
    );
    await eye.click();
    expect.eq(
      await pinField.getAttribute("type"),
      "text",
      "the eye shows the PIN",
    );
    expect.eq(
      await pinField.inputValue(),
      "1234",
      "the PIN typed stays through the toggle",
    );
    expect.eq(
      await eye.getAttribute("aria-label"),
      "Hide PIN",
      "the eye now says Hide PIN",
    );
    expect.eq(
      await eye.getAttribute("aria-pressed"),
      "true",
      "the eye reports pressed",
    );
    await eye.click();
    expect.eq(
      await pinField.getAttribute("type"),
      "password",
      "a second tap hides the PIN again",
    );
    await page.locator("[data-cy='w-login']").click();
    await page.locator("[data-cy='w-visit']").first().waitFor({
      timeout: 20_000,
    });
    await expect.see("Ana Torres");
    await expect.notSee("$65");
    await page.locator("[data-cy='w-check']").first().click();
    await expect.see("1 of 1 services done", { timeout: 15_000 });

    // 6. the batch, on /field/batches — one draft per customer, through the existing invoices
    const [name, value] = auth.cookie.split("=");
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
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
    const today = todayIso();
    await page.goto("/field/batches");
    await page.locator("[data-cy='lt-from']").fill(today);
    await page.locator("[data-cy='lt-to']").fill(today);
    await page.locator("[data-cy='lt-pull']").click();
    await page.locator("[data-cy='lt-invoice']").first().waitFor({
      timeout: 20_000,
    });
    await expect.see("Ana Torres");
    await expect.see("$65.00");

    // the invoice is a real one, in the existing invoices feature
    const invoices = await (await http("/api/invoices", { headers: auth }))
      .json();
    const inv = invoices.find((i: { customerId?: string }) =>
      i.customerId === customer.id
    );
    expect(!!inv, `one invoice for the customer (${invoices.length} invoices)`);
    expect.eq(inv.status, "draft", "the pulled invoice is a draft");
    // REQ-174: the draft carries the subscription's days to pay and is due that many days out
    const due = new Date(today + "T00:00:00Z");
    due.setUTCDate(due.getUTCDate() + 14);
    expect.eq(
      [inv.netDays, inv.dueDate].join("|"),
      [14, due.toISOString().slice(0, 10)].join("|"),
      "netDays 14 → due in 14 days",
    );
    expect.eq(inv.amount, 6500, "the draft totals the task's price");
    expect(
      /Lawn cut — 4601 Dick Pond Rd/.test(
        inv.lineItems?.[0]?.description ?? "",
      ),
      `the line reads "date — type — address" (${
        inv.lineItems?.[0]?.description
      })`,
    );
    expect.eq(
      invoices.length,
      1,
      "exactly one invoice — one draft per customer",
    );
    // REQ-173: the line is structured (date / service / address) for the grouped invoice
    expect.eq(
      [inv.lineItems?.[0]?.date, inv.lineItems?.[0]?.service].join("|"),
      [today, "Lawn cut"].join("|"),
      "the line carries its date and service",
    );

    // REQ-162: the batch's "Open invoice" opens THAT invoice, not the invoices list
    await page.locator("[data-cy='lt-open']").first().click();
    await page.waitForURL(/\/invoices\?open=/, { timeout: 15_000 });
    await expect.see("Invoice detail", { timeout: 15_000 });
    await expect.see("Ana Torres");
  }));

Deno.test("REQ-144: picking a customer with an address on file fills the service address; a typed address survives a re-pick", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const mk = async (name: string, address?: string) =>
      (await (await http("/api/customers", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          name,
          address,
          email: `${
            name.toLowerCase().replace(/\W+/g, ".")
          }@blackhole.postmarkapp.com`,
        }),
      })).json()).id as string;
    const ana = await mk("Ana Torres", "4601 Dick Pond Rd, Myrtle Beach, SC");
    const bob = await mk(
      "Bob Marshall",
      "6219 Forestbrook Rd, Myrtle Beach, SC",
    );
    const noAddr = await mk("Nadia Noaddress");
    await page.goto("/field/subscriptions");
    await page.locator("[data-cy='subs-new']").click();
    const address = page.locator("[data-cy='subs-address']");
    await pickCustomer(page, "Ana Torres");
    expect.eq(
      await address.inputValue(),
      "4601 Dick Pond Rd, Myrtle Beach, SC",
      "Ana's address fills the box",
    );
    await pickCustomer(page, "Bob Marshall");
    expect.eq(
      await address.inputValue(),
      "6219 Forestbrook Rd, Myrtle Beach, SC",
      "the next pick replaces the previous pick's address",
    );
    await pickCustomer(page, "Nadia Noaddress");
    expect.eq(
      await address.inputValue(),
      "6219 Forestbrook Rd, Myrtle Beach, SC",
      "a customer with no address leaves the box alone",
    );
    await address.fill("12 My Own St, Conway, SC");
    await pickCustomer(page, "Ana Torres");
    expect.eq(
      await address.inputValue(),
      "12 My Own St, Conway, SC",
      "a typed address survives a re-pick",
    );
  }));

Deno.test("REQ-145: Ana has two subscriptions and Bob one — Ana's card says 2 subscriptions and its panel lists both addresses with their prices; Bob's lists his one", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const mk = async (name: string) =>
      (await (await http("/api/customers", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          name,
          email: `${
            name.toLowerCase().replace(/\W+/g, ".")
          }@blackhole.postmarkapp.com`,
        }),
      })).json()).id as string;
    const ana = await mk("Ana Torres"), bob = await mk("Bob Marshall");
    const subscribe = async (
      customerId: string,
      address: string,
      items: [string, number][],
    ) => {
      const r = await http("/api/field/subscriptions", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          customerId,
          address,
          cadence: "weekly",
          intervalWeeks: 1,
          items: items.map(([taskTypeName, priceCents]) => ({
            taskTypeName,
            priceCents,
          })),
        }),
      });
      expect(r.status === 201, `subscription at ${address} (${r.status})`);
      await r.body?.cancel();
    };
    await subscribe(ana, "4601 Dick Pond Rd, Myrtle Beach, SC", [[
      "Lawn cut",
      6500,
    ]]);
    await subscribe(ana, "2201 River Oaks Dr, Myrtle Beach, SC", [[
      "Lawn cut",
      8000,
    ], ["Hedge trim", 4000]]);
    await subscribe(bob, "6219 Forestbrook Rd, Myrtle Beach, SC", [[
      "Lawn cut",
      7500,
    ]]);
    await page.goto("/customers");
    const anaCard = page.locator(".ccard2", { hasText: "Ana Torres" });
    await anaCard.locator("[data-cy='ccard2-subs-count']").waitFor({
      timeout: 20_000,
    });
    await expect.see("2 subscriptions");
    await anaCard.click();
    const anaRows = anaCard.locator("[data-cy='ccard2-sub']");
    await anaRows.first().waitFor({ timeout: 10_000 });
    expect.eq(await anaRows.count(), 2, "Ana's panel lists two subscriptions");
    await expect.see("4601 Dick Pond Rd");
    await expect.see("2201 River Oaks Dr");
    await expect.see("$120.00");
    await page.keyboard.press("Escape");
    const bobCard = page.locator(".ccard2", { hasText: "Bob Marshall" });
    await bobCard.click();
    const bobRows = bobCard.locator("[data-cy='ccard2-sub']");
    await bobRows.first().waitFor({ timeout: 10_000 });
    expect.eq(await bobRows.count(), 1, "Bob's panel lists his one");
    await expect.see("6219 Forestbrook Rd");
  }));

Deno.test("REQ-152: the customer field is a search box — typing narrows the list to the match with its address, the pick fills the address and a cleared box un-picks", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const mk = async (name: string, address?: string) => {
      const r = await http("/api/customers", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          name,
          address,
          email: `${
            name.toLowerCase().replace(/\W+/g, ".")
          }@blackhole.postmarkapp.com`,
        }),
      });
      await r.body?.cancel();
    };
    await mk("Ana Torres", "4601 Dick Pond Rd, Myrtle Beach, SC");
    await mk("Bob Marshall", "6219 Forestbrook Rd, Myrtle Beach, SC");
    await mk("Carla Ortiz");
    await page.goto("/field/subscriptions");
    await page.locator("[data-cy='subs-new']").click();
    const field = page.locator("[data-cy='subs-customer']");
    const box = field.locator("[data-cy='search-select-input']");
    const options = field.locator("[data-cy='search-select-option']");
    await box.waitFor({ timeout: 15_000 });
    expect.eq(
      await page.locator("select[name='customer']").count(),
      0,
      "no native customer drop-down",
    );
    await box.click();
    await options.first().waitFor({ timeout: 15_000 });
    expect.eq(await options.count(), 3, "the open list shows every customer");
    await box.fill("tor");
    await expect.see("Ana Torres");
    expect.eq(await options.count(), 1, "typing narrows the list to the match");
    await expect.see("4601 Dick Pond Rd, Myrtle Beach, SC");
    await box.press("Enter");
    const address = page.locator("[data-cy='subs-address']");
    expect.eq(
      await address.inputValue(),
      "4601 Dick Pond Rd, Myrtle Beach, SC",
      "the keyboard pick fills the address",
    );
    expect.eq(
      await box.inputValue(),
      "Ana Torres",
      "the pick's name sits in the box",
    );
    await field.locator("[data-cy='search-select-clear']").click();
    expect.eq(await box.inputValue(), "", "the box is cleared");
    await page.locator("[data-cy='subs-type-q']").fill("Lawn cut");
    await page.locator("[data-cy='subs-price']").fill("65");
    await page.locator("[data-cy='subs-add-item']").click();
    await page.locator("[data-cy='subs-submit']").click();
    await page.locator("[data-cy='subs-error']").waitFor({ timeout: 15_000 });
    expect.eq(
      await page.locator("[data-cy='subs-card']").count(),
      0,
      "nothing is saved without a picked customer",
    );
  }));

Deno.test("REQ-157: Cadence offers weekly and monthly only; Monthly shows 31 clickable days with the first visit's day on and the short-month note; the saved card reads Monthly · days 15, 31", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const r = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Ana Torres",
        address: "4601 Dick Pond Rd, Myrtle Beach, SC",
        email: "ana.torres@blackhole.postmarkapp.com",
      }),
    });
    await r.body?.cancel();
    await page.goto("/field/subscriptions");
    await page.locator("[data-cy='subs-new']").click();
    await pickCustomer(page, "Ana Torres");
    const cadence = page.locator("[data-cy='subs-cadence']");
    expect.eq(
      (await cadence.locator("option").allTextContents()).join("|"),
      "Weekly|Monthly",
      "two cadences on a new subscription",
    );
    await page.locator("[data-cy='subs-days']").waitFor();
    await cadence.selectOption("monthly");
    expect.eq(
      await page.locator("[data-cy='subs-days']").count(),
      0,
      "the weekday chips are gone",
    );
    const cells = page.locator("[data-cy='subs-dom-day']");
    expect.eq(await cells.count(), 31, "a grid of 31 days");
    const todayDay = String(Number(todayIso().slice(8)));
    expect.eq(
      (await page.locator("[data-cy='subs-dom-day'].on").allTextContents())
        .join("|"),
      todayDay,
      "the first visit's day is on up front",
    );
    await expect.see("29, 30 and 31 fall on the last day in shorter months.");
    await page.locator(`[data-cy='subs-dom-day'][data-dom='${todayDay}']`)
      .click();
    await page.locator("[data-cy='subs-dom-day'][data-dom='15']").click();
    await page.locator("[data-cy='subs-dom-day'][data-dom='31']").click();
    expect.eq(
      (await page.locator("[data-cy='subs-dom-day'].on").allTextContents())
        .join("|"),
      "15|31",
      "the two picks are on",
    );
    await page.locator("[data-cy='subs-type-q']").fill("Lawn cut");
    await page.locator("[data-cy='subs-price']").fill("65");
    await page.locator("[data-cy='subs-add-item']").click();
    await page.locator("[data-cy='subs-submit']").click();
    await page.locator("[data-cy='subs-card']").first().waitFor({
      timeout: 20_000,
    });
    await expect.see("Monthly · days 15, 31");
  }));

Deno.test("REQ-159: the office clicks the circle on /field/tasks — the task reads Complete and the count says 1 of 1; a second click re-opens it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const post = async (path: string, body: unknown) => {
      const r = await http(path, { method: "POST", headers: auth, body: JSON.stringify(body) });
      return r.json();
    };
    const put = async (path: string, body: unknown) => {
      const r = await http(path, { method: "PUT", headers: auth, body: JSON.stringify(body) });
      await r.body?.cancel();
    };
    const customer = await post("/api/customers", { name: "Ana Torres", email: "ana.torres@blackhole.postmarkapp.com" });
    const worker = await post("/api/field/workers", { name: "Luis Herrera", phoneNumber: `843${digits()}`, pin: "1234" });
    const sub = await post("/api/field/subscriptions", {
      customerId: customer.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      startDate: todayIso(),
      items: [{ taskTypeName: "Lawn cut", priceCents: 6500 }],
    });
    await put(`/api/field/regions/${sub.region.id}/worker`, { workerId: worker.id });
    await page.goto("/field/tasks");
    const task = page.locator("[data-cy='tk-task']").first();
    await task.waitFor({ timeout: 15_000 });
    expect.eq(await task.getAttribute("data-status"), "assigned", "open to begin with");
    await task.locator("[data-cy='tk-done']").click();
    await page.locator("[data-cy='tk-task'][data-status='complete']").first().waitFor({ timeout: 15_000 });
    await expect.see("1 of 1 complete");
    await task.locator("[data-cy='tk-done']").click();
    await page.locator("[data-cy='tk-task'][data-status='assigned']").first().waitFor({ timeout: 15_000 });
    await expect.see("0 of 1 complete");
  }));

/** REQ-163..166 — the office's day: one staffed subscription due today; answers the api helpers and the seeded ids */
async function officeDay(tools: { page: StoryTools["page"]; http: StoryTools["http"]; baseUrl: string }, items = [{ taskTypeName: "Lawn cut", priceCents: 6500 }]) {
  const { page, http, baseUrl } = tools;
  const { auth } = await signIn(http, page, baseUrl);
  const post = async (path: string, body: unknown) => {
    const r = await http(path, { method: "POST", headers: auth, body: JSON.stringify(body) });
    return r.json();
  };
  const put = async (path: string, body: unknown) => {
    const r = await http(path, { method: "PUT", headers: auth, body: JSON.stringify(body) });
    await r.body?.cancel();
  };
  const customer = await post("/api/customers", { name: "Ana Torres", address: "4601 Dick Pond Rd, Myrtle Beach, SC", email: "ana.torres@blackhole.postmarkapp.com" });
  const worker = await post("/api/field/workers", { name: "Luis Herrera", phoneNumber: `843${digits()}`, pin: "1234" });
  const sub = await post("/api/field/subscriptions", { customerId: customer.id, address: "4601 Dick Pond Rd, Myrtle Beach, SC", startDate: todayIso(), items });
  await put(`/api/field/regions/${sub.region.id}/worker`, { workerId: worker.id });
  return { auth, post, put, customer, worker, sub };
}

Deno.test("REQ-163: Delete on the card, confirm inline — the card is gone and the day reads 0 of 0", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await officeDay({ page, http, baseUrl });
    await page.goto("/field/tasks");
    const task = page.locator("[data-cy='tk-task']").first();
    await task.waitFor({ timeout: 15_000 });
    await expect.see("0 of 1 complete");
    await task.locator("[data-cy='tk-delete']").click();
    await task.locator("[data-cy='tk-delete-confirm']").click();
    await page.locator("[data-cy='tk-task']").first().waitFor({ state: "detached", timeout: 15_000 });
    expect.eq(await page.locator("[data-cy='tk-task']").count(), 0, "the card is gone");
    await expect.see("0 of 0 complete");
  }));

Deno.test("REQ-164: Add task → customer, type, price, worker → the card shows on the day", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { worker } = await officeDay({ page, http, baseUrl });
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-task']").first().waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='tk-add']").click();
    const form = page.locator("[data-cy='tk-add-form']");
    await form.waitFor({ timeout: 15_000 });
    const box = form.locator("[data-cy='tk-customer'] [data-cy='search-select-input']");
    await box.fill("Ana");
    await form.locator("[data-cy='tk-customer'] [data-cy='search-select-option']").filter({ hasText: "Ana Torres" }).first().click();
    expect.eq(await form.locator("[data-cy='tk-add-address']").inputValue(), "4601 Dick Pond Rd, Myrtle Beach, SC", "the customer's address is filled in");
    await form.locator("[data-cy='tk-add-type']").fill("Mulch");
    await form.locator("[data-cy='tk-add-price']").fill("120");
    await form.locator("[data-cy='tk-add-worker']").selectOption(worker.id);
    await form.locator("[data-cy='tk-add-save']").click();
    await page.locator("[data-cy='tk-task'][data-oneoff='true']").first().waitFor({ timeout: 15_000 });
    expect.eq(await page.locator("[data-cy='tk-task']").count(), 2, "the round plus the one-off");
    await expect.see("Mulch");
    await expect.see("$120.00");
    await expect.see("0 of 2 complete");
  }));

Deno.test("REQ-283 (demo M38): Add task with no customer picked says so and sends nothing; a new name is added as a customer from the form and the task saves", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth, worker } = await officeDay({ page, http, baseUrl });
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST") posts.push(new URL(r.url()).pathname);
    });
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-task']").first().waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='tk-add']").click();
    const form = page.locator("[data-cy='tk-add-form']");
    await form.waitFor({ timeout: 15_000 });
    const box = form.locator("[data-cy='tk-customer'] [data-cy='search-select-input']");
    await box.fill("Jim Baker");
    await form.locator("[data-cy='tk-add-type']").fill("Mulch");
    await form.locator("[data-cy='tk-add-price']").fill("120");
    // 1. no customer picked — the form says which field, and no task is POSTed
    await form.locator("[data-cy='tk-add-save']").click();
    await expect.see("Pick a customer from the list, or add a new one.");
    expect.eq(await box.getAttribute("aria-invalid"), "true", "the customer box is marked invalid");
    expect.eq(posts.filter((p) => p.endsWith("/field/tasks")).length, 0, "no task POST");
    // 2. the box offers to add the typed name as a customer
    await box.click();
    const create = form.locator("[data-cy='tk-customer'] [data-cy='search-select-create']");
    await create.waitFor({ timeout: 15_000 });
    expect.eq((await create.textContent())?.trim(), '+ Add "Jim Baker" as a customer', "the create row");
    await create.click();
    await page.waitForFunction(() => document.querySelector("[data-cy='tk-customer'] input[name='customer']")?.getAttribute("value"));
    // 3. a new customer has no staffed zone — the form asks for the worker by name, not "Something went wrong"
    await form.locator("[data-cy='tk-add-save']").click();
    await expect.see("Pick a worker — this customer has no zone with one yet.");
    expect.eq(await form.locator("[data-cy='tk-add-worker']").getAttribute("aria-invalid"), "true", "the worker picker is marked invalid");
    await form.locator("[data-cy='tk-add-worker']").selectOption(worker.id);
    await form.locator("[data-cy='tk-add-save']").click();
    await page.locator("[data-cy='tk-task'][data-oneoff='true']").first().waitFor({ timeout: 15_000 });
    await expect.see("Jim Baker");
    const list = await http("/api/customers?q=Jim%20Baker", { headers: auth });
    const body = await list.json();
    expect((body.items ?? []).some((c: { name: string }) => c.name === "Jim Baker"), "Jim Baker is a customer now");
  }));

Deno.test("REQ-340 (demo M37): a new customer added from the form BEFORE the address is typed gets the task's address on file once the task saves", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth, worker } = await officeDay({ page, http, baseUrl });
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-task']").first().waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='tk-add']").click();
    const form = page.locator("[data-cy='tk-add-form']");
    await form.waitFor({ timeout: 15_000 });
    const box = form.locator("[data-cy='tk-customer'] [data-cy='search-select-input']");
    await box.fill("Dave Kowalski");
    const create = form.locator("[data-cy='tk-customer'] [data-cy='search-select-create']");
    await create.waitFor({ timeout: 15_000 });
    await create.click(); // the demo's order: the customer is made with no address…
    await page.waitForFunction(() => document.querySelector("[data-cy='tk-customer'] input[name='customer']")?.getAttribute("value"));
    await form.locator("[data-cy='tk-add-type']").fill("Gutter clean");
    await form.locator("[data-cy='tk-add-price']").fill("150");
    await form.locator("[data-cy='tk-add-worker']").selectOption(worker.id);
    await form.locator("[data-cy='tk-add-address']").fill("8807 Spicewood Springs Rd, Austin, TX"); // …and the address is typed after
    await form.locator("[data-cy='tk-add-save']").click();
    await page.locator("[data-cy='tk-task'][data-oneoff='true']").first().waitFor({ timeout: 15_000 });
    await expect.see("8807 Spicewood Springs Rd, Austin, TX");
    const list = await http("/api/customers?q=Dave%20Kowalski", { headers: auth });
    const body = await list.json();
    const dave = (body.items ?? []).find((c: { name: string }) => c.name === "Dave Kowalski");
    expect(!!dave, "Dave Kowalski is a customer");
    expect.eq(dave.address, "8807 Spicewood Springs Rd, Austin, TX", "the customer carries the task's address — not 'No address on file'");
  }));

Deno.test("REQ-415 (demo p11, cycle 2): a fence builder's Add-task Service box shows its own services as the example, not lawn care", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await officeDay({ page, http, baseUrl }, [{ taskTypeName: "Fence install", priceCents: 90000 }]);
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-task']").first().waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='tk-add']").click();
    const form = page.locator("[data-cy='tk-add-form']");
    await form.waitFor({ timeout: 15_000 });
    const type = form.locator("[data-cy='tk-add-type']");
    await page.waitForFunction(() => (document.querySelector("[data-cy='tk-add-type']")?.getAttribute("placeholder") ?? "").includes("Fence install"), undefined, { timeout: 15_000 });
    const ph = (await type.getAttribute("placeholder")) ?? "";
    expect(ph.includes("Fence install"), `the placeholder names the account's own service (got "${ph}")`);
    expect(!/lawn|mulch|pool/i.test(ph), `no lawn-care example for a fence builder (got "${ph}")`);
  }));

Deno.test("REQ-165: Add service on the card → Edging $25 → a second card in the same group", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await officeDay({ page, http, baseUrl });
    await page.goto("/field/tasks");
    const task = page.locator("[data-cy='tk-task']").first();
    await task.waitFor({ timeout: 15_000 });
    await task.locator("[data-cy='tk-add-service']").click();
    await task.locator("[data-cy='tk-service-type']").fill("Edging");
    await task.locator("[data-cy='tk-service-price']").fill("25");
    await task.locator("[data-cy='tk-service-save']").click();
    await page.locator("[data-cy='tk-task']").nth(1).waitFor({ timeout: 15_000 });
    expect.eq(await page.locator("[data-cy='tk-task']").count(), 2, "two services on the visit");
    expect.eq(await page.locator(".panel .tasks").count(), 1, "the same worker · zone group");
    await expect.see("Edging");
    await expect.see("$25.00");
  }));

Deno.test("REQ-166: the card's worker picker moves the task to the other worker's group", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { post } = await officeDay({ page, http, baseUrl });
    const other = await post("/api/field/workers", { name: "Marta Ríos", phoneNumber: `843${digits()}`, pin: "1234" });
    await page.goto("/field/tasks");
    const task = page.locator("[data-cy='tk-task']").first();
    await task.waitFor({ timeout: 15_000 });
    await expect.see("Luis Herrera · ");
    await task.locator("[data-cy='tk-worker']").selectOption(other.id);
    await page.locator("[data-cy='tk-task'][data-worker='" + other.id + "']").first().waitFor({ timeout: 15_000 });
    await expect.see("Marta Ríos · ");
    expect.eq(await page.locator(".panel__title").filter({ hasText: "Luis Herrera" }).count(), 0, "Luis's group is gone");
  }));

Deno.test("REQ-170: no Generate button; a week ahead shows its task on arrival; an unstaffed zone's subscription is listed", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { put, sub } = await officeDay({ page, http, baseUrl });
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-task']").first().waitFor({ timeout: 15_000 });
    expect.eq(await page.locator("[data-cy='tk-generate']").count(), 0, "no Generate button");
    const ahead = new Date(todayIso() + "T12:00:00Z");
    ahead.setUTCDate(ahead.getUTCDate() + 7);
    await page.locator("[data-cy='tk-date']").fill(ahead.toISOString().slice(0, 10));
    await page.locator("[data-cy='tk-task']").first().waitFor({ timeout: 15_000 });
    await expect.see("0 of 1 complete");
    await put(`/api/field/regions/${sub.region.id}/worker`, { workerId: null });
    await page.reload();
    await page.locator("[data-cy='tk-unstaffed']").first().waitFor({ timeout: 15_000 });
    await expect.see("Ana Torres");
  }));

Deno.test("REQ-284: the day's only task checked off — the summary reads Complete 1 · To do 0, never Assigned 0 (demo customers-payments-fieldops-m4)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await officeDay({ page, http, baseUrl });
    await page.goto("/field/tasks");
    const task = page.locator("[data-cy='tk-task']").first();
    await task.waitFor({ timeout: 15_000 });
    const summary = page.locator("[data-cy='tk-summary']");
    await expect.see("0 of 1 complete");
    const before = (await summary.innerText()).replace(/\s+/g, " "); // the chips are text-transform: uppercase
    expect.eq(/To do 1/i.test(before), true, `one to do before: ${before}`);
    await task.locator("[data-cy='tk-done']").click();
    await page.locator("[data-cy='tk-task'][data-status='complete']").first().waitFor({ timeout: 15_000 });
    await expect.see("1 of 1 complete");
    const text = (await summary.innerText()).replace(/\s+/g, " ");
    expect.eq(/Complete 1/i.test(text), true, `complete chip: ${text}`);
    expect.eq(/To do 0/i.test(text), true, `to-do chip: ${text}`);
    expect.eq(/Assigned/i.test(text), false, `no 'Assigned' counter: ${text}`);
  }));
