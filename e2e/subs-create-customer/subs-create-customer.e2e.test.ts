/**
 * REQ-1068 (LOOP-007 cycle 2, q2-57) — /field/subscriptions → New repeat visit: typing a name
 * that is not a customer yet offers "+ Add "<name>" as a customer" (not a bare "No matches."),
 * and clicking it creates the customer (existing POST /customers) and picks them, so the visit
 * saves on that customer without leaving the modal.
 */
import { story, type StoryTools } from "#shots";
import { addVisitService, ensureService } from "../_shared/service-lines.ts";

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

Deno.test("REQ-1068 (LOOP-007 q2-57): New repeat visit — a new customer name offers '+ Add \"Jim Baker\" as a customer', creates him, and the visit saves on him", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const svc = await ensureService(http, auth, "Lawn cut");
    await page.goto("/field/subscriptions");
    const open = page.locator("[data-cy='subs-new']").first();
    await open.waitFor({ timeout: 15_000 });
    await open.click();
    await page.locator("[data-cy='subs-form']").waitFor({ timeout: 15_000 });

    const input = page.locator(
      "[data-cy='subs-customer'] [data-cy='search-select-input']",
    );
    await input.waitFor({ timeout: 15_000 });
    await input.fill("Jim Baker");
    // one read: the list's create row and empty row together
    await page.waitForFunction(
      () =>
        !!document.querySelector(
          "[data-cy='subs-customer'] [data-cy='search-select-create'], [data-cy='subs-customer'] [data-cy='search-select-empty']",
        ),
      undefined,
      { timeout: 10_000 },
    );
    const rows = await page.evaluate(() => {
      const q = (s: string) =>
        document.querySelector(`[data-cy='subs-customer'] [data-cy='${s}']`)
          ?.textContent?.trim() ?? null;
      return { create: q("search-select-create"), empty: q("search-select-empty") };
    });
    expect.eq(
      rows.create,
      '+ Add "Jim Baker" as a customer',
      `the box offers to add the new name as a customer (got ${JSON.stringify(rows)})`,
    );
    expect.eq(
      rows.empty,
      null,
      `no bare "No matches." for a name that can be added (got ${JSON.stringify(rows)})`,
    );
    if (rows.create === null) return; // nothing to click on the buggy build

    const created = page.waitForResponse((r) =>
      r.url().includes("/api/customers") && r.request().method() === "POST"
    );
    await page.locator(
      "[data-cy='subs-customer'] [data-cy='search-select-create']",
    ).click();
    const resp = await created;
    expect.eq(resp.ok(), true, `POST /api/customers succeeded (${resp.status()})`);

    await page.locator("[data-cy='subs-address']").fill(
      "12 Oak St, Myrtle Beach, SC",
    );
    await addVisitService(page, svc, "45");
    await page.locator("[data-cy='subs-submit']").click();
    await page.locator("[data-cy='subs-card']").first().waitFor({
      timeout: 20_000,
    });
    await expect.see("Jim Baker");

    const list = await (await http("/api/customers?q=Jim%20Baker", {
      headers: auth,
    })).json();
    const items: Array<{ name: string }> = Array.isArray(list)
      ? list
      : (list.items ?? list.rows ?? []);
    expect.eq(
      items.some((c) => c.name === "Jim Baker"),
      true,
      `GET /api/customers?q=Jim Baker finds the new customer (${JSON.stringify(list).slice(0, 200)})`,
    );
  }));

/**
 * REQ-1152 (LOOP-007 cycle 3, q3-84 / q3-85) — the natural form order on New repeat visit:
 * '+ Add "Grace Whitfield" as a customer' is clicked BEFORE the Address box is typed. The
 * visit's address must still become Grace's (REQ-340's rule, carried to repeat visits): the
 * API carries it, her /customers card does not say "No address on file", and Add task on
 * /field/tasks prefills it even once the visit is paused (no active visit to fall back on).
 */
Deno.test("REQ-1152 (LOOP-007 q3, q3-84, q3-85): New repeat visit — a customer added before the address is typed gets the visit's address; her card has it and Add task prefills it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const NAME = `Grace Whitfield ${digits()}`;
    const ADDR = "2101 Kinney Ave, Austin, TX 78704";
    const auth = await signIn(http, page, baseUrl);
    const svc = await ensureService(http, auth, "Lawn cut");
    await page.goto("/field/subscriptions");
    const open = page.locator("[data-cy='subs-new']").first();
    await open.waitFor({ timeout: 15_000 });
    await open.click();
    await page.locator("[data-cy='subs-form']").waitFor({ timeout: 15_000 });

    // 1. customer box first (it sits above Address): type the name, click the create row
    const input = page.locator(
      "[data-cy='subs-customer'] [data-cy='search-select-input']",
    );
    await input.waitFor({ timeout: 15_000 });
    await input.fill(NAME);
    const createRow = page.locator(
      "[data-cy='subs-customer'] [data-cy='search-select-create']",
    );
    await createRow.waitFor({ timeout: 10_000 });
    const created = page.waitForResponse((r) =>
      r.url().includes("/api/customers") && r.request().method() === "POST"
    );
    await createRow.click();
    const resp = await created;
    expect.eq(resp.ok(), true, `POST /api/customers succeeded (${resp.status()})`);
    const grace = await resp.json() as { id: string; address?: string };

    // 2. then the address, a service line, Save
    await page.locator("[data-cy='subs-address']").fill(ADDR);
    await addVisitService(page, svc, "45");
    const saved = page.waitForResponse((r) =>
      r.url().includes("/api/field/subscriptions") &&
      r.request().method() === "POST"
    );
    await page.locator("[data-cy='subs-submit']").click();
    const subResp = await saved;
    expect.eq(subResp.ok(), true, `POST /api/field/subscriptions succeeded (${subResp.status()})`);
    const sub = await subResp.json() as { id: string };

    // 3. the API: Grace now carries the visit's address
    const one = await (await http(`/api/customers/${grace.id}`, {
      headers: auth,
    })).json() as { address?: string };

    // 4. pause the visit, so only Grace's own address can fill Add task (q3-85)
    const paused = await http(`/api/field/subscriptions/${sub.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ active: false }),
    });
    await paused.body?.cancel();

    // 5. her /customers card (client sheet)
    await page.goto(`/customers?open=${grace.id}`);
    const sheet = page.locator("[data-cy='client-sheet']");
    await sheet.waitFor({ timeout: 20_000 });
    const sheetText = (await sheet.textContent()) ?? "";

    // 6. /field/tasks → Add task → pick Grace
    await page.goto("/field/tasks");
    await page.locator("[data-cy='tk-add']").click();
    const form = page.locator("[data-cy='tk-add-form']");
    await form.waitFor({ timeout: 15_000 });
    await form.locator(
      "[data-cy='tk-customer'] [data-cy='search-select-input']",
    ).fill(NAME);
    await form.locator(
      "[data-cy='tk-customer'] [data-cy='search-select-option']",
    ).filter({ hasText: NAME }).first().click();
    const taskAddress = await form.locator("[data-cy='tk-add-address']")
      .inputValue();

    // every fact read before asserting, so one red names them all
    const facts = JSON.stringify({
      api: one.address ?? null,
      sheetSaysNone: sheetText.includes("No address on file"),
      taskAddress,
    });
    expect.eq(
      one.address,
      ADDR,
      `GET /api/customers/:id carries the visit's address (${facts})`,
    );
    expect.eq(
      sheetText.includes("No address on file"),
      false,
      `her card does not say "No address on file" (${facts})`,
    );
    expect.eq(
      taskAddress,
      ADDR,
      `Add task prefills her address after the visit is paused (${facts})`,
    );
  }));
