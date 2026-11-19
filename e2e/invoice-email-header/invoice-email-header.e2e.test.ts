/**
 * REQ-980 (LOOP-007 q1, q1-61) — QA (QA3 002, QA5 002, QA4 003): the amount-only invoice email
 * said "Drafted November 19, 2026" in its header right above "Issued November 19, 2026", and its
 * "Ways to pay" block listed only Zelle although "Payment instructions" read "Check · Zelle".
 *
 * The check: a business that takes Check and Zelle sends a standalone invoice by email; the
 * Outbox opens the email exactly as sent; its header labels the date "Issued" (never "Drafted")
 * and its "Ways to pay" block names Check as well as Zelle.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
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
      ["/api/me", { name: "Luis Ortega", language: "en" }],
      ["/api/profile/identity", {
        businessName: "Ortega Handyman Services",
        acceptedPaymentMethods: {
          check: { enabled: true, mailTo: "PO Box 1" },
          zelle: { enabled: true, handle: "5125550109" },
        },
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

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  payload: unknown,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(payload),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch {
      // not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

Deno.test("REQ-980 (q1-61): a sent standalone invoice email (Check + Zelle) — the header date is 'Issued', not 'Drafted', and Ways to pay names Check as well as Zelle", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    const ana = await post(http, auth, "/api/customers", {
      name: "Ana Torres",
      email: "ana@blackhole.postmarkapp.com",
    });
    const invoice = await post(http, auth, "/api/invoices", {
      customerId: ana.id,
      status: "sent",
      jobName: "Lawn care",
      amount: 6500,
      issuedDate: "2026-11-19",
      dueDate: "2026-11-30",
    });
    await post(http, auth, `/api/invoices/${invoice.id}/email`, {});
    const listed = await (await http("/api/outbox", { headers: auth }))
      .json() as { id: string; kind: string; channel: string }[];
    const mail = listed.find((r) => r.kind === "invoice" && r.channel === "email");
    expect(!!mail, `the invoice email is in the outbox: ${JSON.stringify(listed)}`);

    await page.goto("/messages");
    const frame = page.locator("iframe[data-cy='outbox-email-frame']");
    await page.locator(`[data-cy='outbox-row'][data-id='${mail!.id}']`).waitFor({
      timeout: 20_000,
    });
    await clickUntil(
      page,
      `[data-cy='outbox-row'][data-id='${mail!.id}'] [data-cy='outbox-open']`,
      async () => (await frame.count()) > 0,
    );
    const email = page.frameLocator("iframe[data-cy='outbox-email-frame']");
    const text = await email.locator("body").innerText();
    const header = text.slice(0, text.indexOf("Ana") > 0 ? text.indexOf("Ana") : 400);
    expect(
      !/drafted/i.test(header),
      `the sent invoice's header says Drafted: ${JSON.stringify(header)}`,
    );
    expect(/issued/i.test(header), `the header labels its date Issued: ${JSON.stringify(header)}`);
    expect.eq(
      await email.locator("[data-pay-way='zelle']").count(),
      1,
      "Zelle is a way to pay",
    );
    const waysHeading = /ways to pay/i.test(text);
    expect(
      !waysHeading || (await email.locator("[data-pay-way='check']").count()) === 1,
      "the 'Ways to pay' block names Check, which the business accepts (Payment instructions: Check · Zelle)",
    );
  }));
