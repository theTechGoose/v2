/**
 * REQ-1113 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green." LOOP-007 cycle 3, issue
 * q3-38: "Remind dialog previews a text, but only an email with different
 * wording goes".
 *
 * In a browser: a customer with an email and a reserved 555-01XX phone
 * (843-555-0142), an invoice 10 days past due. On /customers/<id>, Remind's
 * dialog must name the email channel, show the email (its subject), and say
 * the number can't take texts — not preview a text that will never go.
 * Send → the toast says email only, and the Outbox holds one reminder email
 * and no refused ("not sent") text. Before the fix: the dialog previewed the
 * SMS body under "What Lucía will get:", the toast said "Reminder sent for
 * INV-001", and the Outbox showed a NOT TEXTED row.
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
    body: JSON.stringify({ language: "en", name: "Remind Untextable Story" }),
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

const iso = (days: number) =>
  new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

type Row = {
  id: string;
  createdAt: string;
  channel: string;
  status: string;
  kind: string;
  customerId?: string;
  docId?: string;
  subject?: string;
};

Deno.test("REQ-1113 (LOOP-007 q3-38): Remind for a customer with a reserved 555-01XX phone previews the email that goes, not a text, and the toast says email only", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: `Lucia Untextable ${digits()}`,
        email: "lucia@blackhole.postmarkapp.com",
        phoneNumber: "843-555-0142",
      }),
    })).json();
    expect(
      typeof customer.id === "string",
      `customer created (${JSON.stringify(customer)})`,
    );
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        jobName: "Roof patch REQ-1113",
        description: "Roof patch",
        lineItems: [{ description: "Roof patch", quantity: 1, price: 82067 }],
        amount: 82067,
        issuedDate: iso(-40),
        dueDate: iso(-10),
      }),
    })).json();
    expect(
      typeof inv.id === "string",
      `invoice created (${JSON.stringify(inv)})`,
    );

    await page.goto(`/customers/${customer.id}`);
    await page.locator(
      `[data-cy='customer-workspace'][data-customer='${customer.id}']`,
    ).waitFor({ timeout: 20_000 });
    const remind = page.locator("[data-cy='cws-remind']");
    await remind.waitFor({ timeout: 15_000 });
    const sheet = page.locator("[data-cy='send-dialog']");
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        await remind.click({ timeout: 2_000 });
      } catch {
        // not clickable yet (hydrating)
      }
      if (await sheet.isVisible()) break;
      await page.waitForTimeout(400);
    }
    const preview = page.locator("[data-cy='invoice-nudge-preview']");
    await preview.waitFor({ timeout: 15_000 });
    const previewText = (await preview.innerText()).trim();
    const dialogText = (await sheet.innerText()).trim();

    // the preview the backend would send, read the same way the dialog does
    const pv = await (await http("/api/cron/reminder-preview", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        invoiceId: inv.id,
        day: Number(await preview.getAttribute("data-day")),
      }),
    })).json();

    expect(
      /email/i.test(previewText) &&
        previewText.includes("lucia@blackhole.postmarkapp.com"),
      `the dialog names the channel: by email to lucia@… (preview: ${
        JSON.stringify(previewText)
      })`,
    );
    expect(
      /can.t receive texts/i.test(dialogText),
      `the dialog says the number can't take texts (dialog: ${
        JSON.stringify(dialogText)
      })`,
    );
    expect(
      !pv.smsBody,
      `the dialog must not preview a text that will never go (preview: ${
        JSON.stringify(previewText)
      }; backend smsBody: ${JSON.stringify(pv.smsBody)})`,
    );

    // the toast lives 4 s — longer than the harness's post-click screenshot
    // can take — so its text is read by a wait armed BEFORE the click
    const toastRead = page.locator("[data-cy='cws-toast']").textContent({
      timeout: 20_000,
    });
    await page.locator("[data-cy='send-keep']").click();
    const toastText = ((await toastRead) ?? "").trim();

    let rows: Row[] = [];
    for (let i = 0; i < 25; i++) {
      rows = (await (await http(`/api/outbox?customerId=${customer.id}`, {
        headers: auth,
      })).json()) as Row[];
      if (rows.some((r) => r.channel === "email")) break;
      await page.waitForTimeout(400);
    }
    const mail = rows.find((r) =>
      r.channel === "email" && r.kind === "reminder"
    );
    expect(
      !!mail,
      `the Outbox has the reminder email (${JSON.stringify(rows)})`,
    );
    expect(
      !!mail?.subject && previewText.includes(mail.subject),
      `the dialog previewed the email that went: subject ${
        JSON.stringify(mail?.subject)
      } (preview: ${JSON.stringify(previewText)})`,
    );
    expect.eq(
      rows.map((r) => `${r.channel}:${r.status}`).join(","),
      "email:sent",
      `one reminder email and no refused text in the Outbox (${
        JSON.stringify(rows)
      })`,
    );
    expect(
      /email/i.test(toastText),
      `the toast says the reminder went by email only (toast: ${
        JSON.stringify(toastText)
      })`,
    );
  }));
