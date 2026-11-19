/**
 * REQ-1078 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the test,
 * then one to fix it and make it green." LOOP-007 cycle 2, issue q2-66
 * [polish/BUG_CONTRADICTION] "Outbox counts a refused text as 'Sent to
 * customers'; receipt was tried by text on an email-only send".
 *
 * QA's path: Rosa Delgado has an email and the reserved cell 843-555-0111.
 * Her invoice is sent Email only, then a part payment is recorded. The outbox
 * now holds the invoice email, the receipt email and the receipt text that
 * was refused (a 555 number — "Not texted"). The panel heading over that list
 * read "Sent to customers 3": the refused text counted as sent.
 *
 * The rule: the heading never claims more were sent than went — read the
 * heading and the count in one page.evaluate, and the 2 that went are what a
 * "sent" count shows.
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

type Row = { id: string; channel: string; status: string; kind: string };

Deno.test("REQ-1078 (LOOP-007 q2, q2-66): after an Email-only invoice and a part payment to Rosa (555 cell), the Outbox heading does not count the refused receipt text as sent", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });

    const rosa = await post(http, auth, "/api/customers", {
      name: "Rosa Delgado",
      email: "rosa@blackhole.postmarkapp.com",
      phoneNumber: "(843) 555-0111",
      language: "en",
    });
    const invoice = await post(http, auth, "/api/invoices", {
      customerId: rosa.id,
      jobName: "Deck repair",
      amount: 80000,
      dueDate: "2026-12-30",
    });
    // Email only
    await post(http, auth, `/api/invoices/${invoice.id}/email`, {});
    // a part payment → the receipt
    await post(http, auth, "/api/payments", {
      invoiceId: invoice.id,
      amount: 30000,
      method: "zelle",
      receivedAt: new Date().toISOString(),
    });

    // wait until the receipt's rows are recorded
    let listed: Row[] = [];
    for (let i = 0; i < 40; i++) {
      listed = await (await http("/api/outbox", { headers: auth }))
        .json() as Row[];
      if (listed.some((r) => r.kind === "receipt" && r.channel === "email")) {
        break;
      }
      await page.waitForTimeout(250);
    }
    const sent = listed.filter((r) => r.status === "sent").length;
    const notSent = listed.filter((r) => r.status !== "sent").length;
    const summary = listed.map((r) => `${r.kind}:${r.channel}:${r.status}`)
      .sort().join(" ");
    // the state QA saw: 2 went, 1 refused text
    expect(
      notSent >= 1 && sent >= 1,
      `QA's state — some sent, some not: ${summary}`,
    );

    await page.goto("/messages");
    await page.locator("[data-cy='outbox-row']").nth(listed.length - 1)
      .waitFor({ timeout: 20_000 });
    // heading + count read together, in one round trip
    const title = await page.evaluate(() => {
      const count = document.querySelector("[data-cy='outbox-count']");
      const panel = count?.closest(".panel__title") ??
        document.querySelector(".panel__title");
      return (panel?.textContent ?? "").replace(/\s+/g, " ").trim();
    });
    const numbers = [...title.matchAll(/\d+/g)].map((m) => Number(m[0]));
    expect(
      !(/\bsent\b/i.test(title) && numbers.includes(listed.length) &&
        !numbers.includes(sent)),
      `the heading "${title}" counts all ${listed.length} rows as sent (${summary})`,
    );
    expect(
      numbers.includes(sent),
      `the heading "${title}" shows the ${sent} that went (${summary})`,
    );
  }));
