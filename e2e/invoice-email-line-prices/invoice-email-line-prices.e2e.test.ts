/**
 * REQ-1127 (LOOP-007 q3, q3-55) — QA (008-email): a standalone invoice made of two service rows
 * (REQ-921: "Gate repair" $180.10 + "Hinge hardware" $45.20, jobName = the joined names) was
 * emailed, and the email showed "Gate repair, Hinge hardware" and only the $225.30 subtotal —
 * no line prices, while the same invoice's /i page and PDF list both.
 *
 * The check: create that invoice the way the New invoice form saves it, send it by email, open
 * the email from the Outbox exactly as sent, and find both line prices in the frame.
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
      ["/api/me", { name: "Dana Whitfield", language: "en" }],
      ["/api/profile/identity", {
        businessName: "Whitfield Fence & Gate",
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

Deno.test("REQ-1127 (q3-55): the emailed standalone two-service invoice shows each line's price ($180.10, $45.20), not only the $225.30 subtotal", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    const rosa = await post(http, auth, "/api/customers", {
      name: "Rosa Delgado",
      email: "rosa@blackhole.postmarkapp.com",
    });
    // the New invoice form's (REQ-921) payload: service rows, jobName = joined names, no quote
    const invoice = await post(http, auth, "/api/invoices", {
      customerId: rosa.id,
      status: "sent",
      jobName: "Gate repair, Hinge hardware",
      lineItems: [
        { description: "Gate repair", quantity: 1, unit: "ea", price: 18010 },
        { description: "Hinge hardware", quantity: 1, unit: "ea", price: 4520 },
      ],
      amount: 22530,
      subtotalCents: 22530,
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
    await email.locator("body").waitFor({ timeout: 10_000 });
    const text = (await email.locator("body").innerText()).replace(/\s+/g, " ");
    expect(text.includes("$225.30"), `the amount due is in the email: ${JSON.stringify(text.slice(0, 800))}`);
    expect(
      text.includes("$180.10"),
      `the "Gate repair" line's price $180.10 is in the email: ${JSON.stringify(text.slice(0, 800))}`,
    );
    expect(
      text.includes("$45.20"),
      `the "Hinge hardware" line's price $45.20 is in the email: ${JSON.stringify(text.slice(0, 800))}`,
    );
  }));
