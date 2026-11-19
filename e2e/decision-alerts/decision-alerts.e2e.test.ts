/**
 * REQ-948 — LOOP-007 cycle 1, issues q1-21 + q1-22: the customer's decision
 * reaches the contractor by email and text, in a browser.
 *
 *  - q1-21: the customer approves a change order on /co/:id → the account's
 *    comms trail (GET /messages) gains a text + an email to the contractor and a
 *    receipt email to the customer.
 *  - q1-22: the customer declines a quote on /q/:id (Price + a note) → the
 *    trail gains a text + an email to the contractor.
 *
 * Today both stay at the count they had before the click: the decision only
 * becomes an in-app bell row.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

type Entry = { channel?: string; toAddress?: string };

async function signIn(http: StoryTools["http"]) {
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
  const ownerEmail = `owner${digits()}@example.com`;
  await call("/api/me", {
    name: "Hans Builder",
    email: ownerEmail,
    language: "en",
  }, "PUT");
  await call("/api/profile/identity", {
    businessName: "Cambio Builders",
    commsLanguage: "en",
  }, "PUT");
  const customerEmail = `maria${digits()}@example.com`;
  const customer = await call("/api/customers", {
    name: "María Nguyen",
    phoneNumber: `+1512${digits()}`,
    email: customerEmail,
  });
  /** the comms trail behind /messages (GET /messages, oldest first) */
  const outbox = async (): Promise<Entry[]> => {
    const res = await http("/api/messages", { headers: auth });
    if (!res.ok) throw new Error(`/api/messages → ${res.status}`);
    return await res.json();
  };
  return {
    cookie,
    call,
    outbox,
    ownerPhone: phone,
    ownerEmail,
    customerId: customer.id as string,
    customerEmail,
  };
}

const lastTen = (s = "") => s.replace(/\D/g, "").slice(-10);

/** poll the trail for up to 10 s until `want` holds (a send is awaited by
 *  the request, but the trail write may land a moment later) */
async function waitFor(
  outbox: () => Promise<Entry[]>,
  want: (e: Entry[]) => boolean,
): Promise<Entry[]> {
  let last: Entry[] = [];
  for (let i = 0; i < 20; i++) {
    last = await outbox();
    if (want(last)) return last;
    await new Promise((r) => setTimeout(r, 500));
  }
  return last;
}

Deno.test("REQ-948 (LOOP-007 q1-21): the customer approves a change order on /co → /messages gains a text and an email to the contractor and a receipt email to the customer", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const s = await signIn(http);
    const quote = await s.call("/api/quotes", {
      customerId: s.customerId,
      summary: "Kitchen remodel",
      lineItems: [{
        description: "Kitchen remodel",
        quantity: 1,
        unit: "job",
        price: 1_920_000,
      }],
      estimatedTotal: 1_920_000,
    });
    const invoice = await s.call("/api/invoices", {
      customerId: s.customerId,
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
    const co = await s.call(`/api/invoices/${invoice.id}/change-orders`, {
      description: "Add pantry shelving",
      deltaAmountCents: 85_000,
    });
    const before = (await s.outbox()).length;

    // the customer: no session, opens the link and approves
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${baseUrl}/co/${co.id}?lang=en`);
    await page.getByRole("button", { name: "Approve this change" }).waitFor({
      timeout: 15_000,
    });
    const approved = page.locator("[data-cy=co-approved-by]");
    for (let i = 0; i < 10 && !(await approved.count()); i++) {
      try {
        await page.locator("[data-cy=co-name]").fill("María Nguyen", {
          timeout: 2_000,
        });
        await page.getByRole("button", { name: "Approve this change" })
          .click({ timeout: 2_000 });
        await approved.waitFor({ timeout: 2_000 });
      } catch { /* not hydrated yet, or the page is reloading */ }
    }
    await approved.waitFor({ timeout: 15_000 });

    const want = (all: Entry[]) => {
      const added = all.slice(before);
      return {
        contractorText: added.filter((e) =>
          e.channel === "text" && lastTen(e.toAddress) === lastTen(s.ownerPhone)
        ).length,
        contractorEmail: added.filter((e) =>
          e.channel === "email" && e.toAddress === s.ownerEmail
        ).length,
        customerEmail: added.filter((e) =>
          e.channel === "email" && e.toAddress === s.customerEmail
        ).length,
      };
    };
    const after = await waitFor(s.outbox, (all) => {
      const w = want(all);
      return w.contractorText >= 1 && w.contractorEmail >= 1 &&
        w.customerEmail >= 1;
    });
    const got = want(after);
    expect.eq(
      after.length > before,
      true,
      `the comms trail did not grow after the approval (${before} → ${after.length})`,
    );
    expect.eq(got.contractorText, 1, "one text to the contractor");
    expect.eq(got.contractorEmail, 1, "one email to the contractor");
    expect.eq(got.customerEmail, 1, "one receipt email to the customer");
  }));

Deno.test("REQ-948 (LOOP-007 q1-22): the customer declines a quote on /q (Price + a note) → /messages gains a text and an email to the contractor", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const s = await signIn(http);
    const quote = await s.call("/api/quotes", {
      customerId: s.customerId,
      summary: "Backyard junk removal",
      jobName: "Backyard junk removal",
      lineItems: [{
        description: "Haul away",
        quantity: 1,
        unit: "job",
        price: 45_000,
      }],
      estimatedTotal: 45_000,
      status: "draft",
    });
    await s.call(`/api/quotes/${quote.id}`, { status: "sent" }, "PUT");
    const before = (await s.outbox()).length;

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${baseUrl}/q/${quote.id}?lang=en`);
    const decline = page.locator("[data-cy='quote-decline']");
    await decline.waitFor({ timeout: 15_000 });
    const form = page.getByRole("button", { name: "Send decline" });
    for (let i = 0; i < 10 && !(await form.count()); i++) {
      try {
        await decline.click({ timeout: 2_000 });
        await form.waitFor({ timeout: 2_000 });
      } catch { /* not hydrated yet */ }
    }
    await page.getByRole("button", { name: "Price", exact: true }).click();
    await page.locator("textarea").fill("Found someone closer to home");
    await page.locator("#pqa-decline-name").fill("María Nguyen");
    const declined = page.waitForResponse((r) =>
      r.url().includes(`/api/quotes/${quote.id}/decline`) &&
      r.request().method() === "POST"
    );
    await form.click();
    expect.eq((await declined).status(), 200, "the decline landed");

    const count = (all: Entry[]) => {
      const added = all.slice(before);
      return {
        text: added.filter((e) =>
          e.channel === "text" && lastTen(e.toAddress) === lastTen(s.ownerPhone)
        ).length,
        email: added.filter((e) =>
          e.channel === "email" && e.toAddress === s.ownerEmail
        ).length,
      };
    };
    const after = await waitFor(s.outbox, (all) => {
      const c = count(all);
      return c.text >= 1 && c.email >= 1;
    });
    const got = count(after);
    expect.eq(
      after.length > before,
      true,
      `the comms trail did not grow after the decline (${before} → ${after.length})`,
    );
    expect.eq(got.text, 1, "one text to the contractor");
    expect.eq(got.email, 1, "one email to the contractor");
  }));
