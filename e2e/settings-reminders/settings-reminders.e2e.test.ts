/**
 * REQ-623 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4, issue M26: "No payment-reminder settings
 * (cadence/on-off)" — Settings had no reminder cadence or on/off switch.
 *
 * In a browser: /settings shows a "Payment reminders" card, on, with the
 * Day 3 / 7 / 14 / 30 chips pressed. Tapping Day 3 saves [7, 14, 30];
 * switching reminders off saves enabled:false and says so. The invoice detail
 * of a sent invoice says reminders are off for all invoices; with reminders
 * back on it names the cadence and its own mute button mutes the invoice.
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
    body: JSON.stringify({ language: "en", name: "Reminder Story" }),
  })).body?.cancel();
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ businessName: "Reminder Roofing" }),
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

const CARD = "[data-cy='settings-reminders']";
const SWITCH = "[data-cy='settings-reminders-enabled']";
const DAY3 = "[data-cy='settings-reminders-day-3']";
const ROW = "[data-cy='invoice-detail-reminders']";

Deno.test("REQ-623: Settings has a payment-reminders on/off switch and cadence chips; the invoice detail shows the state and its own mute (demo cycle 4, M26)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.goto("/settings");
    await page.locator(CARD).waitFor({ timeout: 30_000 });
    await expect.see("Payment reminders");
    expect.eq(await page.locator(SWITCH).isChecked(), true, "on by default");
    for (const d of [3, 7, 14, 30]) {
      expect.eq(
        await page.locator(`[data-cy='settings-reminders-day-${d}']`)
          .getAttribute("aria-pressed"),
        "true",
        `Day ${d} is pressed by default`,
      );
    }

    // drop Day 3 from the cadence
    await clickUntil(
      page,
      DAY3,
      async () =>
        (await page.locator(DAY3).getAttribute("aria-pressed")) === "false",
    );
    await page.waitForTimeout(500);
    expect.eq(
      JSON.stringify((await savedReminders(http, auth))?.days),
      JSON.stringify([7, 14, 30]),
      "the cadence saved without Day 3",
    );

    // switch reminders off
    await clickUntil(
      page,
      SWITCH,
      async () => !(await page.locator(SWITCH).isChecked()),
    );
    await page.locator("[data-cy='settings-reminders-off']").waitFor({
      timeout: 10_000,
    });
    await page.waitForTimeout(500);
    expect.eq(
      (await savedReminders(http, auth))?.enabled,
      false,
      "reminders saved off",
    );

    // the invoice detail says reminders are off for every invoice
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
        jobName: "Gutter repair",
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
    await page.goto(`/invoices?open=${inv.id}`);
    await page.locator(ROW).waitFor({ timeout: 30_000 });
    expect.eq(
      await page.locator(ROW).getAttribute("data-state"),
      "off",
      "the detail says reminders are off",
    );
    await expect.see("Automatic reminders are off for all invoices");

    // back on: the detail names the cadence and mutes this invoice alone
    await (await http("/api/profile/identity", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ reminders: { enabled: true, days: [7, 14, 30] } }),
    })).body?.cancel();
    await page.reload();
    await page.locator(ROW).waitFor({ timeout: 30_000 });
    expect.eq(
      await page.locator(ROW).getAttribute("data-state"),
      "on",
      "the detail says reminders are on",
    );
    await expect.see("days 7, 14, 30 past due");
    await clickUntil(
      page,
      "[data-cy='invoice-detail-mute']",
      async () =>
        (await page.locator(ROW).getAttribute("data-state")) === "muted",
    );
    await expect.see("muted for this invoice");
    const after = await (await http(`/api/invoices/${inv.id}`, {
      headers: auth,
    })).json() as { remindersMuted?: boolean };
    expect.eq(after.remindersMuted, true, "the invoice is muted");
  }));
