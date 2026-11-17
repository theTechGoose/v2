/**
 * REQ-689 — demo-loop cycle 5, issue p5: once the customer approves a change
 * order, /co/:id no longer says "Review it below and approve to update your
 * total." It says when it was approved and what the total is now; a declined
 * order says it was declined.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function seed(http: StoryTools["http"]) {
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
  if (!cookie) throw new Error(`sign-in: no cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const call = async (path: string, payload: unknown, method = "POST") => {
    const res = await http(path, {
      method,
      headers: auth,
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`${path} → ${res.status} ${JSON.stringify(json)}`);
    }
    return json;
  };
  await call("/api/me", { name: "CO Owner", language: "en" }, "PUT");
  await call("/api/profile/identity", {
    businessName: "Cambio Builders",
    commsLanguage: "es",
  }, "PUT");
  const customer = await call("/api/customers", {
    name: "Juan Pérez",
    phoneNumber: `+1512${digits()}`,
  });
  const quote = await call("/api/quotes", {
    customerId: customer.id,
    summary: "Kitchen remodel",
    lineItems: [{
      description: "Kitchen remodel",
      quantity: 1,
      unit: "job",
      price: 1_920_000,
    }],
    estimatedTotal: 1_920_000,
  });
  const invoice = await call("/api/invoices", {
    customerId: customer.id,
    quoteId: quote.id,
    jobName: "Kitchen remodel",
    lineItems: [{
      description: "Balance",
      quantity: 1,
      unit: "job",
      price: 960_000,
    }],
    amount: 960_000,
    dueDate: "2026-12-30",
  });
  const co = await call(`/api/invoices/${invoice.id}/change-orders`, {
    description: "Add pantry shelving",
    deltaAmountCents: 85_000,
  });
  return { cookie, coId: co.id as string };
}

async function decide(
  http: StoryTools["http"],
  coId: string,
  action: "approve" | "decline",
) {
  const r = await http(`/api/change-orders/${coId}/${action}`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(action === "approve" ? { name: "Juan Pérez" } : {}),
  });
  if (!r.ok) throw new Error(`${action} → ${r.status} ${await r.text()}`);
}

Deno.test("REQ-689 p5: an approved /co says it was approved and the new total; a declined one says declined; neither asks to approve", (t) =>
  story(t, async ({ page, expect, http }) => {
    await page.setViewportSize({ width: 1280, height: 900 });

    // pending: the ask is still there
    const pending = await seed(http);
    await page.goto(`/co/${pending.coId}?lang=en`);
    await page.locator("[data-cy=co-intro]").waitFor({ timeout: 15_000 });
    const ask = await page.locator("[data-cy=co-intro]").innerText();
    expect(
      /Review it below and approve/.test(ask),
      `pending ask (got "${ask}")`,
    );

    // approved
    await decide(http, pending.coId, "approve");
    await page.goto(`/co/${pending.coId}?lang=en`);
    await page.locator("[data-cy=co-intro]").waitFor({ timeout: 15_000 });
    const done = await page.locator("[data-cy=co-intro]").innerText();
    expect(
      /^You approved this change on \w{3} \d{1,2}, \d{4} — your total is now \$20,050\.00\.$/
        .test(done.trim()),
      `approved intro (got "${done}")`,
    );
    await expect.notSee("Review it below and approve");

    // declined
    const other = await seed(http);
    await decide(http, other.coId, "decline");
    await page.goto(`/co/${other.coId}?lang=es`);
    await page.locator("[data-cy=co-intro]").waitFor({ timeout: 15_000 });
    const no = await page.locator("[data-cy=co-intro]").innerText();
    expect.eq(no.trim(), "Rechazaste este cambio.", "declined intro (es)");
  }));
