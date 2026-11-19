/**
 * REQ-1109 — LOOP-007 cycle 3, q3-35: the reminder the customer gets drops
 * the trailing cent zero ("$1,000.5"). In a browser: a sent $1,000.50
 * invoice card, flipped, previews the reminder text, and "Send a nudge"
 * sends the email the Outbox keeps — both must read $1,000.50.
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

Deno.test("REQ-1109 (LOOP-007 q3-35): a $1,000.50 invoice's reminder preview and the sent nudge email read $1,000.50, never $1,000.5", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
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
        jobName: "Deck stain REQ-1109",
        dueDate: day(14),
        lineItems: [{
          description: "Deck stain",
          quantity: 1,
          unit: "job",
          price: 100050,
        }],
        amount: 100050,
      }),
    })).json();
    expect(typeof inv.id === "string", `invoice created (${inv.id})`);

    await page.goto("/invoices");
    const card = page.locator(".qcard", {
      has: page.locator("[data-cy='invoice-card-job']", {
        hasText: "Deck stain REQ-1109",
      }),
    });
    await card.waitFor({ timeout: 15_000 });
    const previewText = card.locator("[data-cy='invoice-nudge-preview-text']");
    await clickUntil(
      page,
      ".qcard:has-text('Deck stain REQ-1109')",
      async () => (await previewText.count()) > 0,
    );
    const text = (await previewText.innerText()).trim();

    const sent = page.waitForResponse(
      (r) => r.url().endsWith("/api/cron/invoice-reminder"),
      { timeout: 15_000 },
    );
    await card.locator("[data-cy='invoice-nudge']").click();
    const res = await sent;
    expect.eq(res.status(), 200, "the nudge was accepted");
    await res.body().catch(() => undefined);

    const rows = await (await http("/api/outbox", { headers: auth }))
      .json() as Array<{ id: string }>;
    const bodies: string[] = [];
    for (const row of rows) {
      const one = await (await http(`/api/outbox/${row.id}`, { headers: auth }))
        .json() as { body?: string };
      bodies.push(String(one.body ?? ""));
    }
    const mail = bodies.find((b) => b.includes("$1,000.5")) ?? "";
    expect(
      mail !== "",
      `the nudge email is in the outbox (${rows.length} rows)`,
    );

    expect(
      text.includes("$1,000.50"),
      `the reminder preview reads $1,000.50 (${text})`,
    );
    expect(
      mail.includes("$1,000.50"),
      `the sent nudge email reads $1,000.50 (${
        mail.match(/\$[\d,.]+/g)?.join(" ")
      })`,
    );
  }));
