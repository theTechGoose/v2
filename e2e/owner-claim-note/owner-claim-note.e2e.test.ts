/**
 * REQ-557 — demo-loop cycle 4, issue M25: the owner opening her own CLAIMED
 * invoice on /i/:id was addressed as the client ("You told {who} you paid")
 * and had no Confirm. In a browser:
 *  - the owner's tab shows "Juan says they paid by Zelle · ref ZL-557" with
 *    Confirm received / Didn't get it / Open in Invoices, never "You told";
 *  - Confirm received lands the payment (the invoice reads paid);
 *  - Didn't get it on a second claimed invoice reopens it (status sent);
 *  - the customer (no session) keeps "You told … you paid" and no buttons.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function seed(http: StoryTools["http"]) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
  await call("/api/me", { name: "Claim Owner", language: "en" }, "PUT");
  await call("/api/profile/identity", {
    businessName: "Zelle Builders",
    acceptedPaymentMethods: { zelle: { enabled: true, handle: "z@x.com" } },
  }, "PUT");
  const customer = await call("/api/customers", {
    name: "Juan Pérez",
    email: "juan@blackhole.postmarkapp.com",
  });
  const invoice = async (n: number) => {
    const inv = await call("/api/invoices", {
      customerId: customer.id,
      status: "sent",
      jobName: `Fence repair REQ-557 #${n}`,
      description: "Fence repair REQ-557",
      lineItems: [{ description: "Fence repair", quantity: 1, price: 48000 }],
      amount: 48000,
      dueDate: "2026-12-05",
    });
    // the customer's claim: no session, as from their own link
    const c = await http(`/api/invoices/${inv.id}/claim-payment`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ method: "zelle", reference: "ZL-557" }),
    });
    if (!c.ok) throw new Error(`claim → ${c.status} ${await c.text()}`);
    return inv.id as string;
  };
  return { cookie, confirmId: await invoice(1), rejectId: await invoice(2) };
}

const statusOf = async (http: StoryTools["http"], id: string) =>
  (await http(`/api/invoices/${id}/public`).then((r) => r.json())).status;

Deno.test("REQ-557 M25: the owner's claimed /i/:id says 'Juan says they paid by Zelle · ref …' with Confirm received / Didn't get it; the customer keeps 'You told … you paid'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { cookie, confirmId, rejectId } = await seed(http);
    const [name, value] = cookie.split("=");
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies(
      [...hosts].flatMap((domain) => [
        { name, value, domain, path: "/" },
        { name: "pm_lang", value: "en", domain, path: "/" },
      ]),
    );
    await page.setViewportSize({ width: 1280, height: 900 });

    // 1. the owner's tab: a note addressed to her, with the actions
    await page.goto(`/i/${confirmId}`);
    const note = page.locator("[data-cy=owner-claim-note]");
    await note.waitFor({ timeout: 15_000 });
    expect.eq(
      (await note.innerText()).includes(
        "Juan says they paid by Zelle · ref ZL-557.",
      ),
      true,
      "the note names the customer, the method and the reference",
    );
    expect.eq(
      await page.getByText("You told", { exact: false }).count(),
      0,
      "the owner is not addressed as the client",
    );
    expect.eq(
      await page.locator("[data-cy=owner-claim-open]").getAttribute("href"),
      `/invoices?open=${confirmId}`,
      "Open in Invoices links to the invoice",
    );

    // 2. Confirm received lands the payment (click until hydrated)
    for (
      let i = 0;
      i < 10 && (await statusOf(http, confirmId)) !== "paid";
      i++
    ) {
      try {
        await page.locator("[data-cy=owner-claim-confirm]").click({
          timeout: 2_000,
        });
        await page.waitForTimeout(1_000);
      } catch { /* not hydrated yet / reloading */ }
    }
    expect.eq(await statusOf(http, confirmId), "paid", "confirmed → paid");

    // 3. Didn't get it on the second claim reopens it
    await page.goto(`/i/${rejectId}`);
    await page.locator("[data-cy=owner-claim-note]").waitFor({
      timeout: 15_000,
    });
    for (
      let i = 0;
      i < 10 && (await statusOf(http, rejectId)) !== "sent";
      i++
    ) {
      try {
        await page.locator("[data-cy=owner-claim-reject]").click({
          timeout: 2_000,
        });
        await page.waitForTimeout(1_000);
      } catch { /* not hydrated yet / reloading */ }
    }
    expect.eq(await statusOf(http, rejectId), "sent", "rejected → reopened");

    // 4. the customer's own link to a claimed invoice keeps the customer note
    const browser = page.context().browser();
    if (!browser) throw new Error("no browser behind the story page");
    const customerCtx = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    });
    try {
      const again = await http(`/api/invoices/${rejectId}/claim-payment`, {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ method: "zelle", reference: "ZL-557b" }),
      });
      expect.eq(again.ok, true, "the customer claims again");
      const cx = await customerCtx.newPage();
      await cx.goto(`${baseUrl}/i/${rejectId}?lang=en`);
      await cx.getByText("You told", { exact: false }).first().waitFor({
        timeout: 15_000,
      });
      expect.eq(
        await cx.locator("[data-cy=owner-claim-note]").count(),
        0,
        "the customer sees no owner note",
      );
    } finally {
      await customerCtx.close();
    }
  }));
