/**
 * REQ-704 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issue m60: "Reminders: no
 * before-due option, no preview, wording disagrees with Settings".
 *
 * In a browser: Settings offers "3 days before due" and "Due date" chips (off
 * by default) and labels day 30 "alerts you"; picking "3 days before due"
 * saves -3. The invoice detail says "Reminders to Ana Ruiz: 3 days before due
 * · days 3, 7, 14 after due · day 30 we alert you". Flipping a sent invoice
 * card shows the reminder text before "Send a nudge", and the nudge sends
 * that before-due reminder.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Cadence Story" }),
  })).body?.cancel();
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ businessName: "Cadence Roofing" }),
  })).body?.cancel();
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

/** Click until `done` holds — a click before hydration is a no-op, so retry it (house clickUntil). */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).click({ timeout: 2_000 });
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

type Reminders = { enabled?: boolean; days?: number[] } | undefined;
async function savedReminders(
  http: StoryTools["http"],
  auth: Record<string, string>,
): Promise<Reminders> {
  const snap = await (await http("/api/profile", { headers: auth })).json() as {
    identity?: { reminders?: Reminders };
  };
  return snap.identity?.reminders;
}

const BEFORE = "[data-cy='settings-reminders-day--3']";
const DUE = "[data-cy='settings-reminders-day-0']";

Deno.test("REQ-704: reminders can go out before the due date, the detail splits out day 30, and a nudge shows its text first (demo cycle 5, m60)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.goto("/settings");
    await page.locator(BEFORE).waitFor({ timeout: 30_000 });
    await expect.see("3 days before due");
    await expect.see("Due date");
    await expect.see("Day 30 · alerts you");
    expect.eq(
      await page.locator(BEFORE).getAttribute("aria-pressed"),
      "false",
      "before-due is opt-in",
    );
    expect.eq(
      await page.locator(DUE).getAttribute("aria-pressed"),
      "false",
      "due-date is opt-in",
    );

    await clickUntil(
      page,
      BEFORE,
      async () =>
        (await page.locator(BEFORE).getAttribute("aria-pressed")) === "true",
    );
    await page.waitForTimeout(500);
    expect.eq(
      JSON.stringify((await savedReminders(http, auth))?.days),
      JSON.stringify([-3, 3, 7, 14, 30]),
      "the cadence saved with 3 days before due",
    );

    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Ana Ruiz",
        email: "ana@blackhole.postmarkapp.com",
      }),
    })).json();
    const day = (n: number) =>
      new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        issuedDate: day(0),
        jobName: "Gutter repair REQ-704",
        dueDate: day(14),
        lineItems: [{
          description: "Gutter repair",
          quantity: 1,
          unit: "job",
          price: 32000,
        }],
        amount: 32000,
      }),
    })).json();

    // the detail: customer steps, then day 30 split out as owner-only
    await page.goto(`/invoices?open=${inv.id}`);
    const row = page.locator("[data-cy='invoice-detail-reminders']");
    await row.waitFor({ timeout: 30_000 });
    expect.eq(
      (await row.locator("span").first().innerText()).trim(),
      "Reminders to Ana Ruiz: 3 days before due · days 3, 7, 14 after due · day 30 we alert you",
      "the detail names who gets what",
    );

    // the card: the reminder text shows before "Send a nudge"
    await page.goto("/invoices");
    const card = page.locator(".qcard", {
      has: page.locator("[data-cy='invoice-card-job']", {
        hasText: "Gutter repair REQ-704",
      }),
    });
    await card.waitFor({ timeout: 15_000 });
    const preview = card.locator("[data-cy='invoice-nudge-preview']");
    await clickUntil(
      page,
      ".qcard:has-text('Gutter repair REQ-704')",
      async () => (await preview.count()) > 0,
    );
    expect.eq(
      await preview.getAttribute("data-day"),
      "-3",
      "a not-yet-due invoice previews the before-due step",
    );
    const text =
      (await card.locator("[data-cy='invoice-nudge-preview-text']").innerText())
        .trim();
    expect(
      text.startsWith("Hi Ana, friendly reminder"),
      `the preview is the customer's text (${text})`,
    );
    expect(text.includes("is due soon"), `before-due copy (${text})`);
    await expect.see("What Ana Ruiz will get:");

    const sent = page.waitForResponse(
      (r) => r.url().endsWith("/api/cron/invoice-reminder"),
      { timeout: 15_000 },
    );
    await card.locator("[data-cy='invoice-nudge']").click();
    const res = await sent;
    expect.eq(
      JSON.parse(res.request().postData() ?? "{}").day,
      -3,
      "the nudge sends the before-due step",
    );
    const out = await res.json() as { channels?: string[] };
    expect(
      Array.isArray(out.channels) && out.channels.includes("email"),
      `sent by email (${JSON.stringify(out)})`,
    );
    await card.locator("[data-cy='invoice-send-note']").waitFor({
      timeout: 15_000,
    });
  }));
