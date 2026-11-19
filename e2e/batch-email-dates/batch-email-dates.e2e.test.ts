/**
 * REQ-944 (LOOP-007 cycle 1, q1-13) — "Batch-sent invoice email shows a
 * blank 'Issued —' and a 29-day due date."
 *
 * The flow as the tester ran it: a completed visit for a customer with an
 * email, /field/batches → Pull → Send selected; the email in the outbox
 * (/api/outbox/:id, exactly as sent) has an "Issued" row that reads "—"
 * because FieldBatches.send emails the draft before it stamps issuedDate.
 * The email's Drafted and Issued dates must both be the invoice's issue
 * day, and Due must be that day + its days to pay.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

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
  for (
    const [path, payload] of [
      ["/api/me", { name: "Field Story", language: "en" }],
      ["/api/profile/identity", {
        businessName: "A2Z Landscape LLC",
        commsLanguage: "en",
      }],
    ] as const
  ) {
    const res = await http(path, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify(payload),
    });
    await res.body?.cancel();
  }
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

/** the company's day — the backend's FIELD_TZ default (America/New_York) */
const todayIso = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

/** "2026-11-18" → "November 18, 2026", as the email prints a date-only value */
const longEn = (ymd: string) =>
  new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${ymd}T12:00:00Z`));

/** the text of the cell/div right after the one labelled `label` */
const valueAfter = (html: string, label: string) =>
  html.match(
    new RegExp(`>${label}</(?:div|td)>\\s*<(?:div|td)[^>]*>([^<]*)<`),
  )?.[1]?.trim();

Deno.test("REQ-944 q1-13: /field/batches → Send selected — the invoice email in the outbox shows its issue date (no 'Issued —'), Drafted = Issued, Due = Issued + days to pay", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const call = async (method: string, path: string, body?: unknown) =>
      await (await http(path, {
        method,
        headers: auth,
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })).json();
    const today = todayIso();
    const worker = await call("POST", "/api/field/workers", {
      name: "Luis Herrera",
      phoneNumber: `843${digits()}`,
      pin: "1234",
    });
    const customer = await call("POST", "/api/customers", {
      name: "Ana Torres",
      address: "4601 Dick Pond Rd, Myrtle Beach, SC",
      email: "ana.torres@blackhole.postmarkapp.com",
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
    expect.eq(tasks.length, 1, "one task today");
    await call("PUT", `/api/field/tasks/${tasks[0].id}`, {
      status: "complete",
    });

    await page.goto("/field/batches");
    await page.locator("[data-cy='lt-from']").fill(today);
    await page.locator("[data-cy='lt-to']").fill(today);
    await page.locator("[data-cy='lt-pull']").click();
    await page.locator("[data-cy='lt-invoice']").first().waitFor({
      timeout: 20_000,
    });
    const sendDone = page.waitForResponse((r) =>
      /\/api\/field\/batches\/[^/]+\/send$/.test(new URL(r.url()).pathname) &&
      r.request().method() === "POST"
    );
    await page.locator("[data-cy='lt-send']").click();
    const sent = await (await sendDone).json();
    expect.eq(sent.sent, 1, `one invoice sent (${JSON.stringify(sent)})`);

    const invoiceId: string = sent.sentIds[0];
    const inv = await call("GET", `/api/invoices/${invoiceId}`);
    const rows = await call("GET", "/api/outbox") as {
      id: string;
      kind: string;
      channel: string;
      docId?: string;
    }[];
    const mail = rows.find((r) =>
      r.kind === "invoice" && r.channel === "email" && r.docId === invoiceId
    );
    expect(
      !!mail,
      `the invoice email is in the outbox (${JSON.stringify(rows)})`,
    );
    const opened = await call("GET", `/api/outbox/${mail!.id}`) as {
      body: string;
    };
    const html = opened.body;
    const issuedDay = inv.issuedDate as string;
    // expect.eq is ===, so the three dates are compared as one JSON string
    expect.eq(
      JSON.stringify({
        drafted: valueAfter(html, "Drafted"),
        issued: valueAfter(html, "Issued"),
        due: valueAfter(html, "Due"),
      }),
      JSON.stringify({
        drafted: longEn(issuedDay),
        issued: longEn(issuedDay),
        due: longEn(inv.dueDate),
      }),
      `the email's dates (invoice issued ${issuedDay}, due ${inv.dueDate}, ${inv.netDays} days)`,
    );
    const due = new Date(`${inv.dueDate}T12:00:00Z`).getTime();
    const issued = new Date(`${issuedDay}T12:00:00Z`).getTime();
    expect.eq(
      Math.round((due - issued) / 86_400_000),
      inv.netDays,
      "due is the issue day + its days to pay",
    );
  }));
