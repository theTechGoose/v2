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
import { addVisitService, ensureService } from "../_shared/service-lines.ts"; // REQ-921

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
    // REQ-774 (demo dv1-d5) — on an English account the picker reads English by default;
    // Luis is set to Spanish on purpose
    expect.eq(
      await page.locator("[data-cy='wk-language']").inputValue(),
      "en",
      "the picker defaults to the account's English, not Spanish",
    );
    await page.locator("[data-cy='wk-language']").selectOption("es");
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
    const svc170 = await ensureService(http, auth, "Lawn cut"); // REQ-921: the catalogue has it
    await page.locator("[data-cy='subs-new']").click();
    const netDays = page.locator("[data-cy='subs-net-days']");
    // the form may open before Settings arrives; it then takes Settings' number (REQ-174)
    await page.waitForFunction(
      () =>
        (document.querySelector("[data-cy='subs-net-days']") as
          | HTMLInputElement
          | null)?.value === "21",
      undefined,
      { timeout: 10_000 },
    ).catch(() => {});
    expect.eq(
      await netDays.inputValue(),
      "21",
      "days to pay defaults to the Settings number",
    );
    await netDays.fill("14");
    await pickCustomer(page, "Ana Torres");
    await page.locator("[data-cy='subs-address']").fill(
      "4601 Dick Pond Rd, Myrtle Beach, SC",
    );
    await addVisitService(page, svc170, "65"); // REQ-921
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
    // REQ-527 (demo m55, cycle 3): one noun — the day summary counts tasks;
    // one task reads singular (worker.today.one, the c5 plural fix)
    await expect.see("1 of 1 task done", { timeout: 15_000 });
    await expect.notSee("services done");
    // REQ-196 — the ring is the progressbar, the card says Done, the summary says the round is complete
    expect.eq(
      await page.locator("[data-cy='w-progress']").getAttribute(
        "aria-valuenow",
      ),
      "1",
      "the ring reads 1",
    );
    expect.eq(
      (await page.locator("[data-cy='w-visit-state']").first().textContent())
        ?.trim(),
      "Done",
      "the visit's chip says Done",
    );
    await expect.see("Round complete! Nice work.");
    // REQ-194 — tomorrow and yesterday are one tap away and come back to today without a reload
    expect.eq(
      await page.locator("[data-cy='w-day-today']").getAttribute(
        "aria-selected",
      ),
      "true",
      "today is the selected day",
    );
    await page.locator("[data-cy='w-day-next']").click();
    await expect.see("No tasks this day.", { timeout: 15_000 });
    expect(
      await page.evaluate(() => location.search.includes("date=")),
      "tomorrow is in the URL",
    );
    await page.locator("[data-cy='w-day-prev']").click();
    await expect.see("No tasks this day.", { timeout: 15_000 });
    await page.locator("[data-cy='w-day-today']").click();
    await expect.see("Ana Torres", { timeout: 15_000 });
    expect(
      await page.evaluate(() => !location.search.includes("date=")),
      "today drops ?date=",
    );

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
    const card = page.locator("[data-cy='lt-invoice']").first();
    await card.waitFor({ timeout: 20_000 });
    // scoped to the card: the page's search box also knows the customer
    // (a hidden match that an unscoped text wait lands on first)
    await card.getByText("Ana Torres").first().waitFor({ timeout: 15_000 });
    await card.getByText("$65.00").first().waitFor({ timeout: 15_000 });

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

    // REQ-162/REQ-790: the batch's "Open invoice" opens THAT invoice as the
    // customer sees it — the public /i/<id> page in a new tab — never the
    // invoices list or its tab.
    const open = page.locator("[data-cy='lt-open']").first();
    await open.waitFor({ timeout: 15_000 });
    expect.eq(
      await open.getAttribute("href"),
      `/i/${inv.id}`,
      "the link is the customer-facing invoice page",
    );
    expect.eq(
      await open.getAttribute("target"),
      "_blank",
      "it opens in a new tab so the batch stays put",
    );
    const [popup] = await Promise.all([
      page.context().waitForEvent("page", { timeout: 15_000 }),
      open.click(),
    ]);
    await popup.waitForURL(new RegExp(`/i/${inv.id}$`), { timeout: 15_000 });
    // the public page is server-rendered: once its DOM is in, the invoice's
    // own line (the "Lawn cut" visit) is on it — no hydration to wait for.
    // (A batch invoice has no quote, so the public page carries no "Bill to"
    // card — the customer's name is not what identifies it here.)
    await popup.waitForLoadState("domcontentloaded", { timeout: 60_000 });
    await popup.getByText("Lawn cut").first().waitFor({ timeout: 15_000 });
    expect.eq(
      page.url().includes("/invoices"),
      false,
      "the batches page did not jump to the invoices tab",
    );
    await popup.close();
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
    await expect.see("2 repeat visits"); // REQ-743: was "2 subscriptions"
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
    const svc578 = await ensureService(http, auth, "Lawn cut"); // REQ-921: the catalogue has it
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
    await addVisitService(page, svc578, "65"); // REQ-921
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
    const svc639 = await ensureService(http, auth, "Lawn cut"); // REQ-921: the catalogue has it
    await page.locator("[data-cy='subs-new']").click();
    await pickCustomer(page, "Ana Torres");
    const cadence = page.locator("[data-cy='subs-cadence']");
    expect.eq(
      (await cadence.locator("option").allTextContents()).join("|"),
      "Weekly|Monthly|Annual",
      "weekly, monthly and (REQ-787) annual on a new subscription",
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
    await addVisitService(page, svc639, "65"); // REQ-921
    await page.locator("[data-cy='subs-submit']").click();
    await page.locator("[data-cy='subs-card']").first().waitFor({
      timeout: 20_000,
    });
    await expect.see("Monthly · days 15, 31");
  }));

Deno.test("REQ-1166 (LOOP-007 q3-97, REQ-157 amendment): New repeat visit, First visit typed on a later day, then Monthly — that day's chip is on, not today's, and the saved card and subscription carry it", (t) =>
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
    // the First visit: next month, on a day of the month that is not today's
    const today = todayIso();
    const todayDay = Number(today.slice(8));
    const firstDay = todayDay === 1 ? 2 : 1;
    const [y, m] = today.slice(0, 7).split("-").map(Number);
    const next = new Date(Date.UTC(y, m, firstDay)); // month m is next month (0-based)
    const first = next.toISOString().slice(0, 10);
    await page.goto("/field/subscriptions");
    const svc = await ensureService(http, auth, "Lawn mowing");
    await page.locator("[data-cy='subs-new']").click();
    await pickCustomer(page, "Ana Torres");
    await page.locator("[data-cy='subs-days']").waitFor();
    await page.locator("[data-cy='subs-start']").fill(first);
    await page.locator("[data-cy='subs-cadence']").selectOption("monthly");
    await page.locator("[data-cy='subs-dom-day']").first().waitFor();
    const onDays = await page.evaluate(() =>
      [...document.querySelectorAll("[data-cy='subs-dom-day'].on")].map((e) =>
        e.getAttribute("data-dom")
      ).join("|")
    );
    expect.eq(
      onDays,
      String(firstDay),
      `the typed First visit's day (${first}) is the one on, not today's (${todayDay})`,
    );
    await addVisitService(page, svc, "65");
    await page.locator("[data-cy='subs-submit']").click();
    await page.locator("[data-cy='subs-card']").first().waitFor({
      timeout: 20_000,
    });
    const card = await page.locator("[data-cy='subs-card']").first()
      .innerText();
    expect.eq(
      card.match(/Monthly · days? [\d, ]+/)?.[0]?.trim(),
      `Monthly · day ${firstDay}`,
      "the card reads the First visit's day",
    );
    const subs = await (await http("/api/field/subscriptions", {
      headers: auth,
    })).json();
    const list = Array.isArray(subs) ? subs : subs.items ?? subs.subscriptions;
    expect.eq(list.length, 1, "one subscription saved");
    expect.eq(list[0].startDate?.slice(0, 10), first, "its First visit");
    expect.eq(
      JSON.stringify(list[0].daysOfMonth ?? [firstDay]),
      JSON.stringify([firstDay]),
      "the saved monthly day is the First visit's",
    );
  }));

Deno.test("REQ-159: the office clicks the circle on /field/tasks — the task reads Complete and the count says 1 of 1; a second click re-opens it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const post = async (path: string, body: unknown) => {
      const r = await http(path, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(body),
      });
      return r.json();
    };
    const put = async (path: string, body: unknown) => {
      const r = await http(path, {
        method: "PUT",
        headers: auth,
        body: JSON.stringify(body),
      });
      await r.body?.cancel();
    };
    const customer = await post("/api/customers", {
      name: "Ana Torres",
      email: "ana.torres@blackhole.postmarkapp.com",
    });
    const worker = await post("/api/field/workers", {
      name: "Luis Herrera",
      phoneNumber: `843${digits()}`,
      pin: "1234",
    });
    const sub = await post("/api/field/subscriptions", {
      customerId: customer.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      startDate: todayIso(),
      items: [{ taskTypeName: "Lawn cut", priceCents: 6500 }],
    });
    await put(`/api/field/regions/${sub.region.id}/worker`, {
      workerId: worker.id,
    });
    await page.goto("/field/tasks");
    const task = page.locator("[data-cy='tk-task']").first();
    await task.waitFor({ timeout: 15_000 });
    expect.eq(
      await task.getAttribute("data-status"),
      "assigned",
      "open to begin with",
    );
    await task.locator("[data-cy='tk-done']").click();
    await page.locator("[data-cy='tk-task'][data-status='complete']").first()
      .waitFor({ timeout: 15_000 });
    await expect.see("1 of 1 complete");
    await task.locator("[data-cy='tk-done']").click();
    await page.locator("[data-cy='tk-task'][data-status='assigned']").first()
      .waitFor({ timeout: 15_000 });
    await expect.see("0 of 1 complete");
  }));

/** REQ-163..166 — the office's day: one staffed subscription due today; answers the api helpers and the seeded ids */
async function officeDay(
  tools: {
    page: StoryTools["page"];
    http: StoryTools["http"];
    baseUrl: string;
  },
  items = [{ taskTypeName: "Lawn cut", priceCents: 6500 }],
) {
  const { page, http, baseUrl } = tools;
  const { auth } = await signIn(http, page, baseUrl);
  const post = async (path: string, body: unknown) => {
    const r = await http(path, {
      method: "POST",
      headers: auth,
      body: JSON.stringify(body),
    });
    return r.json();
  };
  const put = async (path: string, body: unknown) => {
    const r = await http(path, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify(body),
    });
    await r.body?.cancel();
  };
  const customer = await post("/api/customers", {
    name: "Ana Torres",
    address: "4601 Dick Pond Rd, Myrtle Beach, SC",
    email: "ana.torres@blackhole.postmarkapp.com",
  });
  const worker = await post("/api/field/workers", {
    name: "Luis Herrera",
    phoneNumber: `843${digits()}`,
    pin: "1234",
  });
  const sub = await post("/api/field/subscriptions", {
    customerId: customer.id,
    address: "4601 Dick Pond Rd, Myrtle Beach, SC",
    startDate: todayIso(),
    items,
  });
  await put(`/api/field/regions/${sub.region.id}/worker`, {
    workerId: worker.id,
  });
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
    await page.locator("[data-cy='tk-task']").first().waitFor({
      state: "detached",
      timeout: 15_000,
    });
    expect.eq(
      await page.locator("[data-cy='tk-task']").count(),
      0,
      "the card is gone",
    );
    await expect.see("0 of 0 complete");
  }));

Deno.test("REQ-164: Add task → customer, type, price, worker → the card shows on the day", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { worker } = await officeDay({ page, http, baseUrl });
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-task']").first().waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='tk-add']").click();
    const form = page.locator("[data-cy='tk-add-form']");
    await form.waitFor({ timeout: 15_000 });
    const box = form.locator(
      "[data-cy='tk-customer'] [data-cy='search-select-input']",
    );
    await box.fill("Ana");
    await form.locator(
      "[data-cy='tk-customer'] [data-cy='search-select-option']",
    ).filter({ hasText: "Ana Torres" }).first().click();
    expect.eq(
      await form.locator("[data-cy='tk-add-address']").inputValue(),
      "4601 Dick Pond Rd, Myrtle Beach, SC",
      "the customer's address is filled in",
    );
    await form.locator("[data-cy='tk-add-type']").fill("Mulch");
    await form.locator("[data-cy='tk-add-price']").fill("120");
    await form.locator("[data-cy='tk-add-worker']").selectOption(worker.id);
    await form.locator("[data-cy='tk-add-save']").click();
    await page.locator("[data-cy='tk-task'][data-oneoff='true']").first()
      .waitFor({ timeout: 15_000 });
    expect.eq(
      await page.locator("[data-cy='tk-task']").count(),
      2,
      "the round plus the one-off",
    );
    await expect.see("Mulch");
    await expect.see("$120.00");
    await expect.see("0 of 2 complete");
  }));

Deno.test("REQ-526 (demo m50, cycle 3): Add task for another day → Save moves the list to that day, the card is there and the flash names the day", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { worker } = await officeDay({ page, http, baseUrl });
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-task']").first().waitFor({
      timeout: 15_000,
    });
    const later = new Date(todayIso() + "T12:00:00Z");
    later.setUTCDate(later.getUTCDate() + 5);
    const day = later.toISOString().slice(0, 10);
    await page.locator("[data-cy='tk-add']").click();
    const form = page.locator("[data-cy='tk-add-form']");
    await form.waitFor({ timeout: 15_000 });
    await form.locator(
      "[data-cy='tk-customer'] [data-cy='search-select-input']",
    ).fill("Ana");
    await form.locator(
      "[data-cy='tk-customer'] [data-cy='search-select-option']",
    ).filter({ hasText: "Ana Torres" }).first().click();
    await form.locator("[data-cy='tk-add-type']").fill("Mulch");
    await form.locator("[data-cy='tk-add-price']").fill("120");
    await form.locator("[data-cy='tk-add-worker']").selectOption(worker.id);
    await form.locator("[data-cy='tk-add-date']").fill(day);
    await form.locator("[data-cy='tk-add-save']").click();
    await form.waitFor({ state: "detached", timeout: 15_000 });
    await page.waitForFunction(
      (d) =>
        (document.querySelector("[data-cy='tk-date']") as
          | HTMLInputElement
          | null)?.value === d,
      day,
      { timeout: 15_000 },
    );
    await page.locator("[data-cy='tk-task'][data-oneoff='true']").first()
      .waitFor({ timeout: 15_000 });
    await expect.see("Mulch");
    const flash = (await page.locator("[data-cy='tk-flash']").innerText())
      .trim();
    const label = later.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    });
    expect(
      flash.toLowerCase().includes(label.toLowerCase()),
      `the flash names the task's day ${label} (got "${flash}")`,
    );
  }));

Deno.test("REQ-283 (demo M38): Add task with no customer picked says so and sends nothing; a new name is added as a customer from the form and the task saves", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth, worker } = await officeDay({ page, http, baseUrl });
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST") posts.push(new URL(r.url()).pathname);
    });
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-task']").first().waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='tk-add']").click();
    const form = page.locator("[data-cy='tk-add-form']");
    await form.waitFor({ timeout: 15_000 });
    const box = form.locator(
      "[data-cy='tk-customer'] [data-cy='search-select-input']",
    );
    await box.fill("Jim Baker");
    await form.locator("[data-cy='tk-add-type']").fill("Mulch");
    await form.locator("[data-cy='tk-add-price']").fill("120");
    // 1. no customer picked — the form says which field, and no task is POSTed
    await form.locator("[data-cy='tk-add-save']").click();
    await expect.see("Pick a customer from the list, or add a new one.");
    expect.eq(
      await box.getAttribute("aria-invalid"),
      "true",
      "the customer box is marked invalid",
    );
    expect.eq(
      posts.filter((p) => p.endsWith("/field/tasks")).length,
      0,
      "no task POST",
    );
    // 2. the box offers to add the typed name as a customer
    await box.click();
    const create = form.locator(
      "[data-cy='tk-customer'] [data-cy='search-select-create']",
    );
    await create.waitFor({ timeout: 15_000 });
    expect.eq(
      (await create.textContent())?.trim(),
      '+ Add "Jim Baker" as a customer',
      "the create row",
    );
    await create.click();
    await page.waitForFunction(() =>
      document.querySelector("[data-cy='tk-customer'] input[name='customer']")
        ?.getAttribute("value")
    );
    // 3. a new customer has no staffed zone — the form asks for the worker by name, not "Something went wrong"
    await form.locator("[data-cy='tk-add-save']").click();
    await expect.see("Pick a worker — this customer has no zone with one yet.");
    expect.eq(
      await form.locator("[data-cy='tk-add-worker']").getAttribute(
        "aria-invalid",
      ),
      "true",
      "the worker picker is marked invalid",
    );
    await form.locator("[data-cy='tk-add-worker']").selectOption(worker.id);
    await form.locator("[data-cy='tk-add-save']").click();
    await page.locator("[data-cy='tk-task'][data-oneoff='true']").first()
      .waitFor({ timeout: 15_000 });
    await expect.see("Jim Baker");
    const list = await http("/api/customers?q=Jim%20Baker", { headers: auth });
    const body = await list.json();
    expect(
      (body.items ?? []).some((c: { name: string }) => c.name === "Jim Baker"),
      "Jim Baker is a customer now",
    );
  }));

Deno.test("REQ-340 (demo M37): a new customer added from the form BEFORE the address is typed gets the task's address on file once the task saves", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth, worker } = await officeDay({ page, http, baseUrl });
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-task']").first().waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='tk-add']").click();
    const form = page.locator("[data-cy='tk-add-form']");
    await form.waitFor({ timeout: 15_000 });
    const box = form.locator(
      "[data-cy='tk-customer'] [data-cy='search-select-input']",
    );
    await box.fill("Dave Kowalski");
    const create = form.locator(
      "[data-cy='tk-customer'] [data-cy='search-select-create']",
    );
    await create.waitFor({ timeout: 15_000 });
    await create.click(); // the demo's order: the customer is made with no address…
    await page.waitForFunction(() =>
      document.querySelector("[data-cy='tk-customer'] input[name='customer']")
        ?.getAttribute("value")
    );
    await form.locator("[data-cy='tk-add-type']").fill("Gutter clean");
    await form.locator("[data-cy='tk-add-price']").fill("150");
    await form.locator("[data-cy='tk-add-worker']").selectOption(worker.id);
    await form.locator("[data-cy='tk-add-address']").fill(
      "8807 Spicewood Springs Rd, Austin, TX",
    ); // …and the address is typed after
    await form.locator("[data-cy='tk-add-save']").click();
    await page.locator("[data-cy='tk-task'][data-oneoff='true']").first()
      .waitFor({ timeout: 15_000 });
    await expect.see("8807 Spicewood Springs Rd, Austin, TX");
    const list = await http("/api/customers?q=Dave%20Kowalski", {
      headers: auth,
    });
    const body = await list.json();
    const dave = (body.items ?? []).find((c: { name: string }) =>
      c.name === "Dave Kowalski"
    );
    expect(!!dave, "Dave Kowalski is a customer");
    expect.eq(
      dave.address,
      "8807 Spicewood Springs Rd, Austin, TX",
      "the customer carries the task's address — not 'No address on file'",
    );
  }));

Deno.test("REQ-415 (demo p11, cycle 2): a fence builder's Add-task Service box shows its own services as the example, not lawn care", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await officeDay({ page, http, baseUrl }, [{
      taskTypeName: "Fence install",
      priceCents: 90000,
    }]);
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-task']").first().waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='tk-add']").click();
    const form = page.locator("[data-cy='tk-add-form']");
    await form.waitFor({ timeout: 15_000 });
    const type = form.locator("[data-cy='tk-add-type']");
    await page.waitForFunction(
      () =>
        (document.querySelector("[data-cy='tk-add-type']")?.getAttribute(
          "placeholder",
        ) ?? "").includes("Fence install"),
      undefined,
      { timeout: 15_000 },
    );
    const ph = (await type.getAttribute("placeholder")) ?? "";
    expect(
      ph.includes("Fence install"),
      `the placeholder names the account's own service (got "${ph}")`,
    );
    expect(
      !/lawn|mulch|pool/i.test(ph),
      `no lawn-care example for a fence builder (got "${ph}")`,
    );
  }));

Deno.test("REQ-521 (demo m54, cycle 3): an account with no workers opens Add task — the Worker picker says so and links to /field/workers; an empty Save names Customer first, not Service", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    const posts: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST") posts.push(new URL(r.url()).pathname);
    });
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-add']").click();
    const form = page.locator("[data-cy='tk-add-form']");
    await form.waitFor({ timeout: 15_000 });
    // 1. no workers yet — a hint under the picker, with the way to add one
    const hint = form.locator("[data-cy='tk-add-no-workers']");
    await hint.waitFor({ timeout: 15_000 });
    expect(
      (await hint.textContent() ?? "").includes("No workers yet."),
      "the hint says there are no workers",
    );
    const link = hint.locator("a[href='/field/workers']");
    expect.eq(
      (await link.textContent())?.trim(),
      "Add a worker",
      "the hint links to /field/workers",
    );
    // 2. an empty Save — the form's own check runs (customer first), not the browser's bubble on Service
    await form.locator("[data-cy='tk-add-save']").click();
    await expect.see("Pick a customer from the list, or add a new one.");
    const box = form.locator(
      "[data-cy='tk-customer'] [data-cy='search-select-input']",
    );
    expect.eq(
      await box.getAttribute("aria-invalid"),
      "true",
      "the customer box is marked invalid",
    );
    expect.eq(
      await form.locator("[data-cy='tk-add-type']").getAttribute(
        "aria-invalid",
      ),
      null,
      "Service is not the field flagged",
    );
    expect.eq(
      await form.evaluate((f) => (f as HTMLFormElement).noValidate),
      true,
      "the browser's 'Please fill out this field.' bubble is off — the form's own check speaks",
    );
    expect.eq(
      posts.filter((p) => p.endsWith("/field/tasks")).length,
      0,
      "no task POST",
    );
    // 3. the link goes to the workers page
    await link.click();
    await page.waitForURL(/\/field\/workers/, { timeout: 15_000 });
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
    await page.locator("[data-cy='tk-task']").nth(1).waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await page.locator("[data-cy='tk-task']").count(),
      2,
      "two services on the visit",
    );
    expect.eq(
      await page.locator(".panel .tasks").count(),
      1,
      "the same worker · zone group",
    );
    await expect.see("Edging");
    await expect.see("$25.00");
  }));

Deno.test("REQ-166: the card's worker picker moves the task to the other worker's group", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { post } = await officeDay({ page, http, baseUrl });
    const other = await post("/api/field/workers", {
      name: "Marta Ríos",
      phoneNumber: `843${digits()}`,
      pin: "1234",
    });
    await page.goto("/field/tasks");
    const task = page.locator("[data-cy='tk-task']").first();
    await task.waitFor({ timeout: 15_000 });
    await expect.see("Luis Herrera · ");
    await task.locator("[data-cy='tk-worker']").selectOption(other.id);
    await page.locator("[data-cy='tk-task'][data-worker='" + other.id + "']")
      .first().waitFor({ timeout: 15_000 });
    await expect.see("Marta Ríos · ");
    expect.eq(
      await page.locator(".panel__title").filter({ hasText: "Luis Herrera" })
        .count(),
      0,
      "Luis's group is gone",
    );
  }));

Deno.test("REQ-170: no Generate button; a week ahead shows its task on arrival; an unstaffed zone's subscription is listed", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { put, sub } = await officeDay({ page, http, baseUrl });
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-task']").first().waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await page.locator("[data-cy='tk-generate']").count(),
      0,
      "no Generate button",
    );
    const ahead = new Date(todayIso() + "T12:00:00Z");
    ahead.setUTCDate(ahead.getUTCDate() + 7);
    await page.locator("[data-cy='tk-date']").fill(
      ahead.toISOString().slice(0, 10),
    );
    await page.locator("[data-cy='tk-task']").first().waitFor({
      timeout: 15_000,
    });
    await expect.see("0 of 1 complete");
    await put(`/api/field/regions/${sub.region.id}/worker`, { workerId: null });
    await page.reload();
    await page.locator("[data-cy='tk-unstaffed']").first().waitFor({
      timeout: 15_000,
    });
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
    await page.locator("[data-cy='tk-task'][data-status='complete']").first()
      .waitFor({ timeout: 15_000 });
    await expect.see("1 of 1 complete");
    const text = (await summary.innerText()).replace(/\s+/g, " ");
    expect.eq(/Complete 1/i.test(text), true, `complete chip: ${text}`);
    expect.eq(/To do 0/i.test(text), true, `to-do chip: ${text}`);
    expect.eq(/Assigned/i.test(text), false, `no 'Assigned' counter: ${text}`);
  }));

Deno.test("REQ-401 (demo M30/m45, cycle 2): a pull onto drafts says 'on draft invoices'; a send to a customer with no email or phone shows only the failure with its fix; the row reads 1 draft; the worker's lock reads 'on a draft invoice'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const post = async (path: string, body: unknown) => {
      const r = await http(path, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(body),
      });
      return r.json();
    };
    const put = async (path: string, body: unknown) => {
      const r = await http(path, {
        method: "PUT",
        headers: auth,
        body: JSON.stringify(body),
      });
      await r.body?.cancel();
    };
    const customer = await post("/api/customers", { name: "Johnson" });
    expect(
      !!customer.id,
      `Johnson created with no email or phone (${JSON.stringify(customer)})`,
    );
    const cell = `843${digits()}`;
    const worker = await post("/api/field/workers", {
      name: "Luis Herrera",
      phoneNumber: cell,
      pin: "1234",
    });
    const today = todayIso();
    const sub = await post("/api/field/subscriptions", {
      customerId: customer.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      startDate: today,
      items: [{ taskTypeName: "Repair 3 fence panels", priceCents: 9000 }],
    });
    await put(`/api/field/regions/${sub.region.id}/worker`, {
      workerId: worker.id,
    });
    const tasks =
      await (await http(`/api/field/tasks?date=${today}`, { headers: auth }))
        .json();
    expect.eq(tasks.length, 1, "one task today");
    await put(`/api/field/tasks/${tasks[0].id}`, { status: "complete" });

    await page.goto("/field/batches");
    await page.locator("[data-cy='lt-from']").fill(today);
    await page.locator("[data-cy='lt-to']").fill(today);
    await page.locator("[data-cy='lt-pull']").click();
    await page.locator("[data-cy='lt-invoice']").first().waitFor({
      timeout: 20_000,
    });
    const summary = await page.locator("[data-cy='lt-summary']").innerText();
    expect(
      /1 completed, on draft invoices/.test(summary),
      `summary: ${summary}`,
    );
    expect(
      !/completed and invoiced/.test(summary),
      `no 'invoiced' for a draft: ${summary}`,
    );
    await expect.see("1 draft · 0 sent · 0 paid");

    await page.locator("[data-cy='lt-send']").click();
    await page.locator("[data-cy='lt-send-failure']").first().waitFor({
      timeout: 20_000,
    });
    await expect.see(
      "Johnson has no email or phone on file, so nothing was sent.",
    );
    await expect.see("Add an email or phone to Johnson");
    await expect.notSee("each client got theirs");
    await expect.notSee("no recipient:");

    // the worker: the task is locked, worded by its draft invoice
    await page.context().clearCookies();
    await page.goto("/worker?lang=en");
    await page.locator("[data-cy='w-cell']").fill(cell);
    await page.locator("[data-cy='w-pin']").fill("1234");
    await page.locator("[data-cy='w-login']").click();
    await page.locator("[data-cy='w-visit']").first().waitFor({
      timeout: 20_000,
    });
    await expect.see("on a draft invoice");
  }));

Deno.test("REQ-611 (demo p4-p8a, cycle 4): the /field/tasks day stepper's buttons read Previous day / Next day, and 'Day' names only the date input", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await officeDay({ page, http, baseUrl });
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-task']").first().waitFor({
      timeout: 15_000,
    });
    const prev = page.getByRole("button", {
      name: "Previous day",
      exact: true,
    });
    const next = page.getByRole("button", { name: "Next day", exact: true });
    expect.eq(await prev.count(), 1, "one button named Previous day");
    expect.eq(await next.count(), 1, "one button named Next day");
    expect.eq(
      await prev.getAttribute("data-cy"),
      "tk-prev",
      "Previous day is the left chevron",
    );
    expect.eq(
      await next.getAttribute("data-cy"),
      "tk-next",
      "Next day is the right chevron",
    );
    expect.eq(
      await page.getByRole("button", { name: /^Day\b/ }).count(),
      0,
      "no button is named after the 'Day' label",
    );
    expect.eq(
      await page.getByRole("button", { name: "+1", exact: true }).count(),
      0,
      "no button named +1",
    );
    // "Day" names exactly two things: the stepper group and the date input — never a button
    expect.eq(
      await page.getByLabel("Day", { exact: true }).and(page.locator("input"))
        .getAttribute("data-cy"),
      "tk-date",
      "'Day' labels the date input",
    );
    expect.eq(
      await page.getByRole("group", { name: "Day", exact: true }).count(),
      1,
      "the stepper is a group named Day",
    );
    const before = await page.locator("[data-cy='tk-date']").inputValue();
    await next.click();
    await page.waitForFunction(
      (b) =>
        (document.querySelector("[data-cy='tk-date']") as
          | HTMLInputElement
          | null)?.value !== b,
      before,
      { timeout: 15_000 },
    );
    expect(
      await page.locator("[data-cy='tk-date']").inputValue() > before,
      "Next day moves the day forward",
    );
  }));

Deno.test("REQ-787: Annual shows a Month dropdown and that month's calendar; days are picked on it, February has its own length, the card reads Annual · March 5, and Edit opens it again on March 5", (t) =>
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
    const svc1212 = await ensureService(http, auth, "Gutter clean"); // REQ-921: the catalogue has it
    await page.locator("[data-cy='subs-new']").click();
    await pickCustomer(page, "Ana Torres");
    const start = await page.locator("[data-cy='subs-start']").inputValue();
    const [sy, sm, sd] = start.split("-").map(Number);
    await page.locator("[data-cy='subs-cadence']").selectOption("annual");
    expect.eq(
      await page.locator("[data-cy='subs-days']").count(),
      0,
      "the weekday chips are gone",
    );
    const month = page.locator("[data-cy='subs-month']");
    expect.eq(
      await month.locator("option").count(),
      12,
      "a dropdown of the twelve months",
    );
    expect.eq(
      await month.inputValue(),
      String(sm),
      "it starts on the first visit's month",
    );
    expect.eq(
      (await page.locator("[data-cy='subs-dom-day'].on").allTextContents())
        .join("|"),
      String(sd),
      "the first visit's day is on up front",
    );
    // the year shown is the first one on or after the first visit
    const yearFor = (m: number) => (m >= sm ? sy : sy + 1);
    const view = page.locator("[data-cy='subs-month-view']");
    await month.selectOption("2");
    const febDays = new Date(Date.UTC(yearFor(2), 2, 0)).getUTCDate();
    expect.eq(
      await view.locator("[data-cy='subs-dom-day']").count(),
      febDays,
      "February shows its own number of days",
    );
    await month.selectOption("3");
    const y = yearFor(3);
    await expect.see(`March ${y}`);
    expect.eq(
      await view.locator("[data-cy='subs-dow']").count(),
      7,
      "a week header",
    );
    expect.eq(
      await view.locator("[data-cy='subs-dom-day']").count(),
      31,
      "March has 31 days",
    );
    expect.eq(
      await view.locator("[data-cy='subs-dom-day'][data-dom='1']")
        .getAttribute("data-weekday"),
      String(new Date(Date.UTC(y, 2, 1)).getUTCDay()),
      "day 1 sits under its real weekday",
    );
    for (const on of await view.locator("[data-cy='subs-dom-day'].on").all()) {
      await on.click();
    }
    await view.locator("[data-cy='subs-dom-day'][data-dom='5']").click();
    expect.eq(
      (await view.locator("[data-cy='subs-dom-day'].on").allTextContents())
        .join("|"),
      "5",
      "March 5 is the pick",
    );
    await addVisitService(page, svc1212, "180"); // REQ-921
    await page.locator("[data-cy='subs-submit']").click();
    await page.locator("[data-cy='subs-card']").first().waitFor({
      timeout: 20_000,
    });
    await expect.see("Annual · March 5");
    await page.locator("[data-cy='subs-edit']").first().click();
    expect.eq(
      await page.locator("[data-cy='subs-cadence']").inputValue(),
      "annual",
      "Edit keeps Annual",
    );
    expect.eq(
      await page.locator("[data-cy='subs-month']").inputValue(),
      "3",
      "Edit keeps March",
    );
    expect.eq(
      (await page.locator(
        "[data-cy='subs-month-view'] [data-cy='subs-dom-day'].on",
      ).allTextContents()).join("|"),
      "5",
      "Edit keeps day 5",
    );
  }));

// REQ-1013 (LOOP-007 q1-100) — the Annual hint said "One visit a year" under a calendar that takes several days.
Deno.test("REQ-1013: Annual with two days checked (5 and 20) — the hint under the month calendar says each picked day, every year, never one visit a year", (t) =>
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
    await page.locator("[data-cy='subs-cadence']").selectOption("annual");
    await page.locator("[data-cy='subs-month']").selectOption("3");
    const view = page.locator("[data-cy='subs-month-view']");
    for (const on of await view.locator("[data-cy='subs-dom-day'].on").all()) {
      await on.click();
    }
    await view.locator("[data-cy='subs-dom-day'][data-dom='5']").click();
    await view.locator("[data-cy='subs-dom-day'][data-dom='20']").click();
    expect.eq(
      (await view.locator("[data-cy='subs-dom-day'].on").allTextContents())
        .join("|"),
      "5|20",
      "two days are checked",
    );
    const hint = (await view.locator(".hint").textContent() ?? "").trim();
    expect(
      !/one visit/i.test(hint),
      `the hint does not promise one visit a year (got "${hint}")`,
    );
    expect(
      /each day you pick/i.test(hint) && /every year/i.test(hint),
      `the hint says every year, on each day you pick (got "${hint}")`,
    );
  }));

// REQ-788 — "a toggle button in the upper right that adds an overhead cost. that overhead cost is
// defined in settings. the toggle button is in the same style as the weekday selection button."
Deno.test("REQ-788: the overhead cost set in Settings; the form's upper-right chip (a weekday chip) toggles it on; the card lists it; the pulled draft bills services + overhead", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth, put, customer, worker, sub } = await officeDay({
      page,
      http,
      baseUrl,
    });
    // the amount, on Settings
    await page.goto("/settings");
    const amount = page.locator("[data-cy='settings-overhead']");
    await amount.waitFor({ timeout: 15_000 });
    await amount.fill("25");
    await amount.blur();
    await page.waitForTimeout(800);
    const ident = await (await http("/api/profile/identity", { headers: auth }))
      .json();
    expect.eq(
      ident.fieldOverheadCents,
      2500,
      "Settings saved $25.00 as 2500 cents",
    );
    // the chip, in the form's upper right, styled as a weekday chip, off by default
    await page.goto("/field/subscriptions");
    await page.locator("[data-cy='subs-card']").first().waitFor({
      timeout: 20_000,
    });
    await page.locator("[data-cy='subs-edit']").first().click();
    const chip = page.locator("[data-cy='subs-overhead']");
    await chip.waitFor({ timeout: 15_000 });
    expect.eq(
      await chip.getAttribute("class"),
      "day day--wide",
      "off on a subscription that never had it",
    );
    const dayChip = page.locator("[data-cy='subs-day']").first();
    const style = (l: typeof chip) =>
      l.evaluate((el) => {
        const s = getComputedStyle(el);
        return [s.borderRadius, s.height, s.fontWeight].join("|");
      });
    expect.eq(
      await style(chip),
      await style(dayChip),
      "the chip shares the weekday chip's shape",
    );
    const head = page.locator("[data-cy='subs-form'] .modal__head");
    const [titleBox, chipBox] = await Promise.all([
      head.locator("h2").boundingBox(),
      chip.boundingBox(),
    ]);
    expect(
      !!titleBox && !!chipBox && chipBox.x > titleBox.x + titleBox.width &&
        chipBox.y < titleBox.y + titleBox.height,
      "the chip is to the right of the title, on its row",
    );
    await expect.see("Overhead · $25.00");
    await chip.click();
    expect.eq(
      await chip.getAttribute("class"),
      "day day--wide on",
      "toggled on",
    );
    await page.locator("[data-cy='subs-submit']").click();
    await page.locator("[data-cy='subs-form']").waitFor({
      state: "detached",
      timeout: 15_000,
    });
    const card = page.locator("[data-cy='subs-card']").first();
    await card.locator("[data-cy='subs-card-overhead']").waitFor({
      timeout: 15_000,
    });
    await expect.see("$25.00");
    const saved =
      await (await http(`/api/field/subscriptions`, { headers: auth })).json();
    expect.eq(
      saved.find((s: { id: string }) => s.id === sub.id)?.overhead,
      true,
      "the subscription remembers the toggle",
    );
    // the day, completed by the office, pulled: services + overhead
    const today = todayIso();
    const gen = await http("/api/field/tasks/generate", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ date: today }),
    });
    await gen.body?.cancel();
    const tasks =
      await (await http(`/api/field/tasks?date=${today}`, { headers: auth }))
        .json();
    expect.eq(
      tasks.length,
      1,
      `one task for the visit (${tasks.length}) — the overhead is no task (worker ${worker.id})`,
    );
    for (const tk of tasks) {
      await put(`/api/field/tasks/${tk.id}`, { status: "complete" });
    }
    const pulled = await (await http("/api/field/batches/pull", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ from: today, to: today }),
    })).json();
    const inv = pulled.invoices.find((i: { customerId: string }) =>
      i.customerId === customer.id
    );
    expect.eq(
      inv?.amount,
      6500 + 2500,
      "the draft totals the service plus the overhead",
    );
    expect.eq(
      inv?.lineItems?.map((l: { service: string; price: number }) =>
        `${l.service}=${l.price}`
      ).join(","),
      "Lawn cut=6500,Overhead=2500",
      "one service line, one Overhead line",
    );
    expect.eq(inv?.zeroLines, 0, "the overhead is not a $0 line");
    // REQ-788 AMENDMENT — "we want it in percentage, or in dollars": the % switch in Settings
    await page.goto("/settings");
    await page.locator("[data-cy='settings-overhead-mode-percent']").click();
    const pctBox = page.locator("[data-cy='settings-overhead']");
    await pctBox.waitFor({ timeout: 15_000 });
    await pctBox.fill("10");
    await pctBox.blur();
    await page.waitForTimeout(800);
    const ident2 =
      await (await http("/api/profile/identity", { headers: auth })).json();
    expect.eq(
      [ident2.fieldOverheadMode, ident2.fieldOverheadPct].join("|"),
      "percent|10",
      "Settings saved the percent mode and 10%",
    );
    await page.goto("/field/subscriptions");
    await page.locator("[data-cy='subs-card-overhead']").first().waitFor({
      timeout: 20_000,
    });
    await expect.see("$6.50 · 10%");
    await page.locator("[data-cy='subs-edit']").first().click();
    await page.locator("[data-cy='subs-overhead']").waitFor({
      timeout: 15_000,
    });
    await expect.see("Overhead · 10%");
  }));

// REQ-810 — "i need a way to remove invoices from a batch and a way to remove a row from batch.
// i think a button inline would work in each case."
Deno.test("REQ-810: a batch of two customers — × a line and the totals drop in place; Remove from batch → confirm → the card is gone and the counts update; a sent invoice shows no remove buttons", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const call = async (method: string, path: string, body?: unknown) => {
      const r = await http(path, {
        method,
        headers: auth,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return r.json();
    };
    const today = todayIso();
    const worker = await call("POST", "/api/field/workers", {
      name: "Luis Herrera",
      phoneNumber: `843${digits()}`,
      pin: "1234",
    });
    for (
      const [name, address, items] of [
        ["Ana Torres", "4601 Dick Pond Rd, Myrtle Beach, SC", [{
          taskTypeName: "Lawn cut",
          priceCents: 6500,
        }, { taskTypeName: "Hedge trim", priceCents: 4000 }]],
        ["Bob Reyes", "845 Frederick Rd, Rockingham, VA", [{
          taskTypeName: "Lawn cut",
          priceCents: 6500,
        }]],
      ] as const
    ) {
      const c = await call("POST", "/api/customers", {
        name,
        address,
        email: `${
          name.replace(/\W+/g, ".").toLowerCase()
        }@blackhole.postmarkapp.com`,
      });
      const sub = await call("POST", "/api/field/subscriptions", {
        customerId: c.id,
        address,
        startDate: today,
        items,
      });
      await call("PUT", `/api/field/regions/${sub.region.id}/worker`, {
        workerId: worker.id,
      });
    }
    const tasks = await call("GET", `/api/field/tasks?date=${today}`);
    expect.eq(tasks.length, 3, "three tasks today");
    for (const tk of tasks) {
      await call("PUT", `/api/field/tasks/${tk.id}`, { status: "complete" });
    }

    await page.goto("/field/batches");
    await page.locator("[data-cy='lt-from']").fill(today);
    await page.locator("[data-cy='lt-to']").fill(today);
    await page.locator("[data-cy='lt-pull']").click();
    await page.locator("[data-cy='lt-invoice']").nth(1).waitFor({
      timeout: 20_000,
    });
    const card = (name: string) =>
      page.locator("[data-cy='lt-invoice']").filter({ hasText: name });
    const total = page.locator("[data-cy='lt-batch-total']");
    expect.eq(
      (await total.innerText()).includes("$170.00"),
      true,
      `batch total $170.00 (${await total.innerText()})`,
    );
    await page.evaluate(
      () => ((window as unknown as { __noReload: number }).__noReload = 1),
    );

    // × the Hedge line on Ana's card: the line leaves, her total and the batch total drop, no reload
    const ana = card("Ana Torres");
    expect.eq(
      await ana.locator("[data-cy='lt-line']").count(),
      2,
      "Ana has two lines",
    );
    const hedge = ana.locator("[data-cy='lt-line']").filter({
      hasText: "Hedge trim",
    });
    const x = hedge.getByRole("button", { name: "Remove this line" });
    await x.click();
    await ana.locator("[data-cy='lt-line']").filter({ hasText: "Hedge trim" })
      .waitFor({ state: "detached", timeout: 20_000 });
    expect.eq(
      await ana.locator("[data-cy='lt-line']").count(),
      1,
      "one line left",
    );
    await ana.locator("[data-cy='lt-inv-total']").getByText("$65.00").waitFor({
      timeout: 15_000,
    });
    await total.getByText("$130.00").waitFor({ timeout: 15_000 });
    expect.eq(
      await page.evaluate(() =>
        (window as unknown as { __noReload?: number }).__noReload
      ),
      1,
      "the page updated in place",
    );

    // Remove from batch on Bob's card: an inline confirm, then the card is gone and the counts update
    const bob = card("Bob Reyes");
    await bob.locator("[data-cy='lt-remove']").click();
    await bob.locator("[data-cy='lt-remove-ask']").waitFor({ timeout: 10_000 });
    await bob.locator("[data-cy='lt-remove-confirm']").click();
    await card("Bob Reyes").waitFor({ state: "detached", timeout: 20_000 });
    expect.eq(
      await page.locator("[data-cy='lt-invoice']").count(),
      1,
      "one card left",
    );
    await page.locator("[data-cy='lt-count']").getByText("1 invoice").waitFor({
      timeout: 15_000,
    });
    await total.getByText("$65.00").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='lt-past']").first().getByText(
      "1 draft · 0 sent · 0 paid",
    ).waitFor({ timeout: 15_000 });
    expect.eq(
      await page.evaluate(() =>
        (window as unknown as { __noReload?: number }).__noReload
      ),
      1,
      "still no reload",
    );

    // the freed work is billable again: Bob's task is un-invoiced
    const after = await call("GET", `/api/field/tasks?date=${today}`);
    expect.eq(
      after.filter((tk: { invoiceId?: string }) => !tk.invoiceId).length,
      2,
      "Hedge trim and Bob's Lawn cut are un-invoiced",
    );

    // a sent invoice is a real invoice: no remove buttons on its card
    const invId = await ana.getAttribute("data-id");
    await call("PUT", `/api/invoices/${invId}`, { status: "sent" });
    await page.reload();
    const sent = card("Ana Torres");
    await sent.waitFor({ timeout: 20_000 });
    await sent.getByText("Sent").first().waitFor({ timeout: 15_000 });
    expect.eq(
      await sent.locator("[data-cy='lt-remove']").count(),
      0,
      "no Remove from batch on a sent invoice",
    );
    expect.eq(
      await sent.getByRole("button", { name: "Remove this line" }).count(),
      0,
      "no × on a sent invoice's lines",
    );
  }));

// REQ-811 — Raphael: "recurring has the same thing over and over … associate a checklist to recurring … a reference"
Deno.test("REQ-811: a checklist made on /field/checklists → a repeat visit that picks it and adds no task type of its own → the card lists the checklist's services → today's tasks carry them", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const post = async (path: string, body: unknown) => {
      const r = await http(path, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(body),
      });
      return await r.json();
    };
    await post("/api/customers", {
      name: "Ana Torres",
      phoneNumber: `(843) 555-${digits().slice(0, 4)}`,
      email: "ana@blackhole.postmarkapp.com",
    });
    const worker = await post("/api/field/workers", {
      name: "Luis Herrera",
      phoneNumber: `843${digits()}`,
      pin: "1234",
    });

    // 1. the checklist, on /field/checklists — two services with their prices
    await page.goto("/field/checklists");
    await page.locator("[data-cy='ckl-new']").click();
    await page.locator("[data-cy='ckl-name']").fill("Full yard");
    await page.locator("[data-cy='ckl-type-q']").fill("Lawn cut");
    await page.locator("[data-cy='ckl-price']").fill("65");
    await page.locator("[data-cy='ckl-add-item']").click();
    await page.locator("[data-cy='ckl-type-q']").fill("Edging");
    await page.locator("[data-cy='ckl-price']").fill("25");
    await page.locator("[data-cy='ckl-add-item']").click();
    expect.eq(
      await page.locator("[data-cy='ckl-item']").count(),
      2,
      "two rows on the checklist form",
    );
    await page.locator("[data-cy='ckl-submit']").click();
    const ckl = page.locator("[data-cy='ckl-card']").first();
    await ckl.waitFor({ timeout: 20_000 });
    await expect.see("Full yard");
    await expect.see("$65.00");
    await expect.see("$25.00");
    await expect.see("Used by 0 repeat visits");

    // 2. a repeat visit that picks the checklist and lists no task type of its own
    await page.goto("/field/subscriptions");
    await page.locator("[data-cy='subs-new']").click();
    await pickCustomer(page, "Ana Torres");
    await page.locator("[data-cy='subs-address']").fill(
      "4601 Dick Pond Rd, Myrtle Beach, SC",
    );
    const select = page.locator("[data-cy='subs-checklist']");
    await select.locator("option", { hasText: "Full yard" }).waitFor({
      state: "attached",
      timeout: 15_000,
    });
    await select.selectOption({ label: "Full yard" });
    await expect.see("Extra services"); // REQ-921: the label names services
    await page.locator("[data-cy='subs-submit']").click();
    const card = page.locator("[data-cy='subs-card']").first();
    await card.waitFor({ timeout: 20_000 });
    await card.locator("[data-cy='subs-card-checklist']").waitFor({
      timeout: 15_000,
    });
    await expect.see("Full yard");
    expect.eq(
      await card.locator("[data-cy='subs-item-from-checklist']").count(),
      2,
      "the card lists the checklist's two services, marked as the checklist's",
    );
    await expect.see("$65.00");
    await expect.see("$25.00");

    // the checklist page now says it is used once
    await page.goto("/field/checklists");
    await page.locator("[data-cy='ckl-card']").first().waitFor({
      timeout: 20_000,
    });
    await expect.see("Used by 1 repeat visit");

    // 3. the zone gets its worker (the API) — today's round, on /field/tasks, carries both services
    const regions = await (await http("/api/field/regions", { headers: auth }))
      .json();
    expect(regions.length === 1, `one zone (${regions.length})`);
    const staffed = await http(`/api/field/regions/${regions[0].id}/worker`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ workerId: worker.id }),
    });
    await staffed.body?.cancel();
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-task']").first().waitFor({
      timeout: 20_000,
    });
    expect.eq(
      await page.locator("[data-cy='tk-task']").count(),
      2,
      "both checklist services are today's tasks",
    );
    await expect.see("Lawn cut");
    await expect.see("Edging");
    await expect.see("Ana Torres");
  }));

// ---- REQ-839..842 — the service catalogue, crews, zones staffed by crews, who is out ----

/** the owner's API, for the set-up a story is not about */
function apiOf(http: StoryTools["http"], auth: Record<string, string>) {
  return async (method: string, path: string, body?: unknown) => {
    const r = await http(path, {
      method,
      headers: auth,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return await r.json();
  };
}

// REQ-839 — Raphael: "a place to define line items … one of those tasks becomes an ID, a description, and then the price can be set wherever it's set"
Deno.test("REQ-839: a service made on /field/services with a description → it is offered on the checklist form → the card counts the checklist → archived, it leaves the live list and the picker but a 'Show archived' toggle brings it back", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);

    await page.goto("/field/services");
    await page.locator("[data-cy='svc-new']").click();
    await page.locator("[data-cy='svc-name']").fill("Mulching");
    await page.locator("[data-cy='svc-description']").fill(
      "Beds topped up, 2 inches",
    );
    await page.locator("[data-cy='svc-submit']").click();
    const card = page.locator("[data-cy='svc-card']").first();
    await card.waitFor({ timeout: 20_000 });
    await expect.see("Mulching");
    await expect.see("Beds topped up, 2 inches");
    await expect.see("Used by 0 repeat visits · 0 checklists");

    // the same name again is refused in the owner's words
    await page.locator("[data-cy='svc-new']").click();
    await page.locator("[data-cy='svc-name']").fill("mulching");
    await page.locator("[data-cy='svc-submit']").click();
    await page.locator("[data-cy='svc-error']").waitFor({ timeout: 15_000 });
    await expect.see("already have a service");
    await page.keyboard.press("Escape");

    // offered on the checklist form; a checklist that picks it counts on the card
    await page.goto("/field/checklists");
    await page.locator("[data-cy='ckl-new']").click();
    await page.locator("[data-cy='ckl-type-q']").fill("Mulching");
    await page.locator("[data-cy='ckl-price']").fill("120");
    await page.locator("[data-cy='ckl-add-item']").click();
    expect.eq(
      await page.locator("[data-cy='ckl-item']").count(),
      1,
      "the catalogue's service is on the checklist",
    );
    await page.locator("[data-cy='ckl-name']").fill("Spring beds");
    await page.locator("[data-cy='ckl-submit']").click();
    await page.locator("[data-cy='ckl-card']").first().waitFor({
      timeout: 20_000,
    });

    await page.goto("/field/services");
    await page.locator("[data-cy='svc-card']").first().waitFor({
      timeout: 20_000,
    });
    expect.eq(
      await page.locator("[data-cy='svc-card']").count(),
      1,
      "the checklist picked the catalogue's service — no second one was made",
    );
    await expect.see("Used by 0 repeat visits · 1 checklist");
    // in use → Delete is refused; Archive hides it
    await page.locator("[data-cy='svc-delete']").first().click();
    await page.locator("[data-cy='svc-delete-confirm']").click();
    await page.locator("[data-cy='svc-card-error']").waitFor({
      timeout: 15_000,
    });
    await expect.see("or archive it"); // REQ-927: and Move to… comes first
    await page.locator("[data-cy='svc-archive']").first().click();
    await page.locator("[data-cy='svc-empty']").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='svc-show-archived']").check();
    await page.locator("[data-cy='svc-archived']").waitFor({ timeout: 15_000 });
    await expect.see("Mulching");
  }));

// REQ-840 — Raphael: "the worker belongs to a crew … each crew has a foreman, and then however many workers … clearly shown and chosen inside the worker view"
Deno.test("REQ-840: two workers → a crew made on /field/workers with both, Ana as foreman and one service → the crew card lists them → each worker row wears the crew → a third worker joins from his row's Crew select", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const api = apiOf(http, auth);
    const mk = (name: string) =>
      api("POST", "/api/field/workers", {
        name,
        phoneNumber: `843${digits()}`,
        pin: "1234",
      });
    await mk("Ana Ruiz");
    await mk("Luis Herrera");
    await mk("Pedro Gil");
    await api("POST", "/api/field/task-types", { name: "Lawn cut" });

    await page.goto("/field/workers");
    await page.locator("[data-cy='crew-empty']").waitFor({ timeout: 20_000 });
    await page.locator("[data-cy='crew-new']").click();
    await page.locator("[data-cy='crew-name']").fill("Grass crew");
    const picks = page.locator("[data-cy='crew-member-picks'] label");
    await picks.filter({ hasText: "Ana Ruiz" }).click();
    await picks.filter({ hasText: "Luis Herrera" }).click();
    await page.locator("[data-cy='crew-foreman']").selectOption({
      label: "Ana Ruiz",
    });
    await page.locator("[data-cy='crew-service-picks'] label").filter({
      hasText: "Lawn cut",
    }).click();
    await page.locator("[data-cy='crew-submit']").click();
    const crew = page.locator("[data-cy='crew-card']").first();
    await crew.waitFor({ timeout: 20_000 });
    await expect.see("Grass crew");
    await expect.see("Foreman: Ana Ruiz");
    expect.eq(
      await crew.locator("[data-cy='crew-members'] .chip").count(),
      2,
      "two members on the crew card",
    );
    await expect.see("Staffs 0 zones");
    // the worker rows wear it
    expect.eq(
      await page.locator("[data-cy='wk-row-crew']").count(),
      2,
      "Ana's and Luis's rows carry the crew chip",
    );
    // Pedro joins from his own row
    const pedro = page.locator("[data-cy='wk-row']", { hasText: "Pedro Gil" });
    await pedro.locator("[data-cy='wk-row-crew-select']").selectOption({
      label: "Grass crew",
    });
    await pedro.locator("[data-cy='wk-row-crew']").waitFor({ timeout: 15_000 });
    expect.eq(
      await page.locator("[data-cy='crew-card']").first().locator(
        "[data-cy='crew-members'] .chip",
      ).count(),
      3,
      "the crew card now lists three",
    );
  }));

// REQ-841 — Raphael: "a mulching crew and a grass cutting crew … one house that they have in common"
Deno.test("REQ-841: a grass crew and a mulch crew → a visit with Lawn cut + Mulching → both crews toggled on its zone on /field/assignments → today's round on /field/tasks has one group per crew, each with the service it does", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const api = apiOf(http, auth);
    const mk = (name: string) =>
      api("POST", "/api/field/workers", {
        name,
        phoneNumber: `843${digits()}`,
        pin: "1234",
      });
    const [ana, pedro] = [await mk("Ana Ruiz"), await mk("Pedro Gil")];
    const mow = await api("POST", "/api/field/task-types", {
      name: "Lawn cut",
    });
    const mulch = await api("POST", "/api/field/task-types", {
      name: "Mulching",
    });
    await api("POST", "/api/field/crews", {
      name: "Grass crew",
      memberIds: [ana.id],
      foremanId: ana.id,
      taskTypeIds: [mow.id],
    });
    await api("POST", "/api/field/crews", {
      name: "Mulch crew",
      memberIds: [pedro.id],
      taskTypeIds: [mulch.id],
    });
    const customer = await api("POST", "/api/customers", {
      name: "Ana Torres",
      phoneNumber: `(843) 555-${digits().slice(0, 4)}`,
      email: "ana@blackhole.postmarkapp.com",
    });
    await api("POST", "/api/field/subscriptions", {
      customerId: customer.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      startDate: todayIso(),
      items: [{ taskTypeId: mow.id, priceCents: 6500 }, {
        taskTypeId: mulch.id,
        priceCents: 12_000,
      }],
    });

    await page.goto("/field/assignments");
    const region = page.locator("[data-cy='asg-region']").first();
    await region.waitFor({ timeout: 20_000 });
    await expect.see("1 zone with no crew"); // REQ-997: was "1 zones with no crew"
    const toggles = region.locator("[data-cy='asg-region-crew']");
    expect.eq(await toggles.count(), 2, "both crews offered on the zone");
    // the toggles are controlled: they flip once the server has answered, so click + wait, not check()
    await toggles.nth(0).click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll("[data-cy='asg-region-crew']:checked")
          .length === 1,
      undefined,
      { timeout: 15_000 },
    );
    await toggles.nth(1).click();
    await page.waitForFunction(
      () =>
        document.querySelectorAll("[data-cy='asg-region-crew']:checked")
          .length === 2,
      undefined,
      { timeout: 15_000 },
    );
    await expect.notSee("with no crew"); // REQ-997: singular "1 zone with no crew" too

    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-task']").first().waitFor({
      timeout: 20_000,
    });
    expect.eq(
      await page.locator("[data-cy='tk-task']").count(),
      2,
      "two tasks: one per service",
    );
    expect.eq(
      await page.locator("[data-cy='tk-group']").count(),
      2,
      "one group per crew",
    );
    const chip = (name: string) =>
      page.locator("[data-cy='tk-group-crew']", { hasText: name });
    const grass = page.locator("[data-cy='tk-group']", {
      has: chip("Grass crew"),
    });
    expect(
      (await grass.innerText()).includes("Lawn cut"),
      "the grass crew's group holds Lawn cut",
    );
    const mulchGroup = page.locator("[data-cy='tk-group']", {
      has: chip("Mulch crew"),
    });
    expect(
      (await mulchGroup.innerText()).includes("Mulching"),
      "the mulch crew's group holds Mulching",
    );
  }));

// REQ-842 — Raphael: "what if so-and-so goes on vacation … change the assignment now or in advance"
Deno.test("REQ-842: the grass crew is marked out today on /field/workers, covered by the mulch crew → Away lists it → today's tasks move to Pedro with 'Covering for Grass crew' → Remove brings them back to Ana", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const api = apiOf(http, auth);
    const mk = (name: string) =>
      api("POST", "/api/field/workers", {
        name,
        phoneNumber: `843${digits()}`,
        pin: "1234",
      });
    const [ana, pedro] = [await mk("Ana Ruiz"), await mk("Pedro Gil")];
    const mow = await api("POST", "/api/field/task-types", {
      name: "Lawn cut",
    });
    const grass = await api("POST", "/api/field/crews", {
      name: "Grass crew",
      memberIds: [ana.id],
      foremanId: ana.id,
      taskTypeIds: [mow.id],
    });
    await api("POST", "/api/field/crews", {
      name: "Mulch crew",
      memberIds: [pedro.id],
    });
    const customer = await api("POST", "/api/customers", {
      name: "Ana Torres",
      phoneNumber: `(843) 555-${digits().slice(0, 4)}`,
      email: "ana@blackhole.postmarkapp.com",
    });
    const sub = await api("POST", "/api/field/subscriptions", {
      customerId: customer.id,
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      startDate: todayIso(),
      items: [{ taskTypeId: mow.id, priceCents: 6500 }],
    });
    await api("PUT", `/api/field/regions/${sub.region.id}/worker`, {
      crewIds: [grass.id],
    });
    // today's round, before: Ana's
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-task']").first().waitFor({
      timeout: 20_000,
    });
    await expect.see("Ana Ruiz");
    await expect.notSee("Covering for");

    await page.goto("/field/workers");
    await page.locator("[data-cy='away-empty']").waitFor({ timeout: 20_000 });
    await page.locator("[data-cy='crew-card']", { hasText: "Grass crew" })
      .locator("[data-cy='crew-away']").click();
    await expect.see("Grass crew is out");
    await page.locator("[data-cy='away-disp-cover']").check();
    await page.locator("[data-cy='away-cover']").selectOption({
      label: "Crew: Mulch crew",
    });
    await page.locator("[data-cy='away-note']").fill("Vacation");
    await page.locator("[data-cy='away-submit']").click();
    const row = page.locator("[data-cy='away-row']").first();
    await row.waitFor({ timeout: 20_000 });
    await expect.see("covered by Mulch crew");
    await expect.see("Vacation");

    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-cover-for']").first().waitFor({
      timeout: 20_000,
    });
    await expect.see("Pedro Gil");
    await expect.see("Covering for Grass crew");

    // the absence removed → the work is Ana's again
    await page.goto("/field/workers");
    await page.locator("[data-cy='away-remove']").first().click();
    await page.locator("[data-cy='away-empty']").waitFor({ timeout: 20_000 });
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-task']").first().waitFor({
      timeout: 20_000,
    });
    await expect.see("Ana Ruiz");
    await expect.notSee("Covering for");
  }));

// REQ-1014 (LOOP-007 q1, q1-99) — Raphael: "test every single aspect of this application …"
// The Away row on /field/workers printed the absence's raw ISO dates ("2026-11-26"); every
// other field screen runs the same day through fmtDay ("Thu, Nov 26").
const fmtDayEn = (iso: string) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
const plusDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
Deno.test("REQ-1014: a crew marked out on /field/workers — one day, then a two-day range — the Away row reads 'Thu, Nov 26' / 'Thu, Nov 26 → Fri, Nov 27', never a raw YYYY-MM-DD", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const api = apiOf(http, auth);
    const ana = await api("POST", "/api/field/workers", {
      name: "Ana Ruiz",
      phoneNumber: `843${digits()}`,
      pin: "1234",
    });
    await api("POST", "/api/field/crews", {
      name: "Grass crew",
      memberIds: [ana.id],
      foremanId: ana.id,
    });
    const today = todayIso();
    const tomorrow = plusDaysIso(today, 1);

    const markOut = async (to: string) => {
      await page.locator("[data-cy='crew-card']", { hasText: "Grass crew" })
        .locator("[data-cy='crew-away']").click();
      await expect.see("Grass crew is out");
      await page.locator("[data-cy='away-from']").fill(today);
      await page.locator("[data-cy='away-to']").fill(to);
      await page.locator("[data-cy='away-disp-skip']").check();
      await page.locator("[data-cy='away-submit']").click();
      const dates = page.locator("[data-cy='away-row-dates']").first();
      await dates.waitFor({ timeout: 20_000 });
      return (await dates.textContent() ?? "").trim();
    };

    await page.goto("/field/workers");
    await page.locator("[data-cy='away-empty']").waitFor({ timeout: 20_000 });
    const single = await markOut(today);
    expect(
      !/\d{4}-\d{2}-\d{2}/.test(single) && single === fmtDayEn(today),
      `one-day Away row reads "${fmtDayEn(today)}" (got "${single}")`,
    );

    await page.locator("[data-cy='away-remove']").first().click();
    await page.locator("[data-cy='away-empty']").waitFor({ timeout: 20_000 });
    const range = await markOut(tomorrow);
    const want = `${fmtDayEn(today)} → ${fmtDayEn(tomorrow)}`;
    expect(
      !/\d{4}-\d{2}-\d{2}/.test(range) && range === want,
      `two-day Away row reads "${want}" (got "${range}")`,
    );
  }));

// REQ-927 — Raphael: "in services we need a way to migrate services to another and segment it out so we can undo redo or move that segment to another spot, this way we are able to delete services without fucking up the integrity of the system"
Deno.test("REQ-927: Move to… moves Mowing's checklist onto Lawn cut and deletes Mowing → the Moves list shows the move → Undo brings Mowing back with its checklist → Redo → Move to… sends the same records on to Edging", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const api = apiOf(http, auth);
    const mow = await api("POST", "/api/field/task-types", { name: "Mowing" });
    await api("POST", "/api/field/task-types", { name: "Lawn cut" });
    await api("POST", "/api/field/task-types", { name: "Edging" });
    await api("POST", "/api/field/checklists", {
      name: "Full yard",
      items: [{ taskTypeId: mow.id, priceCents: 6500 }],
    });
    const checklistService = async () =>
      (await api("GET", "/api/field/checklists"))[0].items[0].taskTypeName;
    const cards = page.locator("[data-cy='svc-card']");
    const row = page.locator("[data-cy='svc-move-row']").first();
    // a click before the island hydrates does nothing: click until the form is up
    const openForm = async (button: ReturnType<typeof page.locator>) => {
      const form = page.locator("[data-cy='svc-move-form']");
      for (let i = 0; i < 20 && !(await form.isVisible()); i++) {
        await button.click();
        await form.waitFor({ timeout: 1_000 }).catch(() => {});
      }
      await form.waitFor({ timeout: 5_000 });
    };

    await page.goto("/field/services");
    await cards.first().waitFor({ timeout: 20_000 });
    await openForm(
      cards.filter({ hasText: "Mowing" }).locator("[data-cy='svc-migrate']"),
    );
    await expect.see("Move “Mowing” to another service");
    expect.eq(
      await page.locator("[data-cy='svc-move-delete']").isChecked(),
      true,
      "delete once empty is on by default",
    );
    await page.locator("[data-cy='svc-move-target']").selectOption({ label: "Lawn cut" });
    await page.locator("[data-cy='svc-move-submit']").click();
    await row.waitFor({ timeout: 20_000 });
    expect.eq(await page.locator("[data-cy='svc-move-from']").first().textContent(), "Mowing", "the move names the old service");
    expect.eq(await page.locator("[data-cy='svc-move-to']").first().textContent(), "Lawn cut", "and where it went");
    expect.eq(await page.locator("[data-cy='svc-move-counts']").first().textContent(), "1 checklist", "what it moved");
    await expect.see("deleted");
    expect.eq(await cards.count(), 2, "Mowing is gone from the catalogue");
    expect.eq(await checklistService(), "Lawn cut", "the checklist is on Lawn cut");

    // Undo: Mowing is back, with its checklist
    await page.locator("[data-cy='svc-move-undo']").first().click();
    await page.locator("[data-cy='svc-move-row'][data-state='undone']").waitFor({ timeout: 20_000 });
    await cards.filter({ hasText: "Mowing" }).first().waitFor({ timeout: 20_000 });
    expect.eq(await cards.count(), 3, "Mowing is back in the catalogue");
    expect.eq(await checklistService(), "Mowing", "the checklist is on Mowing again");

    // Redo, then send the same records on to Edging
    await page.locator("[data-cy='svc-move-redo']").first().click();
    await page.locator("[data-cy='svc-move-row'][data-state='applied']").waitFor({ timeout: 20_000 });
    expect.eq(await checklistService(), "Lawn cut", "redone");
    await openForm(page.locator("[data-cy='svc-move-again']").first());
    await page.locator("[data-cy='svc-move-target']").selectOption({ label: "Edging" });
    await page.locator("[data-cy='svc-move-submit']").click();
    await page.locator("[data-cy='svc-move-to']", { hasText: "Edging" }).waitFor({ timeout: 20_000 });
    expect.eq(await checklistService(), "Edging", "the move went on to Edging");
  }));

/** `YYYY-MM-DD` shifted by whole days */
const shiftIso = (iso: string, days: number) =>
  new Date(Date.parse(iso + "T00:00:00Z") + days * 86_400_000).toISOString()
    .slice(0, 10);

// REQ-1004 (LOOP-007 q1, q1-90) — a seasonal repeat visit: the New repeat visit form has an
// optional "Ends on" date next to First visit, the saved card reads "· until Mon D", and the
// visit is stored with that endDate.
Deno.test("REQ-1004 (LOOP-007 q1, q1-90): a weekly repeat visit with Ends on set saves, the card reads '· until <date>' and the visit keeps its endDate", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const r = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Seasonal Sam",
        address: "4601 Dick Pond Rd, Myrtle Beach, SC",
        email: "seasonal.sam@blackhole.postmarkapp.com",
      }),
    });
    await r.body?.cancel();
    const svc = await ensureService(http, auth, "Lawn cut");
    await page.goto("/field/subscriptions");
    await page.locator("[data-cy='subs-new']").click();
    await pickCustomer(page, "Seasonal Sam");
    await page.locator("[data-cy='subs-start']").waitFor({ timeout: 15_000 });
    const end = page.locator("[data-cy='subs-end']");
    expect.eq(
      await end.count(),
      1,
      "the form has an 'Ends on' date next to First visit",
    );
    const endIso = shiftIso(todayIso(), 60);
    await end.fill(endIso);
    await addVisitService(page, svc, "65");
    await page.locator("[data-cy='subs-submit']").click();
    const card = page.locator("[data-cy='subs-card']").first();
    await card.waitFor({ timeout: 20_000 });
    const label = new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      timeZone: "UTC",
    }).format(new Date(endIso + "T00:00:00Z")); // "Jan 17"
    await expect.see(`· until ${label}`);
    const subs = await (await http("/api/field/subscriptions", {
      headers: auth,
    })).json();
    expect.eq(subs[0]?.endDate, endIso, "the visit is stored with its end date");
  }));

// REQ-1004 (LOOP-007 q1, q1-90) — Pause asks first: clicking Pause on a repeat visit opens a
// confirmation and nothing is paused until it is confirmed.
Deno.test("REQ-1004 (LOOP-007 q1, q1-90): Pause on a repeat-visit card asks for confirmation first — the visit stays active until confirmed, then the card offers Resume", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const c = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Paula Pause",
        email: "paula.pause@blackhole.postmarkapp.com",
      }),
    })).json();
    const s = await http("/api/field/subscriptions", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: c.id,
        address: "725 Frederick Rd, Rockingham, VA",
        startDate: todayIso(),
        items: [{ taskTypeName: "Lawn cut", priceCents: 6500 }],
      }),
    });
    expect.eq(s.status, 201, "the visit is created");
    await s.body?.cancel();
    await page.goto("/field/subscriptions");
    const card = page.locator("[data-cy='subs-card']").first();
    await card.waitFor({ timeout: 15_000 });
    await card.locator("[data-cy='subs-toggle']").click();
    const confirm = card.locator("[data-cy='subs-pause-confirm']");
    await confirm.waitFor({ timeout: 5_000 }).catch(() => {});
    const activeNow = (await (await http("/api/field/subscriptions", {
      headers: auth,
    })).json())[0]?.active;
    expect.eq(activeNow, true, "one click on Pause does not pause the visit");
    expect.eq(
      await confirm.count(),
      1,
      "Pause opens a confirmation on the card",
    );
    await confirm.click();
    await card.locator("[data-cy='subs-toggle']").filter({ hasText: "Resume" })
      .waitFor({ timeout: 15_000 });
    const after = (await (await http("/api/field/subscriptions", {
      headers: auth,
    })).json())[0]?.active;
    expect.eq(after, false, "confirmed, the visit is paused");
  }));
