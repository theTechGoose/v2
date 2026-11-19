/**
 * REQ-945 (LOOP-007 cycle 1, q1-20) — Raphael: "test every single aspect of
 * this application … one Opus agent per issue to do root cause analysis, then
 * one to write the test, then one to fix it and make it green."
 *
 * q1-20 "Quote email never mentions the deposit and has no PDF": QA sent a
 * quote on a deposit plan and the customer's email carried only the total;
 * the $1,200 deposit first appeared on the /q page's Payment schedule.
 *
 * The check: a $2,400 quote on "Deposit 50% + balance" is sent by email from
 * its conversation; the /q page's Payment schedule shows the deposit; the
 * email in the Outbox (exactly as sent) states that same deposit amount and
 * when it is due. (The PDF attachment is not recorded by the Outbox, so it is
 * proven at the integration level — send-paperwork-email/int.test.ts.)
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
      ["/api/profile/identity", { businessName: "Ortega Handyman Services" }],
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

Deno.test("REQ-945 q1-20: a deposit quote's email states the same deposit the /q Payment schedule shows", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });

    const pat = await post(http, auth, "/api/customers", {
      name: "Pat Doe",
      email: "pat@blackhole.postmarkapp.com",
      language: "en",
    });
    const quote = await post(http, auth, "/api/quotes", {
      customerId: pat.id,
      summary: "Panel upgrade",
      jobName: "Panel Upgrade",
      lineItems: [{
        description: "Panel upgrade",
        quantity: 1,
        unit: "job",
        price: 240000,
      }],
      estimatedTotal: 240000,
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "Deposit 50% + balance",
      }],
      status: "draft",
    });
    const conv = await post(http, auth, "/api/agents/conversations", {
      quoteId: quote.id,
      customerId: pat.id,
    });
    await post(http, auth, `/api/agents/conversations/${conv.id}/send-quote`, {
      quoteId: quote.id,
      channel: "email",
    });

    // what the customer sees on /q: the deposit box of the Payment schedule
    await page.goto(`/q/${quote.id}`);
    const schedule = page.locator(".ctr__milestones");
    await schedule.waitFor({ timeout: 20_000 });
    const scheduleText = (await schedule.innerText()).replace(/\s+/g, " ");
    expect(
      scheduleText.includes("$1,200.00"),
      `/q shows the $1,200.00 deposit: ${scheduleText}`,
    );

    // what the customer was emailed — the Outbox holds it exactly as sent
    const listed = await (await http("/api/outbox", { headers: auth }))
      .json() as { id: string; kind: string; channel: string }[];
    const mail = listed.find((r) => r.kind === "quote" && r.channel === "email");
    expect(!!mail, "the quote email is in the Outbox");
    const opened = await (await http(`/api/outbox/${mail!.id}`, {
      headers: auth,
    })).json() as { body: string };
    await page.setContent(opened.body);
    const emailText = (await page.locator("body").innerText()).replace(
      /\s+/g,
      " ",
    );
    expect(
      emailText.includes("$1,200.00"),
      `the email states the $1,200.00 deposit the /q page shows: ${
        emailText.slice(0, 600)
      }`,
    );
    expect(
      // REQ-954 (q1-26): before signing the deposit row states the rule
      // that sets its date, as /q does
      emailText.includes("Due a week after signing"),
      "the email says the deposit is due a week after signing",
    );
  }));
