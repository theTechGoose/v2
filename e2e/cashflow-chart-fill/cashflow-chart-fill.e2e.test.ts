/**
 * REQ-553 — demo-loop cycle 4, issue m22: "Cash-flow chart filled solid
 * black", in a browser on the real shell.
 *
 * With one landed payment, /payments draws the cash-flow sparkline in the
 * side rail. Its area is filled with url(#cfArea), a coral fade. The stops
 * were written `stopColor`/`stopOpacity`, which the client render sets as
 * literal attributes SVG ignores, so the stops computed to black at full
 * opacity. Now each stop computes to coral (#FF6B6B), the top one at 0.32
 * opacity and the bottom one at 0.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Cash Flow Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return { auth };
}

async function landedPayment(
  http: StoryTools["http"],
  auth: Record<string, string>,
) {
  const customer = await (await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Randall Belknap",
      email: "rb@blackhole.postmarkapp.com",
    }),
  })).json();
  const inv = await (await http("/api/invoices", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId: customer.id,
      status: "sent",
      jobName: "Back fence",
      dueDate: new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10),
      lineItems: [{
        description: "Back fence",
        quantity: 1,
        unit: "job",
        price: 6500,
      }],
      amount: 6500,
    }),
  })).json();
  const p = await http("/api/payments", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      invoiceId: inv.id,
      amount: 6500,
      method: "zelle",
      receivedAt: new Date().toISOString().slice(0, 10),
    }),
  });
  if (!p.ok) throw new Error(`POST /payments ${p.status}: ${await p.text()}`);
  await p.body?.cancel();
}

Deno.test("REQ-553 (cycle 4, m22): the /payments cash-flow area is a coral fade, not solid black", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await landedPayment(http, auth);
    await page.goto("/payments");
    const stops = page.locator("#cfArea stop");
    await stops.first().waitFor({ state: "attached", timeout: 20_000 });
    const computed = await stops.evaluateAll((els) =>
      els.map((el) => {
        const cs = getComputedStyle(el);
        return { color: cs.stopColor, opacity: cs.stopOpacity };
      })
    );
    expect.eq(computed.length, 2, "two gradient stops");
    expect.eq(
      computed[0].color,
      "rgb(255, 107, 107)",
      `top stop colour (${JSON.stringify(computed)})`,
    );
    expect.eq(computed[0].opacity, "0.32", "top stop opacity");
    expect.eq(
      computed[1].color,
      "rgb(255, 107, 107)",
      `bottom stop colour (${JSON.stringify(computed)})`,
    );
    expect.eq(computed[1].opacity, "0", "bottom stop opacity");
  }));
