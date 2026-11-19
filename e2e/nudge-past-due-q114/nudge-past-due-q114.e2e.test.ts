/**
 * REQ-938 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green." LOOP-007 cycle 1, issue q1-14:
 * "Overdue nudge and reminder send nothing for an invoice issued already past
 * due". In a browser: an invoice issued today with a due date 18 days gone;
 * the overdue card's "Send nudge" sends the customer a reminder, says so, and
 * the reminder is in the Outbox. Before the fix the card posted day 30 (the
 * owner-only alert), said "Already nudged today", and the Outbox held only
 * the original invoice email.
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
    body: JSON.stringify({ language: "en", name: "Invoice Story" }),
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

type Row = { id: string; channel: string; status: string; kind: string };

Deno.test("REQ-938 (LOOP-007 q1-14): Send nudge on an invoice issued 18 days past due sends the customer a reminder and the Outbox lists it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Dana Ruiz",
        email: "dana@blackhole.postmarkapp.com",
      }),
    })).json();
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        jobName: "Fence repair REQ-938",
        description: "Fence repair",
        lineItems: [{ description: "Fence repair", quantity: 1, price: 64000 }],
        amount: 64000,
        // REQ-962 (q1-39): a due date before the issue date is refused —
        // issued 48 days ago on 30-day terms, so 18 days past due
        issuedDate: iso(-48),
        dueDate: iso(-18),
      }),
    })).json();
    expect(typeof inv.id === "string", `invoice created (${inv.id})`);
    const before = (await (await http("/api/outbox", { headers: auth }))
      .json() as Row[]).filter((r) => r.kind === "reminder").length;

    await page.goto("/invoices");
    const card = page.locator(".qcard", {
      has: page.locator("[data-cy='invoice-card-job']", {
        hasText: "Fence repair REQ-938",
      }),
    });
    await card.waitFor({ timeout: 15_000 });
    const cta = card.locator("[data-cy='invoice-cta-overdue']");
    await cta.waitFor({ timeout: 15_000 });
    const ctaText = (await cta.innerText()).trim();
    expect(ctaText.startsWith("Send nudge"), `overdue CTA (${ctaText})`);

    const sent = page.waitForResponse(
      (r) => r.url().includes("/api/cron/invoice-reminder"),
      { timeout: 15_000 },
    );
    await cta.click();
    const res = await sent;
    expect.eq(res.status(), 200, "the reminder endpoint accepted it");
    const body = await res.json() as { day?: number; channels?: string[] };
    expect(
      Array.isArray(body.channels) && body.channels.includes("email"),
      `the reminder went out by email (${JSON.stringify(body)})`,
    );
    const note = card.locator("[data-cy='invoice-send-note']");
    await note.waitFor({ timeout: 15_000 });
    expect.eq((await note.innerText()).trim(), "Nudge sent", "the card says so");

    const after = (await (await http("/api/outbox", { headers: auth }))
      .json() as Row[]).filter((r) => r.kind === "reminder");
    expect.eq(after.length, before + 1, "one new reminder in the Outbox");
  }));
