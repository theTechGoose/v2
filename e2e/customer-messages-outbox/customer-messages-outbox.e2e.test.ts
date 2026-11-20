/**
 * REQ-989 (LOOP-007 q1, q1-72) — "Customer's Mensajes tab shows none of the emails sent to her".
 * The tester saw the Outbox list 2 emails to Linda Pérez while her page's Messages tab only pitched
 * getting a phone line. The check: with no phone line provisioned, email an invoice to Linda (she has
 * a phone on file) and to Carla (no phone on file), and one to Bob; open each one's page → Messages:
 * her email is a row there (`cws-outbox-row` with the outbox entry's id, naming the invoice), Bob's is
 * not; the get-a-line pitch, if shown, never takes the history's place.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(http: StoryTools["http"], page: StoryTools["page"], baseUrl: string) {
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
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  for (
    const [path, payload] of [
      ["/api/me", { name: "Luis Ortega", language: "en" }],
      ["/api/profile/identity", { businessName: "Ortega Handyman Services" }],
    ] as const
  ) {
    await (await http(path, { method: "PUT", headers: auth, body: JSON.stringify(payload) })).body?.cancel();
  }
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
  return auth;
}

async function post(http: StoryTools["http"], auth: Record<string, string>, url: string, body: unknown) {
  const r = await http(url, { method: "POST", headers: auth, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

type Row = { id: string; customerId?: string; channel: string; kind: string; docRef?: string };

Deno.test("REQ-989 q1-72: with no phone line, a customer's Messages tab lists the emails sent to her (phone on file or not), never another customer's", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    const tag = digits();

    const line = await (await http("/api/communications/line", { headers: auth })).json().catch(() => ({}));
    expect(!line?.line, `the account has no phone line (${JSON.stringify(line)})`);

    const mk = (name: string, extra: Record<string, unknown>) =>
      post(http, auth, "/api/customers", {
        name: `${name} ${tag}`,
        // REQ-1149: one email per customer — a second customer on Linda's address is a possible duplicate (409)
        email: `${name.split(" ")[0].toLowerCase()}@blackhole.postmarkapp.com`,
        ...extra,
      });
    const linda = await mk("Linda Pérez", { phoneNumber: "(512) 555-0188" });
    const carla = await mk("Carla Nophone", {});
    const bob = await mk("Bob Other", { phoneNumber: "(512) 555-0177" });

    for (const c of [linda, carla, bob]) {
      const inv = await post(http, auth, "/api/invoices", {
        customerId: c.id,
        jobName: "Fence Repair",
        lineItems: [{ description: "Fence repair", quantity: 1, unit: "job", price: 20000 }],
        amount: 20000,
        dueDate: "2026-12-30",
      });
      await post(http, auth, `/api/invoices/${inv.id}/email`, {});
    }

    const listed = await (await http("/api/outbox", { headers: auth })).json() as Row[];
    const mailTo = (id: string) => listed.find((r) => r.customerId === id && r.channel === "email");
    for (const c of [linda, carla, bob]) {
      expect(!!mailTo(c.id), `the Outbox has the email to ${c.name} (${JSON.stringify(listed)})`);
    }

    for (const c of [linda, carla]) {
      const mine = mailTo(c.id)!;
      await page.goto(`/customers/${c.id}?tab=messages`);
      await page.locator(`[data-cy='customer-workspace'][data-customer='${c.id}']`).waitFor({ timeout: 20_000 });
      await page.locator("[data-cy='cws-tab-messages']").click();
      const row = page.locator(`[data-cy='cws-outbox-row'][data-id='${mine.id}']`);
      try {
        await row.waitFor({ timeout: 15_000 });
      } catch {
        const shown = (await page.locator(".cws-card").last().textContent())?.trim();
        throw new Error(`${c.name}'s Messages tab does not list the email sent to her (outbox ${mine.id}); it shows: "${shown}"`);
      }
      const text = (await row.textContent()) ?? "";
      expect(text.includes(mine.docRef ?? "INV-"), `the row names the invoice ${mine.docRef} (got "${text}")`);
      expect.eq(
        await page.locator(`[data-cy='cws-outbox-row'][data-id='${mailTo(bob.id)!.id}']`).count(),
        0,
        "Bob's email is not on her page",
      );
    }
  }));
