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
    await page.locator("[data-cy='wk-name']").fill("Luis Herrera");
    await page.locator("[data-cy='wk-phone']").fill(cell);
    await page.locator("[data-cy='wk-pin']").fill("1234");
    await page.locator("[data-cy='wk-add']").click();
    await page.locator("[data-cy='wk-row']").first().waitFor({
      timeout: 15_000,
    });
    await expect.see("Luis Herrera");

    // 2. a subscription on the existing customer, on /field/subscriptions
    await page.goto("/field/subscriptions");
    await page.locator("[data-cy='subs-new']").click();
    const sel = page.locator("[data-cy='subs-customer']");
    await sel.waitFor({ timeout: 15_000 });
    await sel.locator(`option[value='${customer.id}']`).waitFor({
      state: "attached",
      timeout: 15_000,
    });
    await sel.selectOption(customer.id);
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
  }));
