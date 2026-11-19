/**
 * REQ-946 — Raphael: "test every single aspect of this application … one Opus
 * agent per issue to do root cause analysis, then one to write the test, then
 * one to fix it and make it green." LOOP-007 cycle 1, q1-19: "Single-line
 * quote email has no work description, though its intro promises line items
 * below."
 *
 * The tester's Q-002 "Cambio de piso de cocina" ($3,450, one qty-1 line, no
 * description) went out with "Lectura rápida — las partidas abajo…" and then
 * straight to the total: the work was named 0 times in the email. The check:
 * email that quote to a Spanish-speaking customer, open it from the Outbox,
 * and read the work in the email she got.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const LINE = "Cambio de piso de cocina";

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
      ["/api/me", { name: "Luis Ortega", language: "es" }],
      ["/api/profile/identity", {
        businessName: "Pisos Ortega LLC",
        commsLanguage: "es",
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

type Row = { id: string; channel: string; kind: string };

Deno.test("REQ-946 (q1-19): a one-line qty-1 quote with no description, emailed in Spanish, names its work in the email she gets (opened from the Outbox)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });

    const maria = await post(http, auth, "/api/customers", {
      name: "María López",
      email: "maria@blackhole.postmarkapp.com",
      language: "es",
    });
    // the assistant / quick-quote shape: the scope is the one line, no description
    const quote = await post(http, auth, "/api/quotes", {
      customerId: maria.id,
      summary: "Cocina",
      lineItems: [{
        description: LINE,
        quantity: 1,
        unit: "job",
        price: 345_000,
      }],
      estimatedTotal: 345_000,
      status: "draft",
    });
    await post(http, auth, `/api/quotes/${quote.id}/email`, {});

    const listed = await (await http("/api/outbox", { headers: auth }))
      .json() as Row[];
    const mail = listed.find((r) =>
      r.kind === "quote" && r.channel === "email"
    );
    expect(!!mail, "the quote email is in the Outbox");
    const sent = await (await http(`/api/outbox/${mail!.id}`, {
      headers: auth,
    })).json() as { body: string };
    expect(
      sent.body.includes("las partidas abajo"),
      "the intro promises the line items below",
    );

    await page.goto("/messages");
    const frame = page.locator("iframe[data-cy='outbox-email-frame']");
    await page.locator(`[data-cy='outbox-row'][data-id='${mail!.id}']`)
      .waitFor({ timeout: 20_000 });
    await clickUntil(
      page,
      `[data-cy='outbox-row'][data-id='${mail!.id}'] [data-cy='outbox-open']`,
      async () => (await frame.count()) > 0,
    );
    const inFrame = await page.frameLocator(
      "iframe[data-cy='outbox-email-frame']",
    ).locator("body").innerText();
    expect(inFrame.includes("María"), "the email greets María");
    expect(
      inFrame.includes(LINE),
      `the email she got names the work "${LINE}" (it went from the intro straight to the total)`,
    );
    // the label sits in a text-transform:uppercase div and innerText returns
    // the rendered "ESTO ES LO QUE HAREMOS", so compare case-insensitively
    expect(
      inFrame.toLowerCase().includes("esto es lo que haremos"),
      "the email has its line-item block",
    );
  }));
