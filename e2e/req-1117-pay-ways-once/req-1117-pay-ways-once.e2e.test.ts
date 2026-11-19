/**
 * REQ-1117 (LOOP-007 cycle 3, q3-42) — "Invoice email lists the payment method twice". QA3 002: the
 * invoice email read "Payment instructions: Zelle: dana@whitfieldfence.com" and then "Ways to pay:
 * Zelle: send to dana@whitfieldfence.com". The invoice form fills Payment instructions from the
 * accepted methods ("Zelle: <handle>"), and the email's Ways-to-pay block lists the same methods.
 *
 * The check: a Zelle-only business sends an invoice whose payment instructions are what the form
 * filled in; the Outbox opens the email exactly as sent; the Zelle handle appears once.
 */
import { story, type StoryTools } from "#shots";

const HANDLE = "dana@whitfieldfence.com";
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
        businessName: "Whitfield Fence Co",
        acceptedPaymentMethods: {
          zelle: { enabled: true, handle: HANDLE },
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

Deno.test("REQ-1117 (q3-42): a sent invoice email for a Zelle business names the Zelle handle once — not under both Payment instructions and Ways to pay", (t) =>
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
      jobName: "Fence repair",
      amount: 6500,
      issuedDate: "2026-11-19",
      dueDate: "2026-11-30",
      // what the invoice form fills in from the methods (paymentInstructionsFromMethods)
      paymentInstructions: `Zelle: ${HANDLE}`,
    });
    await post(http, auth, `/api/invoices/${invoice.id}/email`, {});
    const listed = await (await http("/api/outbox", { headers: auth }))
      .json() as { id: string; kind: string; channel: string }[];
    const mail = listed.find((r) =>
      r.kind === "invoice" && r.channel === "email"
    );
    expect(
      !!mail,
      `the invoice email is in the outbox: ${JSON.stringify(listed)}`,
    );

    await page.goto("/messages");
    const frame = page.locator("iframe[data-cy='outbox-email-frame']");
    await page.locator(`[data-cy='outbox-row'][data-id='${mail!.id}']`).waitFor(
      {
        timeout: 20_000,
      },
    );
    await clickUntil(
      page,
      `[data-cy='outbox-row'][data-id='${mail!.id}'] [data-cy='outbox-open']`,
      async () => (await frame.count()) > 0,
    );
    const email = page.frameLocator("iframe[data-cy='outbox-email-frame']");
    await email.locator("[data-pay-way='zelle']").waitFor({ timeout: 15_000 });
    const text = await email.locator("body").innerText();
    const handleCount = text.split(HANDLE).length - 1;
    const instructionsBlocks = await email.locator(
      "[data-payment-instructions]",
    ).count();
    expect.eq(
      { handleCount, instructionsBlocks },
      { handleCount: 1, instructionsBlocks: 0 },
      `the invoice email lists Zelle twice (Payment instructions + Ways to pay): ${
        JSON.stringify(text)
      }`,
    );
  }));
