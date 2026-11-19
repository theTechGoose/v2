/**
 * REQ-985 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the test,
 * then one to fix it and make it green." LOOP-007 cycle 1, issue q1-63: the
 * /invoices overdue card for a client with an email and no phone says "A
 * friendly text usually unsticks it." and its back lists "View as customer"
 * twice.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Overdue Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: "en",
      domain,
      path: "/",
    }]),
  );
  return { auth };
}

const iso = (days: number) =>
  new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

Deno.test("REQ-985 (LOOP-007 q1-63): an overdue card for an email-only client does not suggest a text and lists 'View as customer' once", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Dana Whitfield",
        email: "dana@blackhole.postmarkapp.com",
      }),
    })).json();
    expect(
      typeof customer.id === "string",
      `customer created (${customer.id})`,
    );
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        jobName: "Fence stain REQ-985",
        description: "Fence stain",
        lineItems: [{ description: "Fence stain", quantity: 1, price: 48000 }],
        amount: 48000,
        issuedDate: iso(-30),
        dueDate: iso(-5),
      }),
    })).json();
    expect(typeof inv.id === "string", `invoice created (${inv.id})`);

    await page.goto("/invoices");
    const card = page.locator(".qcard", {
      has: page.locator("[data-cy='invoice-card-job']", {
        hasText: "Fence stain REQ-985",
      }),
    });
    await card.waitFor({ timeout: 15_000 });
    expect.eq(
      await card.locator("[data-cy='invoice-cta-overdue']").count(),
      1,
      "the card is an overdue card",
    );
    await card.click(); // flip to the back face
    await card.locator("[data-cy='invoice-back-cta-overdue']").waitFor({
      timeout: 15_000,
    });

    const labels =
      (await card.locator(".qcard__back-foot a, .qcard__back-foot button")
        .allInnerTexts()).map((s) => s.trim());
    expect.eq(
      labels.filter((s) => s === "View as customer").length,
      1,
      `the back lists 'View as customer' once (${labels.join(" / ")})`,
    );

    const read = (await card.locator(".qcard__read").innerText()).trim();
    expect(/Past due/i.test(read), `the overdue line shows ("${read}")`);
    expect(
      !/\btext\b/i.test(read),
      `the client has no phone — the overdue line must not suggest a text ("${read}")`,
    );
  }));
