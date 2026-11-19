/**
 * REQ-1112 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green." LOOP-007 cycle 3, issue q3-37:
 * "'Send nudge' on the overdue card emails the customer in one click with no
 * preview".
 *
 * In a browser: a customer with an email, an invoice emailed to her and now
 * 10 days past due. On /invoices the overdue card's "Send nudge" — the front
 * face's invoice-cta-overdue and the back face's invoice-back-cta-overdue —
 * must open the nudge dialog (send-dialog with the reminder preview) and POST
 * nothing. Cancel: still nothing sent, the Outbox unchanged. Again + Send:
 * exactly one reminder email lands in the Outbox. Before the fix the first
 * tap POSTed /api/cron/invoice-reminder straight away (ctaAction →
 * doSendNudge), with no preview and no way back.
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
    body: JSON.stringify({ language: "en", name: "Nudge Confirm Story" }),
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

const REMINDER_PATH = /\/api\/cron\/invoice-reminder$/;

async function nudgeConfirms(
  { page, expect, http, baseUrl }: StoryTools,
  face: "front" | "back",
) {
  const { auth } = await signIn(http, page, baseUrl);
  await page.setViewportSize({ width: 1280, height: 900 });
  const job = `Porch paint REQ-1112 ${face} ${digits()}`;
  const customer = await (await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: `Greg Pruitt ${digits()}`,
      email: "greg@blackhole.postmarkapp.com",
    }),
  })).json();
  const inv = await (await http("/api/invoices", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId: customer.id,
      status: "sent",
      jobName: job,
      description: "Porch paint",
      lineItems: [{ description: "Porch paint", quantity: 1, price: 52000 }],
      amount: 52000,
      // issued 40 days ago on 30-day terms → 10 days past due
      issuedDate: iso(-40),
      dueDate: iso(-10),
    }),
  })).json();
  expect(
    typeof inv.id === "string",
    `invoice created (${JSON.stringify(inv)})`,
  );
  const first = await http(`/api/invoices/${inv.id}/email`, {
    method: "POST",
    headers: auth,
    body: JSON.stringify({}),
  });
  expect.eq(first.status, 200, "the invoice's first email went");
  await first.body?.cancel();

  const outboxOf = async () =>
    ((await (await http("/api/outbox", { headers: auth })).json()) as Row[])
      .filter((r) => r.customerId === customer.id && r.channel === "email");
  const before = await outboxOf();

  const posts: string[] = [];
  page.on("request", (r) => {
    if (r.method() !== "POST") return;
    const p = new URL(r.url()).pathname;
    if (REMINDER_PATH.test(p)) posts.push(p);
  });

  await page.goto("/invoices");
  const card = page.locator(".qcard", {
    has: page.locator("[data-cy='invoice-card-job']", { hasText: job }),
  });
  await card.waitFor({ timeout: 20_000 });
  const front = card.locator("[data-cy='invoice-cta-overdue']");
  expect.eq(await front.count(), 1, "the card is an overdue card");

  const cy = face === "front"
    ? "invoice-cta-overdue"
    : "invoice-back-cta-overdue";
  const button = card.locator(`[data-cy='${cy}']`);
  const flipped = async () =>
    /\bqcard--flipped\b/.test((await card.getAttribute("class")) ?? "");
  /** flip to the back face (the island may still be hydrating) */
  async function flip() {
    for (let i = 0; i < 25 && !(await flipped()); i++) {
      try {
        await card.locator(".qcard__mood").click({ timeout: 1_000 });
      } catch {
        // not clickable yet
      }
      await page.waitForTimeout(400);
    }
    expect(await flipped(), "the card flipped to its back face");
    await page.waitForTimeout(800); // the flip transition
  }
  if (face === "back") await flip();

  const dialog = page.locator("[data-cy='send-dialog']");
  /** click the nudge until it does something (sent, or opened its dialog) */
  async function tapNudge() {
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        await button.click({ timeout: 2_000 });
      } catch {
        // not clickable yet
      }
      for (let i = 0; i < 5; i++) {
        if (posts.length > 0 || await dialog.isVisible()) return;
        await page.waitForTimeout(200);
      }
    }
  }

  await tapNudge();
  await page.waitForTimeout(1_000); // let a one-tap send's POST land
  expect.eq(
    posts.length,
    0,
    `the ${face} 'Send nudge' must not email the customer in one tap — it POSTed /api/cron/invoice-reminder ${posts.length}x with no preview`,
  );
  expect(
    await dialog.isVisible(),
    `the ${face} 'Send nudge' opens the nudge dialog (flipped: ${await flipped()}, posts: ${posts.length})`,
  );
  const preview = dialog.locator("[data-cy='invoice-nudge-preview']");
  await preview.waitFor({ timeout: 15_000 });
  const previewText = (await preview.innerText()).trim();
  expect(
    /will get/i.test(previewText),
    `the dialog shows what the customer will get ("${previewText}")`,
  );

  // Cancel: nothing sent, the Outbox unchanged
  await dialog.locator("[data-cy='send-cancel']").click();
  await dialog.waitFor({ state: "hidden", timeout: 10_000 });
  await page.waitForTimeout(1_000);
  expect.eq(posts.length, 0, "Cancel sends nothing");
  expect.eq(
    (await outboxOf()).length,
    before.length,
    "Cancel leaves the Outbox as it was",
  );

  // again, then Send: exactly one reminder email
  if (face === "back") await flip();
  await tapNudge();
  await dialog.waitFor({ timeout: 10_000 });
  const sent = page.waitForResponse(
    (r) => REMINDER_PATH.test(new URL(r.url()).pathname),
    { timeout: 20_000 },
  );
  await dialog.locator("[data-cy='send-keep']").click();
  const res = await sent;
  expect.eq(res.status(), 200, "the reminder endpoint accepted it");
  let after: Row[] = [];
  for (let i = 0; i < 25; i++) {
    after = await outboxOf();
    if (after.length > before.length) break;
    await page.waitForTimeout(400);
  }
  await page.waitForTimeout(1_000);
  after = await outboxOf();
  const fresh = after.filter((r) => !before.some((b) => b.id === r.id));
  expect.eq(
    fresh.length,
    1,
    `exactly one new email (${JSON.stringify(fresh)})`,
  );
  expect.eq(
    fresh[0]?.kind,
    "reminder",
    `it is a reminder (${JSON.stringify(fresh[0])})`,
  );
  expect.eq(posts.length, 1, "one POST to /api/cron/invoice-reminder in all");
}

Deno.test("REQ-1112 (LOOP-007 q3, q3-37): the overdue card's front 'Send nudge' (invoice-cta-overdue) shows the preview and asks before it emails", (t) =>
  story(t, (tools) => nudgeConfirms(tools, "front")));

Deno.test("REQ-1112 (LOOP-007 q3, q3-37): the overdue card's back 'Send nudge' (invoice-back-cta-overdue) shows the preview and asks before it emails", (t) =>
  story(t, (tools) => nudgeConfirms(tools, "back")));
