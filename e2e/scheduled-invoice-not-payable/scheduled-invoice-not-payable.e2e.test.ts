/**
 * REQ-1100 — LOOP-007 cycle 3, issue q3-25. Raphael: "test every single
 * aspect of this application … one Opus agent per issue to do root cause
 * analysis, then one to write the test, then one to fix it and make it
 * green."
 *
 * QA's run: the change-order approval receipt's "View your invoice" opened
 * /i of the SCHEDULED balance invoice — "Invoice 2 of 2 — Final payment",
 * "Balance due $5,665.35" and a Zelle pay block — while the page's own
 * schedule said "Balance … On completion". A scheduled invoice is the
 * owner's reminder (REQ-697); the customer must not be able to pay or claim
 * it before it is billed.
 *
 * The story: a business with Zelle; a SENT invoice and a SCHEDULED one for
 * the same customer. Logged out, /i of the sent one offers the claim form
 * (control: the page CAN show it); /i of the scheduled one shows no
 * pay-by-card, no pay buttons, no claim form, and a "not due yet" note
 * (data-cy=invoice-not-due-yet).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(http: StoryTools["http"]) {
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
  return { ...JSON_HEADERS, cookie };
}

async function call(
  http: StoryTools["http"],
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  const r = await http(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(
      `${method} ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

const iso = (days: number) =>
  new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

Deno.test("REQ-1100 (LOOP-007 q3-25): a logged-out customer on /i of a SCHEDULED balance invoice gets no pay-by-card, no pay buttons and no claim form — a 'not due yet' note instead", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http);
    await call(http, "PUT", "/api/me", auth, {
      language: "en",
      name: "Walt Whitfield",
    });
    await call(http, "PUT", "/api/profile/identity", auth, {
      businessName: "Whitfield Painting & Fences",
      acceptedPaymentMethods: {
        zelle: { enabled: true, handle: "pay@whitfield.test" },
      },
    });
    const customer = await call(http, "POST", "/api/customers", auth, {
      name: "Maria Lopez",
      email: "maria.lopez@blackhole.postmarkapp.com",
    });
    const line = (description: string, price: number) => [{
      description,
      quantity: 1,
      unit: "job",
      price,
    }];
    const sent = await call(http, "POST", "/api/invoices", auth, {
      customerId: customer.id,
      jobName: "Fence repaint",
      status: "sent",
      lineItems: line("Deposit (50%)", 451_000),
      amount: 451_000,
      dueDate: iso(14),
    });
    const scheduled = await call(http, "POST", "/api/invoices", auth, {
      customerId: customer.id,
      jobName: "Fence repaint",
      status: "scheduled",
      scheduledFor: iso(20),
      lineItems: line("Balance", 566_535),
      amount: 566_535,
      dueDate: iso(21),
    });
    expect.eq(scheduled.status, "scheduled", "the balance is scheduled");

    // the browser is the CUSTOMER's — no owner session, only a language
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies(
      [...hosts].map((domain) => ({
        name: "pm_lang",
        value: "en",
        domain,
        path: "/",
      })),
    );
    const headline = page.locator("[data-cy='invoice-headline']");
    const read = () =>
      page.evaluate(() => {
        const n = (s: string) => document.querySelectorAll(s).length;
        return {
          payByCard: n("[data-cy='pay-by-card-wrap']"),
          payButtons: n("[data-cy='pay-buttons']"),
          claimForm: n("[data-cy='claim-form']"),
          notDue: n("[data-cy='invoice-not-due-yet']"),
          text: document.body.innerText.replace(/\s+/g, " "),
        };
      });

    // control: the SENT invoice offers the customer a way to pay
    await page.goto(`/i/${sent.id}`);
    await headline.waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='claim-form'], [data-cy='pay-buttons']")
      .first().waitFor({ timeout: 15_000 });

    // the SCHEDULED balance: nothing to pay yet
    await page.goto(`/i/${scheduled.id}`);
    await headline.waitFor({ timeout: 15_000 });
    await page.waitForTimeout(1_000);
    const s = await read();
    const problems: string[] = [];
    if (s.payByCard) problems.push("pay-by-card is offered");
    if (s.payButtons) problems.push("the pay buttons (Zelle) are offered");
    if (s.claimForm) problems.push("the 'I paid' claim form is offered");
    if (!s.notDue) problems.push("no 'not due yet' note (invoice-not-due-yet)");
    expect.eq(
      problems.join(" | "),
      "",
      `a scheduled, unbilled balance must not be payable (page: ${
        s.text.slice(0, 400)
      })`,
    );
  }));
