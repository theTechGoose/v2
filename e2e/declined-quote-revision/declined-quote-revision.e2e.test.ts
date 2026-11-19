/**
 * REQ-1026 — LOOP-007 cycle 2, issue q2-5: revising a DECLINED quote is a
 * dead end. Raphael: "test every single aspect of this application … one Opus
 * agent per issue to do root cause analysis, then one to write the test, then
 * one to fix it and make it green."
 *
 * Jorge declines Q-001. The contractor follows the decline alert ("revise the
 * quote and send it again", REQ-948): edits a line and publishes Version 2
 * with "notify customer". Jorge is texted that Version 2 is ready — so his
 * /q page must read "Versión 2" (not "Rechazada") and show the signing
 * section. Today it reads "Versión 2 · Rechazada" with nowhere to sign.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
/** a 555-01xx number: reserved as fictional, never a real customer */
const fictional = () =>
  `+1512555${String(100 + Math.floor(Math.random() * 100)).padStart(4, "0")}`;

async function signIn(http: StoryTools["http"]) {
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
  if (!cookie) throw new Error(`sign-in: no cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const call = async (
    path: string,
    payload: unknown,
    method = "POST",
    headers: Record<string, string> = auth,
  ) => {
    const res = await http(path, {
      method,
      headers,
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`${path} → ${res.status} ${JSON.stringify(json)}`);
    }
    return json;
  };
  await call("/api/me", {
    name: "Rafa Castro",
    email: `owner${digits()}@example.com`,
    language: "es",
  }, "PUT");
  const customer = await call("/api/customers", {
    name: "Jorge Ruiz",
    phoneNumber: fictional(),
    email: `jorge${digits()}@example.com`,
    language: "es",
  });
  return { call, customerId: customer.id as string };
}

Deno.test("REQ-1026 (LOOP-007 q2-5): a declined quote revised and re-sent with notify opens on /q as 'Versión 2' with the signing section — not 'Rechazada' with nowhere to sign", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const s = await signIn(http);
    const line = {
      description: "Cambio de techo",
      quantity: 1,
      unit: "job",
      price: 900_000,
    };
    const quote = await s.call("/api/quotes", {
      customerId: s.customerId,
      summary: "Cambio de techo",
      jobName: "Cambio de techo",
      lineItems: [line],
      estimatedTotal: 900_000,
      status: "draft",
    });
    await s.call(`/api/quotes/${quote.id}`, { status: "sent" }, "PUT");
    // Jorge declines Version 1 (the public, unauthenticated endpoint /q uses)
    await s.call(
      `/api/quotes/${quote.id}/decline`,
      { reason: "price", name: "Jorge Ruiz" },
      "POST",
      JSON_HEADERS,
    );
    // the contractor revises it and publishes Version 2, notifying Jorge
    const pending = await s.call(`/api/quotes/${quote.id}`, {
      lineItems: [line, {
        description: "Protectores de canaleta",
        quantity: 1,
        unit: "job",
        price: 120_000,
      }],
      estimatedTotal: 1_020_000,
    }, "PUT");
    expect(pending.pendingRevision, "the edit waits as a revision");
    const published = await s.call(`/api/quotes/${quote.id}/publish`, {
      notify: true,
    });
    expect.eq(published.version, 2, "publishing makes Version 2");

    // Jorge opens his link (no session: the customer, not the owner)
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${baseUrl}/q/${quote.id}?lang=es`);
    const headline = page.locator("[data-cy='quote-doc-headline']");
    await headline.waitFor({ timeout: 20_000 });
    const text = (await headline.innerText()).trim();
    expect(/Versión 2/.test(text), `the headline names Version 2: "${text}"`);
    expect(
      !/Rechazada/i.test(text),
      `Version 2 is not declined: "${text}"`,
    );
    const signing = page.locator("[data-cy='quote-signature-section']");
    expect.eq(
      await signing.count(),
      1,
      "the signing section (FIRMA AQUÍ) is on the page",
    );
    await signing.scrollIntoViewIfNeeded();
    expect(await signing.isVisible(), "the signing section is visible");
  }));
