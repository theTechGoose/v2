/**
 * REQ-1007 (LOOP-007 q1, q1-93) — a customer whose record holds only a city
 * ("Myrtle Beach, SC") but whose repeat visit is at a street address
 * ("1200 N Ocean Blvd, Myrtle Beach, SC"): picking them in /field/tasks
 * "Add task" and in /work-orders "New work order" fills the visit's street
 * address, not the city alone.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const STREET = "1200 N Ocean Blvd";
const FULL = `${STREET}, Myrtle Beach, SC`;

const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
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
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Service Address Story" }),
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
  return auth;
}

Deno.test("REQ-1007 (LOOP-007 q1-93): a city-only customer with a repeat visit at a street address — Add task and New work order both fill the visit's street address", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const post = async (p: string, b: unknown) => {
      const r = await http(p, {
        method: "POST",
        headers: auth,
        body: JSON.stringify(b),
      });
      const j = await r.json();
      if (r.status >= 300) {
        throw new Error(`${p} ${r.status} ${JSON.stringify(j)}`);
      }
      return j;
    };
    const customer = await post("/api/customers", {
      name: "Ana Torres",
      email: "ana.torres@blackhole.postmarkapp.com",
      city: "Myrtle Beach",
      state: "SC",
    });
    expect.eq(
      customer.address,
      "Myrtle Beach, SC",
      "the customer record holds the city only (the q1-93 setup)",
    );
    await post("/api/field/subscriptions", {
      customerId: customer.id,
      address: FULL,
      startDate: todayIso(),
      items: [{ taskTypeName: "Lawn mowing", priceCents: 5000 }],
    });

    // 1. /field/tasks → Add task → pick Ana
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-add']").click();
    const form = page.locator("[data-cy='tk-add-form']");
    await form.waitFor({ timeout: 15_000 });
    await form.locator(
      "[data-cy='tk-customer'] [data-cy='search-select-input']",
    ).fill("Ana");
    await form.locator(
      "[data-cy='tk-customer'] [data-cy='search-select-option']",
    ).filter({ hasText: "Ana Torres" }).first().click();
    const taskAddress = await form.locator("[data-cy='tk-add-address']")
      .inputValue();

    // 2. /work-orders → New work order → pick Ana
    await page.goto("/work-orders");
    await page.locator("[data-cy='wo-new']").click();
    const modal = page.locator("[data-cy='wo-new-modal']");
    await modal.waitFor({ timeout: 15_000 });
    await page.waitForFunction(
      (id) =>
        !!document.querySelector(
          `[data-cy='wo-new-customer'] option[value='${id}']`,
        ),
      customer.id,
      { timeout: 15_000 },
    );
    await modal.locator("[data-cy='wo-new-customer']").selectOption(
      customer.id,
    );
    const woAddress = await modal.locator("[data-cy='wo-new-address']")
      .inputValue();
    // both read before asserting, so a red names both boxes
    expect(
      taskAddress.includes(STREET) && woAddress.includes(STREET),
      `Add task and New work order fill the repeat visit's street address "${FULL}" (got Add task "${taskAddress}", New work order "${woAddress}")`,
    );
    expect(
      woAddress.includes(STREET),
      `New work order fills the repeat visit's street address (got "${woAddress}")`,
    );
  }));
