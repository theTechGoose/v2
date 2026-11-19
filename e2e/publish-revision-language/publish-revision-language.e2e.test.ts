/**
 * REQ-937 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the
 * test, then one to fix it and make it green." LOOP-007 cycle 1, issue q1-4:
 * "Publish revision" re-sends a Spanish customer's quote in English.
 *
 * An English-UI owner sends Q-001 to Jose in Español (Version 1 goes out in
 * Spanish, ?lang=es). The quote is edited into Version 2; on /quotes the
 * owner clicks "Publish revision and notify customer" → Publish. Version 2
 * must reach Jose in Spanish too: the outbox email's subject is
 * "Cotización Q-…", its language "es", its link ?lang=es.
 *
 * Page: /quotes?open=<id> (islands/QuotesPage.tsx QuoteLedgerSection).
 * API: POST /api/quotes/:id/publish, GET /api/outbox, GET /api/outbox/:id.
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
        // REQ-925: the account sends in English and Spanish
        commsLanguages: ["en", "es"],
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

async function call(
  http: StoryTools["http"],
  auth: Record<string, string>,
  method: string,
  path: string,
  payload?: unknown,
) {
  const r = await http(path, {
    method,
    headers: auth,
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(`${method} ${path} → ${r.status} ${JSON.stringify(json)}`);
  }
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

type Row = {
  id: string;
  kind: string;
  channel: string;
  status: string;
  language: string;
  subject?: string;
};

Deno.test("REQ-937 (LOOP-007 q1-4): an English-UI owner publishes Version 2 of a quote sent in Español — 'Publish revision and notify customer' re-sends it in Spanish (subject 'Cotización', ?lang=es)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });

    // Jose has no language of his own: the owner picks Español for the send.
    const jose = await call(http, auth, "POST", "/api/customers", {
      name: "Jose Martinez",
      email: "jose@blackhole.postmarkapp.com",
      address: "18 Rosewood Ln, Austin, TX",
    });
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: jose.id,
      summary: "Fence repair and gate",
      jobName: "Fence Repair",
      lineItems: [{
        description: "Fence repair and gate",
        quantity: 1,
        unit: "job",
        price: 45000,
      }],
      estimatedTotal: 45000,
      status: "draft",
    });
    const conv = await call(http, auth, "POST", "/api/agents/conversations", {
      quoteId: quote.id,
      customerId: jose.id,
    });
    await call(
      http,
      auth,
      "POST",
      `/api/agents/conversations/${conv.id}/send-quote`,
      { quoteId: quote.id, channel: "email", language: "es" },
    );
    const sent = await call(http, auth, "GET", `/api/quotes/${quote.id}`);
    expect.eq(sent.lastDelivery?.lang, "es", "Version 1 went out in Español");
    const v1 = (await call(http, auth, "GET", "/api/outbox") as Row[])
      .filter((r) => r.kind === "quote" && r.channel === "email");
    expect.eq(v1.length, 1, "Version 1's email is in the outbox");
    expect.eq(v1[0].language, "es", "Version 1's email is Spanish");

    // Version 2: a new line waits as a pending revision.
    const edited = await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      lineItems: [...sent.lineItems, {
        description: "New gate latch",
        quantity: 1,
        unit: "ea",
        price: 6000,
      }],
      estimatedTotal: 51000,
    });
    expect(Boolean(edited.pendingRevision), "the edit waits as Version 2");

    // The owner publishes from /quotes, in their English UI.
    await page.goto(`/quotes?open=${quote.id}`);
    await page.locator("[data-cy='quote-publish']").waitFor({
      timeout: 20_000,
    });
    const preview = page.locator("[data-cy='quote-publish-preview']");
    await clickUntil(
      page,
      "[data-cy='quote-publish']",
      async () => (await preview.count()) > 0,
    );
    const note = page.locator("[data-cy='quote-published-note']");
    await clickUntil(
      page,
      "[data-cy='quote-publish-confirm']",
      async () => (await note.count()) > 0,
    );
    const published = await call(http, auth, "GET", `/api/quotes/${quote.id}`);
    expect.eq(published.version, 2, "Version 2 is published");

    // Version 2's email, as Jose got it.
    const quoteMails = (await call(http, auth, "GET", "/api/outbox") as Row[])
      .filter((r) => r.kind === "quote" && r.channel === "email");
    expect.eq(quoteMails.length, 2, "Version 2's email is in the outbox");
    const v2Row = quoteMails.find((r) => r.id !== v1[0].id)!;
    const v2 = await call(http, auth, "GET", `/api/outbox/${v2Row.id}`) as {
      subject?: string;
      language?: string;
      body: string;
    };
    expect.eq(v2Row.language, "es", "Version 2's email is Spanish, like V1");
    expect(
      /^Cotización Q-\d+ /.test(v2.subject ?? ""),
      `Version 2's subject is the Spanish one (${v2.subject})`,
    );
    expect(
      v2.body.includes('<html lang="es">'),
      "Version 2's email renders in Spanish",
    );
    expect(
      /[?&]lang=es\b/.test(v2.body),
      "Version 2's link opens the quote in Spanish (?lang=es)",
    );
  }));
