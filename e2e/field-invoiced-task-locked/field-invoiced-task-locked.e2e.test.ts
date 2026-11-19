/**
 * REQ-1009 — LOOP-007 cycle 1, QA issue q1-95: "Invoiced task still shows an editable price,
 * 'Mark not done' and 'Delete'". After the batch pull + send, the invoiced task's card on
 * /field/tasks shows the Invoiced chip, its price as plain text (no price input), no Add service
 * or Delete, and a disabled done-check named "Invoiced" (not "Mark not done").
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

/** the company's day — the backend's FIELD_TZ default (America/New_York) */
const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

/** an owner with one worker and one staffed subscription due today */
async function officeDay(
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  const call = async (method: string, path: string, data?: unknown) => {
    const res = await http(path, {
      method,
      headers: auth,
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
  await call("PUT", "/api/me", { language: "en", name: "Field Story" });
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  const today = todayIso();
  const customer = await call("POST", "/api/customers", {
    name: "Ana Torres",
    email: "ana.torres@blackhole.postmarkapp.com",
  });
  const cell = `843${digits()}`;
  const worker = await call("POST", "/api/field/workers", {
    name: "Luis Herrera",
    phoneNumber: cell,
    pin: "1234",
  });
  const sub = await call("POST", "/api/field/subscriptions", {
    customerId: customer.id,
    address: "4601 Dick Pond Rd, Myrtle Beach, SC",
    startDate: today,
    items: [{ taskTypeName: "Lawn cut", priceCents: 6500 }],
  });
  await call("PUT", `/api/field/regions/${sub.region.id}/worker`, {
    workerId: worker.id,
  });
  const tasks = await call("GET", `/api/field/tasks?date=${today}`);
  return { call, today, cell, tasks };
}

Deno.test("REQ-1009 (LOOP-007 q1-95, cycle 1): an invoiced task on /field/tasks is read-only — price as text, no Delete / Add service, the check disabled and named 'Invoiced'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { call, today, tasks } = await officeDay(http, page, baseUrl);
    expect.eq(tasks.length, 1, "one task today");
    await call("PUT", `/api/field/tasks/${tasks[0].id}`, {
      status: "complete",
    });
    const pulled = await call("POST", "/api/field/batches/pull", {
      from: today,
      to: today,
    });
    const inv = pulled.invoices[0];
    expect(!!inv?.id, "the batch pull drafted one invoice");
    await call("PUT", `/api/invoices/${inv.id}`, { status: "sent" });
    const after = await call("GET", `/api/field/tasks?date=${today}`);
    expect.eq(after[0]?.invoiceId, inv.id, "the task is invoiced");

    await page.goto("/field/tasks");
    const card = page.locator("[data-cy='tk-task']").first();
    await card.waitFor({ timeout: 20_000 });
    await card.locator("a.chip", { hasText: "Invoiced" }).waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await card.locator("input[data-cy='tk-price']").count(),
      0,
      "no price input on an invoiced task",
    );
    const priceText = card.locator("[data-cy='tk-price-locked']");
    expect.eq(await priceText.count(), 1, "the price shows as plain text");
    expect(
      (await priceText.innerText()).includes("65.00"),
      `the plain price reads $65.00 (${await priceText.innerText().catch(() => "")})`,
    );
    for (const cy of ["tk-delete", "tk-add-service", "tk-edit-dates"]) {
      expect.eq(
        await card.locator(`[data-cy='${cy}']`).count(),
        0,
        `no ${cy} on an invoiced task`,
      );
    }
    const check = card.locator("[data-cy='tk-done']");
    expect(await check.isDisabled(), "the done-check is disabled");
    expect.eq(
      await check.getAttribute("title"),
      "Invoiced",
      "the done-check's title is 'Invoiced'",
    );
    expect.eq(
      await check.getAttribute("aria-label"),
      "Invoiced",
      "the done-check is named 'Invoiced', not 'Mark not done'",
    );
    const look = await check.evaluate((el) => {
      const s = getComputedStyle(el);
      return { opacity: Number(s.opacity), cursor: s.cursor };
    });
    expect(look.opacity < 1, `the locked check is dimmed (opacity ${look.opacity})`);
    expect.eq(look.cursor, "not-allowed", "the locked check shows not-allowed");
  }));
