/**
 * REQ-1143 (LOOP-007 cycle 3, q3-75) — amends REQ-921/979. A fresh account with NO services opens
 * /field/subscriptions?new=1&customerId=<id>, types "Gutter cleaning" into the service box, clicks
 * the price box (the dropdown closes, the typed name stays, nothing is picked), types 40 and
 * presses +. The line must be added (the typed name becomes a catalogue service), and the repeat
 * visit must save. Before the fix + answered "Pick a service on every line." and the only help on
 * screen was a same-tab link to /field/services that drops the half-filled form.
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
  return auth;
}

/** a fresh account with one customer and no services, the repeat-visit form open on that customer */
async function openForm(
  { page, http, baseUrl }: Pick<StoryTools, "page" | "http" | "baseUrl">,
) {
  const auth = await signIn(http, page, baseUrl);
  const r = await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Dana Gutters",
      address: "88 Pine St, Myrtle Beach, SC",
    }),
  });
  if (!r.ok) throw new Error(`customer: ${r.status} ${await r.text()}`);
  const customer = await r.json() as { id: string };
  const types = await (await http("/api/field/task-types", { headers: auth }))
    .json() as unknown[];
  if (types.length) throw new Error(`fresh account has services: ${types.length}`);

  await page.goto(`/field/subscriptions?new=1&customerId=${customer.id}`);
  await page.locator("[data-cy='subs-form']").waitFor({ timeout: 20_000 });
  // the empty-catalogue hint shows once the (empty) catalogue has loaded
  await page.locator("[data-cy='subs-no-services']").waitFor({
    timeout: 15_000,
  });
  return auth;
}

/** type a service name, then leave the box for the price the way the tester did (no row clicked) */
async function typeServiceThenPrice(
  page: StoryTools["page"],
  name: string,
  price: string,
) {
  const box = page.locator(
    "[data-cy='subs-service'] [data-cy='search-select-input']",
  );
  // wait for hydration: the typed text must open the list (create row or empty row)
  for (let i = 0; i < 20; i++) {
    await box.click();
    await box.fill(name);
    const open = await page.locator(
      "[data-cy='subs-service'] [data-cy='search-select-create'], [data-cy='subs-service'] [data-cy='search-select-empty']",
    ).count();
    if (open) break;
    await page.waitForTimeout(300);
  }
  const priceBox = page.locator("[data-cy='subs-price']");
  await priceBox.click();
  await priceBox.fill(price);
}

Deno.test("REQ-1143 (LOOP-007 q3-75): no services — typing 'Gutter cleaning', price 40 and the add button add the line, creates the service, and the repeat visit saves", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await openForm({ page, http, baseUrl });

    // the empty-catalogue hint keeps the owner in the modal (asserted after the flow)
    const offPage = await page.locator(
      "[data-cy='subs-no-services'] a[href='/field/services']:not([target='_blank'])",
    ).count();

    await typeServiceThenPrice(page, "Gutter cleaning", "40");
    await page.locator("[data-cy='subs-add-item']").click();
    // the create round-trip, or the error line — whichever comes first
    await page.waitForFunction(
      () =>
        document.querySelectorAll("[data-cy='subs-item']").length > 0 ||
        !!document.querySelector("[data-cy='subs-error']"),
      undefined,
      { timeout: 10_000 },
    );
    const state = await page.evaluate(() => ({
      rows: [...document.querySelectorAll("[data-cy='subs-item']")].map((r) => ({
        name: r.querySelector(".name")?.textContent?.trim() ?? "",
        price: (r.querySelector("input.price") as HTMLInputElement | null)
          ?.value ?? "",
      })),
      err: document.querySelector("[data-cy='subs-error']")?.textContent
        ?.trim() ?? null,
    }));
    expect.eq(
      JSON.stringify(state.rows),
      JSON.stringify([{ name: "Gutter cleaning", price: "40.00" }]),
      `+ adds the typed service as one line at $40.00 (got ${JSON.stringify(state)})`,
    );
    if (!state.rows.length) return; // nothing to save on the buggy build
    expect.eq(
      offPage,
      0,
      "the no-services hint has no same-tab link to /field/services (it drops the half-filled form)",
    );

    const types = await (await http("/api/field/task-types", { headers: auth }))
      .json() as Array<{ name: string }>;
    expect.eq(
      types.filter((x) => x.name === "Gutter cleaning").length,
      1,
      `the services list now holds 'Gutter cleaning' once (${JSON.stringify(types)})`,
    );

    await page.locator("[data-cy='subs-submit']").click();
    await page.locator("[data-cy='subs-card']").first().waitFor({
      timeout: 20_000,
    });
    const subs = await (await http("/api/field/subscriptions", {
      headers: auth,
    })).json() as Array<{ items: Array<{ taskTypeName: string; priceCents: number }> }>;
    expect.eq(
      subs.length === 1 &&
        subs[0].items.some((i) =>
          i.taskTypeName === "Gutter cleaning" && i.priceCents === 4000
        ),
      true,
      `the repeat visit saved with Gutter cleaning at $40 (${JSON.stringify(subs).slice(0, 300)})`,
    );
  }));

Deno.test("REQ-1143 (LOOP-007 q3-75): no services — a typed 'Gutter cleaning' at -20 is refused with the price error, not 'Pick a service'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await openForm({ page, http, baseUrl });
    await typeServiceThenPrice(page, "Gutter cleaning", "-20");
    await page.locator("[data-cy='subs-add-item']").click();
    await page.locator("[data-cy='subs-error']").waitFor({ timeout: 10_000 });
    const err = await page.locator("[data-cy='subs-error']").textContent();
    expect.eq(
      err?.trim(),
      "Give every service a price above $0.",
      "a typed service with a -20 price gets the price error",
    );
    expect.eq(
      await page.locator("[data-cy='subs-item']").count(),
      0,
      "no line is added at -20",
    );
  }));
