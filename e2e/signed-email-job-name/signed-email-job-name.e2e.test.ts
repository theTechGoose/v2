/**
 * REQ-1046 — LOOP-007 cycle 2, issues q2-31 + q2-45: one quote, one name.
 *
 * The chat model writes a quote's summary as "<job> — <customer>" (REQ-576)
 * and a separate jobName without the customer. The story seeds that exact
 * pair through the API (the summary text comes from the model, so a live LLM
 * can't script it), the customer signs on /q, and:
 *  - the signed-agreement email in the account's outbox (GET /outbox, the /messages page)
 *    is "Signed: Master Bath Redo — countersigned PDF + first invoice · Q-001",
 *    never "Signed: Master bath redo — Maria Gonzalez — …";
 *  - the owner's /quotes open panel shows the job as "Master Bath Redo" and
 *    no line under it repeats "Maria Gonzalez" inside the job title.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGNgYGD4z4AGmNAFRlgIXQAAiMkBB9dzbnMAAAAASUVORK5CYII=";

type Entry = { channel?: string; subject?: string; kind?: string };

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
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
  const call = async (path: string, payload: unknown, method = "POST") => {
    const res = await http(path, {
      method,
      headers: auth,
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(`${path} → ${res.status} ${JSON.stringify(json)}`);
    }
    return json;
  };
  await call("/api/me", {
    name: "Marcus Reyes",
    email: `owner${digits()}@example.com`,
    language: "en",
  }, "PUT");
  await call("/api/profile/identity", {
    businessName: "Reyes Remodeling",
    commsLanguage: "en",
  }, "PUT");
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  const outbox = async (): Promise<Entry[]> => {
    const res = await http("/api/outbox", { headers: auth });
    if (!res.ok) throw new Error(`/api/outbox → ${res.status}`);
    return await res.json();
  };
  return { call, outbox };
}

/** The tester's exact pair, seeded through the API, then signed by the
 *  customer on her own device (no session). */
async function signedQuote(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const s = await signIn(http, page, baseUrl);
  const customer = await s.call("/api/customers", {
    name: "Maria Gonzalez",
    email: `maria${digits()}@blackhole.postmarkapp.com`,
  });
  const quote = await s.call("/api/quotes", {
    customerId: customer.id,
    summary: "Master bath redo — Maria Gonzalez",
    jobName: "Master Bath Redo",
    lineItems: [{
      description: "Master bath redo",
      quantity: 1,
      unit: "job",
      price: 1_800_000,
    }],
    estimatedTotal: 1_800_000,
    terms: [{ stepId: "payment_terms", value: "Due Now" }],
    status: "draft",
  });
  await s.call(`/api/quotes/${quote.id}`, { status: "sent" }, "PUT");
  const accept = await http(`/api/quotes/${quote.id}/accept`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "Maria Gonzalez", signature: SIGNATURE_PNG }),
  });
  await accept.body?.cancel();
  if (accept.status >= 400) throw new Error(`accept: ${accept.status}`);
  return { ...s, quoteId: quote.id as string };
}

Deno.test("REQ-1046 (LOOP-007 q2-31): the customer signs a quote whose summary is 'Master bath redo — Maria Gonzalez' → the signed email's subject is 'Signed: Master Bath Redo — countersigned PDF + first invoice · Q-001'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const s = await signedQuote(http, page, baseUrl);
    let signed: Entry | undefined;
    for (let i = 0; i < 20 && !signed; i++) {
      signed = (await s.outbox()).find((e) => e.kind === "signedCopy");
      if (!signed) await new Promise((r) => setTimeout(r, 500));
    }
    expect(!!signed, "the signed-agreement email is in the outbox");
    expect.eq(
      signed?.subject,
      "Signed: Master Bath Redo — countersigned PDF + first invoice · Q-001",
      "the signed email's subject names the job by its job name",
    );
  }));

Deno.test("REQ-1046 (LOOP-007 q2-45): the owner's /quotes panel for that quote is titled 'Master Bath Redo' and no line under the title repeats 'Maria Gonzalez' inside the job title", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const s = await signedQuote(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`${baseUrl}/quotes?open=${s.quoteId}`);
    const panel = page.locator("[data-cy='quote-open-panel']");
    await panel.waitFor({ timeout: 15_000 });
    const title = (await panel.locator(".qopen__title").innerText()).trim();
    expect.eq(title, "Master Bath Redo", "the panel's title is the job name");
    const lines = await panel.locator(".qopen__summary").allInnerTexts();
    expect.eq(
      JSON.stringify(lines.filter((l) => l.includes("Maria Gonzalez"))),
      "[]",
      "no line under the title carries the customer's name",
    );
  }));
