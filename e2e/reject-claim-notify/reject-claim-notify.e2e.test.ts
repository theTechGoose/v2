/**
 * REQ-488 — demo-loop cycle 3, issues m56 + m57. In a browser: the customer
 * claims "Zelle"; on the claimed card's back "Didn't get it" asks first and
 * POSTs nothing until "Mark not received"; then the topbar chip no longer
 * reads "… says they paid via Zelle", and the customer's /i says the payment
 * hasn't arrived and names the Zelle handle to check.
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
    body: JSON.stringify({ language: "en", name: "Rosa Story" }),
  });
  await me.body?.cancel();
  const identity = await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({
      businessName: "Rosa Co",
      acceptedPaymentMethods: {
        zelle: { enabled: true, handle: "rosa-488@zelle.test" },
      },
    }),
  });
  await identity.body?.cancel();
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

Deno.test("REQ-488 m56/m57: 'Didn't get it' asks first, the claim chip gives way to 'not received', and /i tells the customer where to check", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Maria Lopez",
        email: "maria@blackhole.postmarkapp.com",
      }),
    })).json();
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        jobName: "Door repair REQ-488",
        description: "Door repair",
        lineItems: [{ description: "Door repair", quantity: 1, price: 25000 }],
        amount: 25000,
        dueDate: "2026-12-20",
      }),
    })).json();
    const claim = await http(`/api/invoices/${inv.id}/claim-payment`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ method: "zelle" }),
    });
    expect.eq(claim.status, 200, "the customer's claim is recorded");
    await claim.body?.cancel();

    const rejects: string[] = [];
    page.on("request", (r) => {
      if (r.url().includes("/reject-claim")) rejects.push(r.url());
    });

    await page.goto("/invoices");
    const ticker = page.locator(".topbar__ticker .topbar__ticker-item").first();
    await ticker.waitFor({ timeout: 15_000 });
    const card = page.locator(".qcard", {
      has: page.locator("[data-cy='invoice-card-job']", {
        hasText: "Door repair REQ-488",
      }),
    });
    await card.waitFor({ timeout: 15_000 });
    await card.click(); // flip to the back face
    await card.locator("[data-cy='invoice-reject-claim']").click();
    const ask = card.locator("[data-cy='invoice-reject-ask']");
    await ask.waitFor({ timeout: 15_000 });
    const askText = await ask.innerText();
    expect(
      askText.includes("Maria Lopez") && askText.includes("Zelle"),
      `the ask names who and how (${askText})`,
    );
    expect.eq(rejects.length, 0, "the first click rejected nothing");

    await card.locator("[data-cy='invoice-reject-ask-no']").click();
    await ask.waitFor({ state: "hidden", timeout: 15_000 });
    expect.eq(rejects.length, 0, "Cancel rejected nothing");

    await card.locator("[data-cy='invoice-reject-claim']").click();
    const done = page.waitForResponse(
      (r) => r.url().includes("/reject-claim"),
      { timeout: 15_000 },
    );
    await card.locator("[data-cy='invoice-reject-ask-yes']").click();
    expect.eq((await done).status(), 200, "'Mark not received' rejects");
    await page.waitForLoadState("load");

    // m57: the topbar chip now shows the rejection, not the stale claim
    await page.waitForFunction(
      () => {
        const el = document.querySelector(
          ".topbar__ticker .topbar__ticker-item",
        );
        return !!el && /not received/i.test(el.textContent ?? "");
      },
      undefined,
      { timeout: 20_000 },
    );
    const chip = await ticker.innerText();
    expect(!/says they paid/i.test(chip), `stale claim chip gone (${chip})`);

    // m56: the customer's /i says it hasn't arrived and where to check
    await page.goto(`/i/${inv.id}?lang=en`);
    const note = page.locator("[data-claim-rejected]");
    await note.waitFor({ timeout: 15_000 });
    const noteText = await note.innerText();
    expect(
      /hasn't received/i.test(noteText) &&
        noteText.includes("rosa-488@zelle.test"),
      `the /i note explains and names the Zelle handle (${noteText})`,
    );
  }));
