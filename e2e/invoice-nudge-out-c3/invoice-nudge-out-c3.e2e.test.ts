/**
 * REQ-477 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 3 (run re05e1cbb), issue M31: an ordinary unpaid
 * invoice (sent, not yet overdue) had no way to send a reminder by hand. In a
 * browser: the out card's back row carries an outlined "Send a nudge" beside
 * its "Payment received" CTA, and clicking it sends one reminder and says so.
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
    body: JSON.stringify({ language: "en", name: "Invoice Story" }),
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

Deno.test("REQ-477 (demo M31): a sent, not-yet-overdue invoice card offers 'Send a nudge' next to 'Payment received', and it sends a reminder", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Maria Ochoa",
        email: "maria@blackhole.postmarkapp.com",
      }),
    })).json();
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        jobName: "Gutter clean REQ-477",
        description: "Gutter clean",
        lineItems: [{ description: "Gutter clean", quantity: 1, price: 22000 }],
        amount: 22000,
        issuedDate: iso(0),
        dueDate: iso(14),
      }),
    })).json();
    expect(typeof inv.id === "string", `invoice created (${inv.id})`);

    await page.goto("/invoices");
    const card = page.locator(".qcard", {
      has: page.locator("[data-cy='invoice-card-job']", {
        hasText: "Gutter clean REQ-477",
      }),
    });
    await card.waitFor({ timeout: 15_000 });
    expect.eq(
      await card.locator("[data-cy='invoice-cta-out']").count(),
      1,
      "the card is an out (not overdue) card",
    );
    await card.click(); // flip to the back face

    const cta = card.locator("[data-cy='invoice-back-cta-out']");
    expect.eq((await cta.innerText()).trim(), "Payment received", "stage CTA");
    const nudge = card.locator("[data-cy='invoice-nudge']");
    await nudge.waitFor({ timeout: 15_000 });
    expect.eq((await nudge.innerText()).trim(), "Send a nudge", "nudge label");
    const nudgeClass = (await nudge.getAttribute("class")) ?? "";
    expect(
      !nudgeClass.includes("primary"),
      `the nudge is an outlined secondary, not a second primary (${nudgeClass})`,
    );
    const back = await card.locator(".qcard__back-foot button")
      .allInnerTexts();
    expect.eq(
      back.filter((s) => s.trim() === "Payment received").length,
      1,
      `still one 'Payment received' (${back.join(" / ")})`,
    );

    const sent = page.waitForResponse(
      (r) => r.url().includes("/api/cron/invoice-reminder"),
      { timeout: 15_000 },
    );
    await nudge.click();
    const res = await sent;
    expect.eq(res.status(), 200, "the reminder endpoint accepted it");
    const body = await res.json() as { channels?: string[] };
    expect(
      Array.isArray(body.channels) && body.channels.includes("email"),
      `the reminder went out by email (${JSON.stringify(body)})`,
    );
    const note = card.locator("[data-cy='invoice-send-note']");
    await note.waitFor({ timeout: 15_000 });
    expect.eq(
      (await note.innerText()).trim(),
      "Nudge sent",
      "the card says so",
    );
  }));
